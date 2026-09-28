import { describe, expect, it } from "vitest";
import { SWIPE_THRESHOLD, decideSwipe } from "./swipe";

describe("decideSwipe", () => {
  it("水平位移过阈值 → 对应方向", () => {
    expect(decideSwipe(-80, 4)).toBe("left");
    expect(decideSwipe(80, -6)).toBe("right");
  });
  it("恰好达到阈值也算有效", () => {
    expect(decideSwipe(-SWIPE_THRESHOLD, 0)).toBe("left");
    expect(decideSwipe(SWIPE_THRESHOLD, 0)).toBe("right");
  });
  it("位移不足阈值 → null(回弹,不选择)", () => {
    expect(decideSwipe(-40, 0)).toBeNull();
    expect(decideSwipe(55, 30)).toBeNull();
  });
  it("垂直意图主导 → null(滚动不受扰)", () => {
    expect(decideSwipe(30, 90)).toBeNull();
    expect(decideSwipe(-90, 120)).toBeNull();
  });
  it("对角线但水平占优 → 按水平判定", () => {
    expect(decideSwipe(-100, 40)).toBe("left");
    expect(decideSwipe(100, -40)).toBe("right");
  });
  it("零位移 → null", () => {
    expect(decideSwipe(0, 0)).toBeNull();
  });
});
