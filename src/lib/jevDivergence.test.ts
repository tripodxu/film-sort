// jevDivergence 纯函数单测（node 环境）。
import { describe, expect, it } from "vitest";
import { predictedPositions, topDivergences } from "./jevDivergence";

describe("predictedPositions", () => {
  it("order（预测偏好降序的下标序列）→ 每个下标的预测名次", () => {
    // 预测偏好顺序：下标 3 最爱，其次 0、2、1
    expect(predictedPositions([3, 0, 2, 1], 4)).toEqual(
      new Map([
        [3, 1],
        [0, 2],
        [2, 3],
        [1, 4],
      ]),
    );
  });
  it("越界/缺失/重复下标处理：越界忽略、重复取首个", () => {
    expect(predictedPositions([2, 1, 2, 9, -1], 3)).toEqual(
      new Map([
        [2, 1],
        [1, 2],
      ]),
    );
  });
  it("空 order 得空表", () => {
    expect(predictedPositions([], 5)).toEqual(new Map());
  });
});

describe("topDivergences", () => {
  const items = ["A", "B", "C", "D", "E"].map((title) => ({ title }));
  it("按 |shift| 降序取 Top N；shift = 预测名次 − 真实名次", () => {
    // 预测：C(下标2)最爱 → D → A → E → B
    const order = [2, 3, 0, 4, 1];
    const top = topDivergences(items, order, 3);
    // A：actual 1，predicted 3，shift +2（对方比预测高）
    // B：actual 2，predicted 5，shift +3（对方比预测高）
    // C：actual 3，predicted 1，shift −2（对方比预测低）
    // D：actual 4，predicted 2，shift −2；E：actual 5，predicted 4，shift −1
    expect(top.map((e) => e.item.title)).toEqual(["B", "A", "C"]);
    expect(top[0]).toMatchObject({ actualRank: 2, predictedRank: 5, shift: 3 });
    expect(top[1]).toMatchObject({ actualRank: 1, predictedRank: 3, shift: 2 });
    expect(top[2]).toMatchObject({ actualRank: 3, predictedRank: 1, shift: -2 });
  });
  it("同 |shift| 时对方真实名次靠前者优先", () => {
    const order = [2, 3, 0, 4, 1]; // A/C 都 |shift|=2，A actual 1 < C actual 3 → A 先
    const top = topDivergences(items, order, 2);
    expect(top.map((e) => e.item.title)).toEqual(["B", "A"]);
  });
  it("预测与真实完全一致 → 空数组（零偏差不算出乎意料）", () => {
    expect(topDivergences(items, [0, 1, 2, 3, 4])).toEqual([]);
    expect(topDivergences(items, [4, 3, 2, 1, 0]).length).toBe(3);
  });
  it("order 缺某下标时该作品不计入", () => {
    const top = topDivergences(items, [0, 1, 2, 3], 5); // 下标 4 缺失
    expect(top.map((e) => e.item.title)).not.toContain("E");
  });
});
