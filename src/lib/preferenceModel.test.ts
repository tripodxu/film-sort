import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCE_OPTIONS,
  createPreferenceModel,
  expectedWinProbability,
  getPreferenceOrder,
  getPreferenceRating,
  getRankInterval,
  getRankIntervals,
  normalQuantile,
  recordObservation,
  recordObservations,
} from "./preferenceModel";

describe("preferenceModel 在线 BT 能力模型", () => {
  it("createPreferenceModel 用先验初始化每件作品并去重", () => {
    const model = createPreferenceModel(["a", "b", "a"]);
    expect(model.order).toEqual(["a", "b"]);
    expect(model.comparisons).toBe(0);
    expect(getPreferenceRating(model, "a")).toMatchObject({
      theta: 0,
      variance: 1,
      sigma: 1,
      wins: 0,
      losses: 0,
    });
  });

  it("recordObservation 不可变：入参 state 一个字节都不改", () => {
    const model = createPreferenceModel(["a", "b"]);
    const before = JSON.stringify(model);
    const next = recordObservation(model, "a", "b");
    expect(JSON.stringify(model)).toBe(before);
    expect(next).not.toBe(model);
    expect(next.comparisons).toBe(1);
  });

  it("胜者 theta 上移、败者下移，双方不确定度下降", () => {
    const next = recordObservation(createPreferenceModel(["a", "b"]), "a", "b");
    const winner = getPreferenceRating(next, "a");
    const loser = getPreferenceRating(next, "b");
    expect(winner!.theta).toBeGreaterThan(0);
    expect(loser!.theta).toBeLessThan(0);
    expect(winner!.variance).toBeLessThan(1);
    expect(loser!.variance).toBeLessThan(1);
    expect(winner!.wins).toBe(1);
    expect(loser!.losses).toBe(1);
  });

  it("从对称先验出发的首个观测均值守恒（p = 0.5 的对称性）", () => {
    const next = recordObservation(createPreferenceModel(["a", "b"]), "a", "b");
    expect(
      getPreferenceRating(next, "a")!.theta + getPreferenceRating(next, "b")!.theta,
    ).toBeCloseTo(0, 10);
  });

  it("同一结果反复出现时边际更新严格递减、名次差单调拉大、sigma 单调收窄", () => {
    let model = createPreferenceModel(["a", "b"]);
    const thetas: number[] = [];
    const gaps: number[] = [];
    const sigmas: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      model = recordObservation(model, "a", "b");
      const a = getPreferenceRating(model, "a")!;
      const b = getPreferenceRating(model, "b")!;
      thetas.push(a.theta);
      gaps.push(a.theta - b.theta);
      sigmas.push(a.sigma);
    }
    const deltas = thetas.map((theta, index) => (index === 0 ? theta : theta - thetas[index - 1]));
    expect(deltas[0]).toBeGreaterThan(0);
    // 前 7 轮（有效信息期）边际步长严格递减
    for (let i = 1; i <= 6; i += 1) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    }
    // 第 8 轮起对手已塌陷，每轮更新都是负的（先验回收），幅度不再严格单调
    for (let i = 7; i < deltas.length; i += 1) {
      expect(deltas[i]).toBeLessThan(0);
    }
    // 令对手塌陷后这场胜利不再提供信息，先验把胜者缓缓拉回 0；名次差不受影响。
    // 这是有意行为（见模块头注释的分离情形），不是回归。
    expect(thetas[6]).toBeGreaterThan(thetas[0]);
    expect(thetas[6]).toBeGreaterThan(thetas[19]);
    expect(deltas[19]).toBeLessThan(0);
    expect(thetas[19]).toBeGreaterThan(0);
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    }
    for (let i = 1; i < sigmas.length; i += 1) {
      expect(sigmas[i]).toBeLessThan(sigmas[i - 1]);
    }
    expect(getPreferenceRating(model, "a")!.variance).toBeGreaterThanOrEqual(
      DEFAULT_PREFERENCE_OPTIONS.minVariance,
    );
  });

  it("自发比较不产生任何变化", () => {
    const model = createPreferenceModel(["a"]);
    expect(recordObservation(model, "a", "a")).toBe(model);
    expect(recordObservation(model, "a", "a").comparisons).toBe(0);
  });

  it("未知 id 惰性注册，不抛错", () => {
    const next = recordObservation(createPreferenceModel([]), "x", "y");
    expect(next.order).toEqual(["x", "y"]);
    expect(next.comparisons).toBe(1);
  });

  it("expectedWinProbability 互补且中点对称", () => {
    expect(expectedWinProbability(0, 0)).toBeCloseTo(0.5, 12);
    expect(expectedWinProbability(1.3, -0.4) + expectedWinProbability(-0.4, 1.3)).toBeCloseTo(
      1,
      12,
    );
  });

  it("normalQuantile 对常见置信水平返回标准值", () => {
    expect(normalQuantile(0.95)).toBeCloseTo(1.6449, 3);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 3);
  });

  it("名次区间与实力序一致且恒含点估计名次", () => {
    let model = createPreferenceModel(["a", "b", "c"]);
    model = recordObservations(model, [
      { winnerId: "a", loserId: "b" },
      { winnerId: "a", loserId: "c" },
      { winnerId: "b", loserId: "c" },
    ]);
    const rows = getRankIntervals(model);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].rankEstimate).toBeLessThan(rows[1].rankEstimate);
    expect(rows[1].rankEstimate).toBeLessThan(rows[2].rankEstimate);
    expect(rows[0].rankEstimate).toBeLessThan(2);
    for (const row of rows) {
      expect(row.low).toBeGreaterThanOrEqual(1);
      expect(row.high).toBeLessThanOrEqual(3);
      expect(row.low).toBeLessThanOrEqual(row.rank);
      expect(row.rank).toBeLessThanOrEqual(row.high);
      expect(row.width).toBe(row.high - row.low);
    }
    expect(getPreferenceOrder(model)).toEqual(["a", "b", "c"]);
    expect(getRankInterval(model, "a")!.low).toBe(1);
    expect(getRankInterval(model, "missing")).toBeNull();
  });

  it("连胜/连败到分离时名次区间收敛为确定名次（有意行为）", () => {
    let model = createPreferenceModel(["a", "b", "c"]);
    const observations = [];
    for (let round = 0; round < 12; round += 1) {
      observations.push(
        { winnerId: "a", loserId: "b" },
        { winnerId: "a", loserId: "c" },
        { winnerId: "b", loserId: "c" },
      );
    }
    model = recordObservations(model, observations);
    const rows = getRankIntervals(model);
    expect(getPreferenceOrder(model)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({ rank: 1, low: 1, high: 1 });
    expect(rows[1]).toMatchObject({ rank: 2, low: 2, high: 2 });
    expect(rows[2]).toMatchObject({ rank: 3, low: 3, high: 3 });
  });

  it("全平局时全员名次相同且区间跨越中点", () => {
    const rows = getRankIntervals(createPreferenceModel(["a", "b", "c"]));
    expect(rows.every((row) => row.rank === 2)).toBe(true);
    expect(rows.every((row) => row.low === 1 && row.high === 3)).toBe(true);
  });

  it("置信水平越高区间越宽", () => {
    const model = recordObservations(createPreferenceModel(["a", "b", "c", "d"]), [
      { winnerId: "a", loserId: "b" },
    ]);
    const narrow = getRankInterval(model, "a", { level: 0.5 });
    const wide = getRankInterval(model, "a", { level: 0.99 });
    expect(wide!.width).toBeGreaterThanOrEqual(narrow!.width);
  });

  it("单件作品的名次区间塌缩到 1..1，空模型不抛错", () => {
    const single = getRankIntervals(createPreferenceModel(["only"]));
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ rank: 1, low: 1, high: 1, width: 0 });
    const empty = createPreferenceModel();
    expect(getRankIntervals(empty)).toEqual([]);
    expect(getPreferenceOrder(empty)).toEqual([]);
  });
});
