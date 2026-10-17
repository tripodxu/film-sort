import { describe, expect, it } from "vitest";
import {
  RANKING_MODES,
  choosePreferred,
  createRankingState,
  deserializeRankingState,
  getCurrentComparison,
  getRankingResult,
  serializeRankingState,
  skipWork,
  deferWork,
  undoLastAction,
  type RankingMode,
  type RankingState,
} from "./ranking";
import {
  ADAPTIVE_COMPARISONS_PER_ITEM,
  adaptiveComparisonBudget,
  adaptivePairKey,
  adaptivePoolIds,
  buildAdaptiveModel,
  getAdaptiveOrder,
  getAdaptivePairInsight,
} from "./adaptiveRanking";
import { fitPreferenceModel, getPreferenceOrder } from "./preferenceModel";

// 固定剧本：12 件作品 + 一个「真实」偏好顺序，规则=总选真实名次更高者。
// 旧三模式的 golden 数字是 S2 改动前实测值（见 docs/PLAN-ADDITIVE-UPGRADE.md §10），
// 用来钉住「接入 adaptive 不改旧模式任何一个决定」。
const IDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
const TRUE_ORDER = ["d", "a", "k", "c", "h", "b", "e", "j", "f", "i", "l", "g"];
const rank = (id: string) => TRUE_ORDER.indexOf(id);

const GOLDEN: Record<string, { ranked: string[]; comparisons: number }> = {
  quick: { ranked: ["d", "a", "k", "c", "h"], comparisons: 24 },
  classic: { ranked: ["d", "a", "k", "c", "h"], comparisons: 26 },
  precise: { ranked: ["d", "a", "k", "c", "h"], comparisons: 28 },
};
const GOLDEN_TRACE_HEAD = [
  "d>e:d|ranking",
  "i>e:e|ranking",
  "j>e:e|ranking",
  "j>i:j|ranking",
  "k>j:k|ranking",
  "k>e:k|ranking",
];

function run(mode: RankingMode, steps = 500): { state: RankingState; trace: string[] } {
  let state = createRankingState(IDS, { seed: "golden-1", topN: 5, mode });
  const trace: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const comparison = getCurrentComparison(state);
    if (!comparison) break;
    const preferred =
      rank(comparison.leftId) < rank(comparison.rightId) ? comparison.leftId : comparison.rightId;
    trace.push(
      comparison.candidateId +
        ">" +
        comparison.opponentId +
        ":" +
        preferred +
        "|" +
        comparison.phase,
    );
    state = choosePreferred(state, preferred);
  }
  return { state, trace };
}

describe("adaptive 模式：不影响旧三模式（golden 回归）", () => {
  it("RANKING_MODES 前三项顺序不变，adaptive 只在末位", () => {
    expect(RANKING_MODES.slice(0, 3)).toEqual(["quick", "classic", "precise"]);
    expect(RANKING_MODES[3]).toBe("adaptive");
  });

  it.each(["quick", "classic", "precise"] as const)("%s 的排名与比较次数逐字不变", (mode) => {
    const { state, trace } = run(mode);
    expect(getRankingResult(state)).toEqual(GOLDEN[mode].ranked);
    expect(state.comparisonCount).toBe(GOLDEN[mode].comparisons);
    expect(trace.slice(0, 6)).toEqual(GOLDEN_TRACE_HEAD);
    expect(state.completed).toBe(true);
  });

  it("旧三模式从不写 activeInsertion.opponentId（不走进 adaptive 分支）", () => {
    for (const mode of ["quick", "classic", "precise"] as const) {
      let state = createRankingState(IDS, { seed: "golden-1", topN: 5, mode });
      for (let index = 0; index < 8; index += 1) {
        const comparison = getCurrentComparison(state);
        if (!comparison) break;
        expect(state.activeInsertion?.opponentId).toBeUndefined();
        const preferred =
          rank(comparison.leftId) < rank(comparison.rightId)
            ? comparison.leftId
            : comparison.rightId;
        state = choosePreferred(state, preferred);
      }
    }
  });
});

describe("adaptive 模式：结果质量与自洽", () => {
  it("预算 = clamp(n*4, n-1, 全部序对)", () => {
    expect(ADAPTIVE_COMPARISONS_PER_ITEM).toBe(4);
    expect(adaptiveComparisonBudget(0)).toBe(0);
    expect(adaptiveComparisonBudget(1)).toBe(0);
    // n=2 只有 1 个序对，预算被 clamp 到 n-1=1（不是 2）。
    expect(adaptiveComparisonBudget(2)).toBe(1);
    expect(adaptiveComparisonBudget(3)).toBe(3);
    expect(adaptiveComparisonBudget(12)).toBe(48);
    expect(adaptiveComparisonBudget(100)).toBe(400);
  });

  it("12 件清单跑完：Top 5 与真实一致，全序也一致", () => {
    const { state } = run("adaptive");
    expect(getRankingResult(state)).toEqual(["d", "a", "k", "c", "h"]);
    expect(getAdaptiveOrder(state)).toEqual(TRUE_ORDER);
    expect(state.phase).toBe("complete");
    expect(state.completed).toBe(true);
    expect(state.processedCount).toBe(IDS.length);
  });

  it("比较 24 次时 Top 5 已全中（预算的一半）", () => {
    const { state } = run("adaptive", 24);
    const order = getAdaptiveOrder(state);
    const hits = order.slice(0, 5).filter((id) => TRUE_ORDER.slice(0, 5).includes(id));
    expect(hits.length).toBe(5);
    expect(order[0]).toBe("d");
  });

  it("确定性：同 seed 同剧本两次跑出同一状态；撤销=重放", () => {
    const first = run("adaptive", 6);
    const second = run("adaptive", 6);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    const undone = undoLastAction(second.state);
    expect(JSON.stringify(undone)).toBe(JSON.stringify(run("adaptive", 5).state));
  });

  it("序列化往返一致，且不新增任何持久化字段", () => {
    const adaptive = run("adaptive", 20).state;
    expect(deserializeRankingState(serializeRankingState(adaptive))).toEqual(adaptive);
    const keys = (state: RankingState) =>
      Object.keys(JSON.parse(serializeRankingState(state)) as object).sort();
    expect(keys(adaptive)).toEqual(keys(run("classic", 5).state));
  });

  it("最后一对的名次区间与信息量可读，且剩余次数随预算递减", () => {
    const fresh = createRankingState(IDS, { seed: "golden-1", topN: 5, mode: "adaptive" });
    const comparison = getCurrentComparison(fresh)!;
    const insight = getAdaptivePairInsight(fresh, comparison.leftId, comparison.rightId);
    expect(insight.left).not.toBeNull();
    expect(insight.right).not.toBeNull();
    expect(insight.remaining).toBe(48);
    expect(insight.informative).toBe(true);
    expect(insight.left!.low).toBeLessThanOrEqual(insight.left!.rankEstimate);
    expect(insight.left!.high).toBeGreaterThanOrEqual(insight.left!.rankEstimate);
    expect(insight.left!.width).toBe(insight.left!.high - insight.left!.low);
    const later = getAdaptivePairInsight(
      run("adaptive", 10).state,
      getCurrentComparison(run("adaptive", 10).state)!.leftId,
      getCurrentComparison(run("adaptive", 10).state)!.rightId,
    );
    expect(later.remaining).toBe(38);
  });
});

describe("adaptive 模式：略过/暂放与冷却", () => {
  it("略过对手：该作品出池、榜单不变、下一对换人", () => {
    const middle = run("adaptive", 3).state;
    const comparison = getCurrentComparison(middle)!;
    const next = skipWork(middle, comparison.opponentId);
    expect(next.skippedIds).toContain(comparison.opponentId);
    expect(adaptivePoolIds(next)).not.toContain(comparison.opponentId);
    // 略过会把作品移出池子，模型随之重算——榜单本来就会变（自适应模式的设计行为，
    // 不像 classic 那样 rankedIds 是固定插入序）。这里只钉住「池子变小 + 决策入日志 + 下一对换人」。
    expect(next.decisionLog.length).toBe(middle.decisionLog.length + 1);
    expect(next.decisionLog[next.decisionLog.length - 1]!.kind).toBe("skip");
    const after = getCurrentComparison(next)!;
    expect(after.candidateId + ">" + after.opponentId).toBe("f>g");
  });

  it("暂放候选：名单与池子都不变，只是先避开它", () => {
    const middle = run("adaptive", 3).state;
    const comparison = getCurrentComparison(middle)!;
    const next = deferWork(middle, comparison.candidateId);
    expect(next.deferredIds).toContain(comparison.candidateId);
    expect(adaptivePoolIds(next)).toContain(comparison.candidateId);
    expect(getRankingResult(next)).toEqual(getRankingResult(middle));
  });

  it("冷却键与 ranking.ts 同款（\\u0000 分隔），顺序无关", () => {
    expect(adaptivePairKey("b", "a")).toBe("a\u0000b");
    expect(adaptivePairKey("a", "b")).toBe(adaptivePairKey("b", "a"));
  });
});

describe("batch fit（fitPreferenceModel）", () => {
  it("与观测顺序无关：打乱观测后名次完全一致", () => {
    const observations = [
      { winnerId: "a", loserId: "b" },
      { winnerId: "a", loserId: "c" },
      { winnerId: "b", loserId: "c" },
      { winnerId: "c", loserId: "d" },
      { winnerId: "a", loserId: "d" },
      { winnerId: "b", loserId: "d" },
    ];
    const straight = fitPreferenceModel(IDS, observations);
    const shuffled = fitPreferenceModel(IDS, [...observations].reverse());
    expect(getPreferenceOrder(shuffled)).toEqual(getPreferenceOrder(straight));
    // 无观测的作品 θ=0，会排在被观测的负 θ 作品之前（先验收缩的正常结果），
    // 所以只断言「被观测四件的相对顺序」，不断言全局前四。
    const observed = getPreferenceOrder(straight).filter((id) => ["a", "b", "c", "d"].includes(id));
    expect(observed).toEqual(["a", "b", "c", "d"]);
  });

  it("证据越多名次区间越窄，σ 不超过 options 上限", () => {
    const observations = Array.from({ length: 12 }, () => ({ winnerId: "a", loserId: "b" }));
    const model = fitPreferenceModel(IDS, observations);
    expect(model.ratings.a.theta).toBeGreaterThan(0);
    expect(model.ratings.b.theta).toBeLessThan(0);
    expect(model.ratings.a.sigma).toBeLessThanOrEqual(2);
    expect(model.ratings.a.sigma).toBeGreaterThan(0);
  });

  it("buildAdaptiveModel 只用池内观测，池外/复测决策不计入", () => {
    const state = run("adaptive", 12).state;
    const model = buildAdaptiveModel(state);
    expect(Object.keys(model.ratings).sort()).toEqual([...IDS].sort());
    expect(model.comparisons).toBe(state.decisionLog.filter((d) => d.kind === "choose").length);
  });
});
