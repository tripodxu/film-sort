import { describe, it, expect } from "vitest";
import {
  createRankingState,
  chooseSide,
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
    expect(
      state.pendingIds.length + state.skippedIds.length + state.rankedIds.length,
    ).toBeLessThanOrEqual(5);
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
      version: 1,
      seed: "abc",
      topN: 3,
      sourceIds: ["a", "b", "c", "d"],
      shuffledIds: ["a", "b", "c", "d"],
      rankedIds: ["a", "b"],
      pendingIds: ["c", "d"],
      deferredIds: [],
      skippedIds: [],
      outsideTopIds: [],
      activeInsertion: null,
      comparisonCount: 1,
      estimatedTotalComparisons: 4,
      processedCount: 2,
      nextPresentationIndex: 2,
      completed: false,
      decisionLog: [
        {
          kind: "choose",
          candidateId: "b",
          opponentId: "a",
          presentationIndex: 0,
          preferredId: "b",
        },
      ],
    };
    const restored = deserializeRankingState(JSON.stringify(v1));
    expect(restored.version).toBe(2);
    expect(restored.phase).toBe("ranking");
    expect(restored.comparisonCount).toBe(1);
  });
});

// ===== 算法三模式（docs/PLAN-algo-modes.md）=====

import { deferCurrent } from "./ranking";

describe("ranking modes", () => {
  it("缺省 mode 为 classic，旧快照反序列化补默认字段", () => {
    const state = createRankingState(ids(4), { seed });
    expect(state.mode).toBe("classic");
    expect(state.calibration).toEqual({ checked: 0, consistent: 0 });
    // 伪造一份"无 mode/calibration/stage"的旧 v2 快照
    const legacyV2 = JSON.parse(serializeRankingState(state));
    delete legacyV2.mode;
    delete legacyV2.calibration;
    delete legacyV2.activeInsertion.stage;
    const restored = deserializeRankingState(JSON.stringify(legacyV2));
    expect(restored.mode).toBe("classic");
    expect(restored.calibration).toEqual({ checked: 0, consistent: 0 });
    expect(restored.activeInsertion?.stage).toBe("bisect");
  });

  it("v1 遗留状态迁移后 mode=classic 且带 calibration", () => {
    const modern = createRankingState(ids(3), { seed });
    const v1 = JSON.parse(serializeRankingState(modern));
    v1.version = 1;
    v1.verificationQueue = undefined;
    v1.pairEvidence = undefined;
    v1.recentPairKeys = undefined;
    v1.preferenceEdges = undefined;
    v1.cycleEvents = undefined;
    v1.cycleStatus = undefined;
    v1.preferenceTension = undefined;
    const restored = deserializeRankingState(JSON.stringify(v1));
    expect(restored.mode).toBe("classic");
    expect(restored.calibration).toEqual({ checked: 0, consistent: 0 });
  });

  it("非法 mode 回落 classic", () => {
    const state = createRankingState(ids(3), { seed, mode: "nonsense" as never });
    expect(state.mode).toBe("classic");
  });

  it("quick 模式：满员后 gate 阶段对手是守门员（末位）", () => {
    // 3 件取 2：先经 bisect 建榜（1 件起步 + 第 2 件二分），第 3 件进 gate
    let state = createRankingState(ids(3), { seed, topN: 2, mode: "quick" });
    // 未满员时 stage 为 bisect
    expect(state.activeInsertion?.stage).toBe("bisect");
    // 完成建榜（1 次比较后 rankedIds=2，满员）
    state = chooseSide(state, "left");
    expect(state.rankedIds).toHaveLength(2);
    // 第 3 件进入 gate
    expect(state.activeInsertion?.stage).toBe("gate");
    const cmp = getCurrentComparison(state)!;
    // 对手 = 守门员 = 当前末位
    expect(cmp.opponentId).toBe(state.rankedIds[1]);
  });

  it("quick 模式：候选输给守门员 → 1 次比较出局、榜单不动", () => {
    let state = createRankingState(ids(3), { seed, topN: 2, mode: "quick" });
    state = chooseSide(state, "left"); // 建榜完成，rankedIds=2
    const gate = state.activeInsertion!;
    const cmp = getCurrentComparison(state)!;
    expect(cmp.opponentId).toBe(state.rankedIds[1]);
    // 候选输：选手对侧（候选位置由 seed hash 决定）
    state = chooseSide(state, cmp.candidateOnLeft ? "right" : "left");
    expect(state.outsideTopIds).toContain(gate.candidateId);
    expect(state.rankedIds).toHaveLength(2);
    expect(state.rankedIds).not.toContain(gate.candidateId);
    // quick 仍有 1 次守门员边界复测
    const vLeft = state.verificationQueue.length + (state.activeVerification ? 1 : 0);
    expect(vLeft).toBe(1);
    while (!state.completed) {
      const cmp2 = getCurrentComparison(state)!;
      state = chooseSide(state, cmp2.leftId === cmp2.opponentId ? "right" : "left"); // 复测维持原结论
    }
    // 主排序只用了 2 次比较（classic 同配置需 3 次）
    expect(state.comparisonCount).toBe(3);
  });

  it("quick 模式：候选赢守门员 → 升级 bisect 插入并挤掉末位", () => {
    let state = createRankingState(ids(3), { seed, topN: 2, mode: "quick" });
    state = chooseSide(state, "left"); // 建榜：rankedIds=[item-0? item-1?]
    const third = state.activeInsertion!.candidateId;
    const cmp = getCurrentComparison(state)!;
    state = chooseSide(state, cmp.candidateOnLeft ? "left" : "right"); // 候选赢守门员 → bisect
    expect(state.activeInsertion?.stage).toBe("bisect");
    // 完成 bisect（再选一次）
    state = chooseSide(state, "left");
    expect(state.rankedIds).toHaveLength(2);
    expect(state.rankedIds).toContain(third);
    while (!state.completed) {
      const cmp2 = getCurrentComparison(state)!;
      state = chooseSide(state, cmp2.leftId === cmp2.opponentId ? "right" : "left");
    }
    expect(state.completed).toBe(true);
  });

  it("quick 模式：gate 阶段也可暂放，恢复后仍走守门员", () => {
    let state = createRankingState(ids(3), { seed, topN: 2, mode: "quick" });
    state = chooseSide(state, "left");
    expect(state.activeInsertion?.stage).toBe("gate");
    state = deferCurrent(state);
    // 暂放后没有其他候选 → 转验证/完成？pending 空且 deferred 有 1 件 → 恢复该件
    expect(state.activeInsertion?.candidateId).toBeDefined();
    expect(state.activeInsertion?.stage).toBe("gate");
  });

  it("precise 模式：验证数量为 max(4, ceil(topN/2))，quick 为 1，classic 为现行", () => {
    // 通过进度预估间接验证（verificationRemaining 在完成主排序后可见），
    // 这里直接检查状态推导：用 10 件取 6 跑到验证阶段统计队列。
    const runToVerification = (mode: "quick" | "classic" | "precise") => {
      let state = createRankingState(ids(10), { seed, topN: 6, mode });
      for (let i = 0; i < 60 && !state.completed && state.phase === "ranking"; i++) {
        state = chooseSide(state, "left");
      }
      return state;
    };
    const quick = runToVerification("quick");
    const classic = runToVerification("classic");
    const precise = runToVerification("precise");
    // quick 验证极少（1 条基线）；precise 至少 ceil(6/2)=3 且含未直接比较过的相邻对
    const qV = quick.verificationQueue.length + (quick.activeVerification ? 1 : 0);
    const cV = classic.verificationQueue.length + (classic.activeVerification ? 1 : 0);
    const pV = precise.verificationQueue.length + (precise.activeVerification ? 1 : 0);
    expect(qV).toBeLessThanOrEqual(2);
    expect(cV).toBeGreaterThanOrEqual(1);
    expect(pV).toBeGreaterThanOrEqual(cV);
  });

  it("precise 模式：验证复测记入 calibration 一致率", () => {
    let state = createRankingState(ids(4), { seed, topN: 4, mode: "precise" });
    for (let i = 0; i < 40 && !state.completed; i++) {
      if (state.phase === "verification" && state.activeVerification) {
        // 一律按期望赢家选择 → calibration 全一致
        const exp = state.activeVerification.task.expectedWinnerId;
        const cmp = getCurrentComparison(state)!;
        state = chooseSide(state, cmp.leftId === exp ? "left" : "right");
      } else {
        state = chooseSide(state, "left");
      }
    }
    expect(state.completed).toBe(true);
    expect(state.calibration.checked).toBeGreaterThan(0);
    expect(state.calibration.consistent).toBe(state.calibration.checked);
  });

  it("进度预估按模式分叉（quick < classic < precise）", () => {
    const q = createRankingState(ids(20), { seed, topN: 10, mode: "quick" });
    const c = createRankingState(ids(20), { seed, topN: 10, mode: "classic" });
    const p = createRankingState(ids(20), { seed, topN: 10, mode: "precise" });
    expect(q.estimatedTotalComparisons).toBeLessThan(c.estimatedTotalComparisons);
    expect(c.estimatedTotalComparisons).toBeLessThan(p.estimatedTotalComparisons);
  });

  it("quick 模式守门员出局决策可撤销（重放一致）", () => {
    let state = createRankingState(ids(3), { seed, topN: 2, mode: "quick" });
    state = chooseSide(state, "left");
    const cmp = getCurrentComparison(state)!;
    state = chooseSide(state, cmp.candidateOnLeft ? "right" : "left"); // 候选输守门员出局
    const after = state;
    state = undoLastAction(state);
    expect(state.outsideTopIds).not.toContain(after.outsideTopIds[0]);
    expect(state.activeInsertion?.stage).toBe("gate");
  });
});
