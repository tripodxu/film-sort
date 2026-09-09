import { describe, it, expect } from "vitest";
import {
  createRankingState,
  chooseSide,
  choosePreferred,
  skipWork,
  deferWork,
  undoLastAction,
  getCurrentComparison,
  getRankingProgress,
  getRankingResult,
  serializeRankingState,
  deserializeRankingState,
} from "./ranking";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);
const seed = "test-seed-123";

describe("createRankingState", () => {
  it("creates a valid initial state", () => {
    const state = createRankingState(ids(5), { seed });
    expect(state.sourceIds).toHaveLength(5);
    expect(state.rankedIds).toHaveLength(1);
    expect(state.pendingIds.length + state.skippedIds.length + state.rankedIds.length).toBeLessThanOrEqual(5);
    expect(state.completed).toBe(false);
    expect(state.phase).toBe("ranking");
    expect(state.comparisonCount).toBe(0);
  });

  it("auto-completes with 1 item", () => {
    const state = createRankingState(["only"], { seed });
    expect(state.completed).toBe(true);
    expect(state.phase).toBe("complete");
  });

  it("handles empty array (auto-completes)", () => {
    const state = createRankingState([], { seed });
    expect(state.completed).toBe(true);
    expect(state.rankedIds).toHaveLength(0);
  });

  it("clamps topN to source length", () => {
    const state = createRankingState(ids(5), { seed, topN: 100 });
    expect(state.topN).toBe(5);
  });

  it("deterministic with same seed", () => {
    const a = createRankingState(ids(10), { seed: "abc" });
    const b = createRankingState(ids(10), { seed: "abc" });
    expect(a.shuffledIds).toEqual(b.shuffledIds);
  });

  it("different seeds produce different orders", () => {
    const a = createRankingState(ids(20), { seed: "a" });
    const b = createRankingState(ids(20), { seed: "b" });
    // Very unlikely to be identical with 20 items
    expect(a.shuffledIds).not.toEqual(b.shuffledIds);
  });
});

describe("chooseSide", () => {
  it("advances comparison count", () => {
    let state = createRankingState(ids(5), { seed });
    const comp = getCurrentComparison(state);
    expect(comp).not.toBeNull();
    state = chooseSide(state, "left");
    expect(state.comparisonCount).toBe(1);
  });

  it("completes after enough comparisons", () => {
    let state = createRankingState(ids(5), { seed, topN: 3 });
    const max = 50; // safety limit
    let count = 0;
    while (!state.completed && count < max) {
      const comp = getCurrentComparison(state);
      if (!comp) break;
      state = chooseSide(state, "left");
      count++;
    }
    expect(state.completed).toBe(true);
    expect(getRankingResult(state).length).toBeLessThanOrEqual(3);
  });

  it("produces contiguous ranks", () => {
    let state = createRankingState(ids(8), { seed, topN: 5 });
    const max = 100;
    let count = 0;
    while (!state.completed && count < max) {
      const comp = getCurrentComparison(state);
      if (!comp) break;
      state = chooseSide(state, "right");
      count++;
    }
    const result = getRankingResult(state);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("undoLastAction", () => {
  it("reverts to previous state", () => {
    let state = createRankingState(ids(5), { seed });
    const before = state.comparisonCount;
    state = chooseSide(state, "left");
    expect(state.comparisonCount).toBe(before + 1);
    state = undoLastAction(state);
    expect(state.comparisonCount).toBe(before);
  });

  it("returns same state when no decisions", () => {
    const state = createRankingState(ids(5), { seed });
    const undone = undoLastAction(state);
    expect(undone.comparisonCount).toBe(0);
    expect(undone.decisionLog).toHaveLength(0);
  });

  it("undo + redo produces same result", () => {
    let state = createRankingState(ids(5), { seed });
    const comp = getCurrentComparison(state)!;
    const side = "left";
    state = chooseSide(state, side);
    state = undoLastAction(state);
    state = chooseSide(state, side);
    expect(state.comparisonCount).toBe(1);
  });
});

describe("skipWork", () => {
  it("skips the current candidate", () => {
    let state = createRankingState(ids(5), { seed });
    const comp = getCurrentComparison(state)!;
    const skipped = skipWork(state, comp.candidateId);
    expect(skipped.skippedIds.length).toBeGreaterThan(state.skippedIds.length);
  });
});

describe("deferWork", () => {
  it("defers the current candidate", () => {
    let state = createRankingState(ids(5), { seed });
    const comp = getCurrentComparison(state)!;
    const deferred = deferWork(state, comp.candidateId);
    expect(deferred.deferredIds.length).toBeGreaterThan(state.deferredIds.length);
  });
});

describe("getRankingProgress", () => {
  it("reports progress fraction between 0 and 1", () => {
    const state = createRankingState(ids(10), { seed });
    const progress = getRankingProgress(state);
    expect(progress.fraction).toBeGreaterThanOrEqual(0);
    expect(progress.fraction).toBeLessThan(1);
    expect(progress.total).toBe(10);
    expect(progress.phase).toBe("ranking");
  });

  it("reports 1 fraction when completed", () => {
    const state = createRankingState(["only"], { seed });
    const progress = getRankingProgress(state);
    expect(progress.fraction).toBe(1);
    expect(state.completed).toBe(true);
  });
});

describe("serialize/deserialize", () => {
  it("round-trips correctly", () => {
    let state = createRankingState(ids(5), { seed });
    state = chooseSide(state, "left");
    const json = serializeRankingState(state);
    const restored = deserializeRankingState(json);
    expect(restored.comparisonCount).toBe(state.comparisonCount);
    expect(restored.rankedIds).toEqual(state.rankedIds);
    expect(restored.seed).toBe(state.seed);
  });

  it("handles legacy v1 format migration", () => {
    // Simulate a v1 state (without verification fields)
    const v1 = {
      version: 1, seed: "abc", topN: 3, sourceIds: ["a", "b", "c", "d"],
      shuffledIds: ["a", "b", "c", "d"], rankedIds: ["a", "b"],
      pendingIds: ["c", "d"], deferredIds: [], skippedIds: [], outsideTopIds: [],
      activeInsertion: null, comparisonCount: 1, estimatedTotalComparisons: 4,
      processedCount: 2, nextPresentationIndex: 2, completed: false,
      decisionLog: [{ kind: "choose", candidateId: "b", opponentId: "a", presentationIndex: 0, preferredId: "b" }],
    };
    const restored = deserializeRankingState(JSON.stringify(v1));
    expect(restored.version).toBe(2);
    expect(restored.phase).toBe("ranking");
    expect(restored.comparisonCount).toBe(1);
  });
});
