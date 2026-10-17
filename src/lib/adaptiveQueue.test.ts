import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_PAIR_COOLDOWN,
  ADAPTIVE_WORK_COOLDOWN,
  coverageDeficit,
  expectedInformation,
  selectAdaptivePair,
  adaptivePairKey,
} from "./adaptiveQueue";
import { createPreferenceModel, recordObservations } from "./preferenceModel";

/** a、b 彼此接近，c 被两人连续击败：a-b 这一对信息量最高。 */
function threeWayModel() {
  let model = createPreferenceModel(["a", "b", "c"]);
  const observations = [];
  for (let round = 0; round < 8; round += 1) {
    observations.push({ winnerId: "a", loserId: "c" });
    observations.push({ winnerId: "b", loserId: "c" });
  }
  model = recordObservations(model, observations);
  return model;
}

function pairKeyOfPair(pair: { leftId: string; rightId: string }): string {
  return adaptivePairKey(pair.leftId, pair.rightId);
}

describe("adaptiveQueue 自适应配对队列", () => {
  it("冷却常量与 ranking.ts 的旧值对齐且本模块只读不改", () => {
    expect(ADAPTIVE_PAIR_COOLDOWN).toBe(3);
    expect(ADAPTIVE_WORK_COOLDOWN).toBe(4);
  });

  it("不足两件作品时返回 null", () => {
    const model = createPreferenceModel(["a"]);
    expect(selectAdaptivePair({ ids: [], model })).toBeNull();
    expect(selectAdaptivePair({ ids: ["a"], model })).toBeNull();
  });

  it("优先选信息量最高的一对，且信息量对称", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({ ids: ["a", "b", "c"], model });
    expect(pair).not.toBeNull();
    expect(pairKeyOfPair(pair!)).toBe(adaptivePairKey("a", "b"));
    expect(pair!.relaxed).toBe("none");
    expect(expectedInformation(model, "a", "c")).toBeCloseTo(
      expectedInformation(model, "c", "a"),
      12,
    );
    expect(pair!.information).toBeGreaterThan(expectedInformation(model, "a", "c"));
  });

  it("覆盖率补偿可以让信息量更低的一对胜出", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({
      ids: ["a", "b", "c"],
      model,
      opponentCounts: { a: 9, b: 9, c: 0 },
      options: { coverageWeight: 3, minOpponents: 1 },
    });
    expect(pair).not.toBeNull();
    expect([pair!.leftId, pair!.rightId]).toContain("c");
    expect(pair!.coverage).toBe(1);
    expect(pair!.reason).toBe("coverage");
  });

  it("作品冷却窗口内的作品不出场", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({ ids: ["a", "b", "c"], model, recentWorkIds: ["a"] });
    expect(pair).not.toBeNull();
    expect([pair!.leftId, pair!.rightId]).not.toContain("a");
    expect(pair!.relaxed).toBe("none");
  });

  it("可行对全被序对冷却挡住时逐级放宽并留下标记", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({
      ids: ["a", "b"],
      model,
      recentPairKeys: [adaptivePairKey("a", "b")],
    });
    expect(pair).not.toBeNull();
    expect(pair!.relaxed).toBe("pair-cooldown");
    expect(pairKeyOfPair(pair!)).toBe(adaptivePairKey("a", "b"));
  });

  it("pairKeyOf 可注入既有实现的键格式", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({
      ids: ["a", "b", "c"],
      model,
      recentPairKeys: ["a~b"],
      pairKeyOf: (a, b) => (a < b ? a + "~" + b : b + "~" + a),
    });
    expect(pair).not.toBeNull();
    expect([pair!.leftId, pair!.rightId].sort().join("~")).not.toBe("a~b");
  });

  it("同一输入两次调用结果完全一致（确定性）", () => {
    const model = threeWayModel();
    const input = { ids: ["a", "b", "c"], model, recentWorkIds: ["c"] };
    expect(JSON.stringify(selectAdaptivePair(input))).toBe(
      JSON.stringify(selectAdaptivePair(input)),
    );
  });

  it("左侧是能力值更高的一方", () => {
    const model = threeWayModel();
    const pair = selectAdaptivePair({ ids: ["a", "b", "c"], model });
    expect(pair!.leftId).toBe("a");
    expect(pair!.rightId).toBe("b");
  });

  it("coverageDeficit 只在低于下限时为正", () => {
    expect(coverageDeficit("a", { a: 0 }, 1)).toBe(1);
    expect(coverageDeficit("a", { a: 2 }, 1)).toBe(0);
    expect(coverageDeficit("missing", {}, 3)).toBe(3);
  });
});
