import { describe, expect, it } from "vitest";

import {
  choosePreferred,
  createRankingState,
  deferCurrent,
  deserializeRankingState,
  getCurrentComparison,
  getRankingProgress,
  getRankingResult,
  serializeRankingState,
  skipCurrent,
  skipWork,
  undoLastAction,
  type RankingState,
} from "./ranking";

function finishByScore(
  initial: RankingState,
  score: Readonly<Record<string, number>>,
): RankingState {
  let state = initial;
  let guard = 0;

  while (!state.completed) {
    const comparison = getCurrentComparison(state);
    if (!comparison) {
      throw new Error("An incomplete ranking must expose a comparison");
    }

    const preferredId =
      score[comparison.leftId] > score[comparison.rightId]
        ? comparison.leftId
        : comparison.rightId;
    state = choosePreferred(state, preferredId);

    guard += 1;
    if (guard > 1_000) {
      throw new Error("Ranking did not terminate");
    }
  }

  return state;
}

describe("ranking engine", () => {
  it("uses a seed to create a stable, non-destructive shuffle", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];

    const first = createRankingState(items, { seed: "movie-night" });
    const again = createRankingState(items, { seed: "movie-night" });
    const other = createRankingState(items, { seed: "another-night" });

    expect(first.shuffledIds).toEqual(again.shuffledIds);
    expect(first.shuffledIds).not.toEqual(other.shuffledIds);
    expect([...first.shuffledIds].sort()).toEqual([...items].sort());
    expect(items).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("binary-inserts candidates into a correct complete ranking", () => {
    const ids = ["m6", "m1", "m4", "m2", "m5", "m3"];
    const score = Object.fromEntries(
      ids.map((id) => [id, Number(id.slice(1))]),
    );

    const completed = finishByScore(
      createRankingState(ids, { seed: "complete" }),
      score,
    );

    expect(getRankingResult(completed)).toEqual([
      "m6",
      "m5",
      "m4",
      "m3",
      "m2",
      "m1",
    ]);
    expect(new Set(getRankingResult(completed)).size).toBe(ids.length);
    expect(completed.comparisonCount).toBeLessThanOrEqual(
      completed.estimatedTotalComparisons,
    );
    expect(getRankingProgress(completed)).toMatchObject({
      fraction: 1,
      estimatedRemaining: 0,
      processed: ids.length,
      total: ids.length,
    });
  });

  it("keeps only the correct Top N while considering every candidate", () => {
    const ids = Array.from({ length: 24 }, (_, index) => `m${index + 1}`);
    const score = Object.fromEntries(
      ids.map((id) => [id, Number(id.slice(1))]),
    );

    const completed = finishByScore(
      createRankingState(ids, { seed: "top-five", topN: 5 }),
      score,
    );

    expect(getRankingResult(completed)).toEqual([
      "m24",
      "m23",
      "m22",
      "m21",
      "m20",
    ]);
    expect(completed.processedCount).toBe(ids.length);
    expect(completed.rankedIds).toHaveLength(5);
  });

  it("places the candidate on deterministic seed-derived sides", () => {
    const ids = Array.from({ length: 18 }, (_, index) => `m${index + 1}`);
    const score = Object.fromEntries(
      ids.map((id) => [id, Number(id.slice(1))]),
    );
    const seenSides: boolean[] = [];
    let state = createRankingState(ids, { seed: "sides" });

    while (!state.completed) {
      const comparison = getCurrentComparison(state)!;
      seenSides.push(comparison.candidateId === comparison.leftId);
      const preferredId =
        score[comparison.leftId] > score[comparison.rightId]
          ? comparison.leftId
          : comparison.rightId;
      state = choosePreferred(state, preferredId);
    }

    expect(seenSides).toContain(true);
    expect(seenSides).toContain(false);

    let replay = createRankingState(ids, { seed: "sides" });
    for (const candidateWasLeft of seenSides) {
      const comparison = getCurrentComparison(replay)!;
      expect(comparison.candidateId === comparison.leftId).toBe(
        candidateWasLeft,
      );
      const preferredId =
        score[comparison.leftId] > score[comparison.rightId]
          ? comparison.leftId
          : comparison.rightId;
      replay = choosePreferred(replay, preferredId);
    }
  });

  it("undo restores the exact prior state, including presentation", () => {
    const initial = createRankingState(["a", "b", "c", "d"], {
      seed: "undo",
    });
    const comparison = getCurrentComparison(initial)!;
    const advanced = choosePreferred(initial, comparison.leftId);

    expect(advanced).not.toEqual(initial);
    expect(undoLastAction(advanced)).toEqual(initial);
    expect(undoLastAction(initial)).toBe(initial);
  });

  it("skip removes the current candidate and continues", () => {
    const initial = createRankingState(["a", "b", "c", "d"], {
      seed: "skip",
    });
    const skippedId = getCurrentComparison(initial)!.candidateId;
    const afterSkip = skipCurrent(initial);
    const score = { a: 4, b: 3, c: 2, d: 1 };
    const completed = finishByScore(afterSkip, score);

    expect(completed.skippedIds).toEqual([skippedId]);
    expect(getRankingResult(completed)).not.toContain(skippedId);
    expect(new Set(getRankingResult(completed)).size).toBe(3);
    expect(undoLastAction(afterSkip)).toEqual(initial);
  });

  it("defer postpones a candidate, then re-enters it after other work", () => {
    const initial = createRankingState(["a", "b", "c", "d", "e"], {
      seed: "defer",
    });
    const deferredId = getCurrentComparison(initial)!.candidateId;
    let state = deferCurrent(initial);

    expect(state.deferredIds).toContain(deferredId);
    expect(getCurrentComparison(state)!.candidateId).not.toBe(deferredId);

    const score: Record<string, number> = { a: 5, b: 4, c: 3, d: 2, e: 1 };
    let reentered = false;
    let guard = 0;
    while (!state.completed) {
      const comparison = getCurrentComparison(state)!;
      if (comparison.candidateId === deferredId) reentered = true;
      const preferredId =
        score[comparison.leftId] > score[comparison.rightId]
          ? comparison.leftId
          : comparison.rightId;
      state = choosePreferred(state, preferredId);
      guard += 1;
      expect(guard).toBeLessThan(100);
    }

    expect(reentered).toBe(true);
    expect(getRankingResult(state)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("round-trips all state needed to resume through JSON", () => {
    let state = createRankingState(["a", "b", "c", "d"], {
      seed: "persist",
      topN: 3,
    });
    state = deferCurrent(state);
    const comparison = getCurrentComparison(state)!;
    state = choosePreferred(state, comparison.rightId);

    const restored = deserializeRankingState(serializeRankingState(state));

    expect(restored).toEqual(state);
    expect(getCurrentComparison(restored)).toEqual(
      getCurrentComparison(state),
    );
  });

  it("adds a compact verification pass without immediately repeating a pair", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const score = Object.fromEntries(ids.map((id, index) => [id, index]));
    const completed = finishByScore(createRankingState(ids, { seed: "verify" }), score);

    expect(completed.decisionLog.some((decision) => decision.phase === "verification")).toBe(true);
    expect(completed.pairEvidence.some((entry) => entry.phase === "verification")).toBe(true);

    for (let index = 1; index < completed.pairEvidence.length; index += 1) {
      expect(completed.pairEvidence[index].key).not.toBe(completed.pairEvidence[index - 1].key);
    }
  });

  it("spaces a recently shown pair before starting the next candidate", () => {
    const initial = createRankingState(["a", "x", "b", "c"], { seed: "cooldown" });
    const state: RankingState = {
      ...initial,
      rankedIds: ["a"],
      pendingIds: ["b", "c"],
      deferredIds: [],
      activeInsertion: { candidateId: "x", low: 0, high: 1, presentationIndex: initial.nextPresentationIndex },
      nextPresentationIndex: initial.nextPresentationIndex + 1,
      recentPairKeys: ["a\u0000b"],
      processedCount: 1,
    };

    const next = skipCurrent(state);

    expect(getCurrentComparison(next)?.candidateId).toBe("c");
  });

  it("keeps the target of a skipped opponent so undo can replay it", () => {
    const initial = createRankingState(["a", "b", "c", "d", "e"], { seed: "opponent-undo" });
    const comparison = getCurrentComparison(initial)!;
    const advanced = skipWork(initial, comparison.opponentId);

    expect(advanced.skippedIds).toContain(comparison.opponentId);
    expect(undoLastAction(advanced)).toEqual(initial);
  });

  it("queues and confirms a preference loop without trapping the ranking", () => {
    const seed = createRankingState(["a", "b", "c"], { seed: "cycle" });
    const state: RankingState = {
      ...seed,
      rankedIds: ["a", "b"],
      pendingIds: [],
      deferredIds: [],
      activeInsertion: { candidateId: "c", low: 0, high: 1, presentationIndex: seed.nextPresentationIndex },
      nextPresentationIndex: seed.nextPresentationIndex + 1,
      comparisonCount: 2,
      processedCount: 2,
      preferenceEdges: [
        { winnerId: "a", loserId: "b", count: 1 },
        { winnerId: "b", loserId: "c", count: 1 },
      ],
      pairEvidence: [
        { key: "a\u0000b", leftId: "a", rightId: "b", preferredId: "a", comparisonIndex: 1, phase: "ranking" },
        { key: "b\u0000c", leftId: "b", rightId: "c", preferredId: "b", comparisonIndex: 2, phase: "ranking" },
      ],
      recentPairKeys: ["a\u0000b", "b\u0000c"],
    };
    const comparison = getCurrentComparison(state)!;
    expect(comparison.opponentId).toBe("a");

    let verified = choosePreferred(state, "c");
    expect(verified.cycleStatus).toBe("observed");
    expect(verified.cycleEvents).toHaveLength(1);

    let guard = 0;
    while (!verified.completed) {
      const active = verified.activeVerification;
      expect(active).not.toBeNull();
      verified = choosePreferred(verified, active!.task.expectedWinnerId ?? active!.task.leftId);
      guard += 1;
      expect(guard).toBeLessThan(20);
    }

    expect(verified.cycleStatus).toBe("persistent");
    expect(verified.cycleEvents[0].consistentConfirmations).toBeGreaterThanOrEqual(3);
  });

  it("migrates a v1 draft into the verified ranking state", () => {
    const initial = createRankingState(["a", "b", "c", "d"], { seed: "legacy" });
    const comparison = getCurrentComparison(initial)!;
    const advanced = choosePreferred(initial, comparison.leftId);
    const raw = JSON.parse(serializeRankingState(advanced)) as Record<string, unknown>;
    raw.version = 1;
    delete raw.phase;
    delete raw.verificationQueue;
    delete raw.activeVerification;
    delete raw.pairEvidence;
    delete raw.recentPairKeys;
    delete raw.preferenceEdges;
    delete raw.cycleEvents;
    delete raw.cycleStatus;
    raw.decisionLog = (raw.decisionLog as Array<Record<string, unknown>>).map(({ phase: _phase, ...decision }) => decision);

    const restored = deserializeRankingState(JSON.stringify(raw));
    expect(restored.version).toBe(2);
    expect(restored.phase).toBe("ranking");
    expect(getCurrentComparison(restored)).not.toBeNull();
  });

  it("deduplicates input and completes empty or singleton rankings", () => {
    const empty = createRankingState([], { seed: "empty" });
    const singleton = createRankingState(["a", "a"], { seed: "one" });

    expect(empty.completed).toBe(true);
    expect(getRankingResult(empty)).toEqual([]);
    expect(singleton.completed).toBe(true);
    expect(getRankingResult(singleton)).toEqual(["a"]);
    expect(singleton.sourceIds).toEqual(["a"]);
  });
});
