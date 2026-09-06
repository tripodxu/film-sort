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
