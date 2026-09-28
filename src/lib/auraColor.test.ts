import { describe, expect, it } from "vitest";
import { pickAuraColor } from "./auraColor";

/** 造一张 w×h 的单色 RGBA 图。 */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return data;
}

describe("pickAuraColor 像素数学", () => {
  it("纯色饱和图返回该色（红色海报）", () => {
    expect(pickAuraColor(solid(8, 8, 220, 40, 30))).toBe("#dc281e");
  });

  it("绿色海报返回绿色系", () => {
    const hex = pickAuraColor(solid(8, 8, 40, 160, 90));
    expect(hex).toBe("#28a05a");
  });

  it("全透明图返回 null", () => {
    expect(pickAuraColor(solid(8, 8, 200, 50, 50, 0))).toBeNull();
  });

  it("近灰图（低饱和）返回 null → CSS 降级维度色", () => {
    expect(pickAuraColor(solid(8, 8, 120, 118, 122))).toBeNull();
  });

  it("近黑/近白图返回 null", () => {
    expect(pickAuraColor(solid(8, 8, 10, 12, 11))).toBeNull();
    expect(pickAuraColor(solid(8, 8, 245, 246, 245))).toBeNull();
  });

  it("双色对峙（红/青 50/50）返回 null —— 宁可降级也不掷硬币", () => {
    // 各占 50%，色相分桶确定（红 → 桶 0，青 → 桶 6），得分持平触发 margin 守卫。
    // 不用 12 色环构造：HSL→RGB→hue 往返的舍入会把相邻色挤进同一桶，分布不确定。
    const size = 10;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const red = i % 2 === 0;
      data[i * 4] = red ? 255 : 0;
      data[i * 4 + 1] = red ? 0 : 255;
      data[i * 4 + 2] = red ? 0 : 255;
      data[i * 4 + 3] = 255;
    }
    expect(pickAuraColor(data)).toBeNull();
  });

  it("大面积红 + 小面积蓝噪点 → 红色胜出", () => {
    const size = 10;
    const data = solid(size, size, 200, 30, 30);
    // 右上角 2×2 蓝色噪点（4%）
    for (const [x, y] of [
      [8, 0],
      [9, 0],
      [8, 1],
      [9, 1],
    ]) {
      const i = (y * size + x) * 4;
      data[i] = 30;
      data[i + 1] = 60;
      data[i + 2] = 200;
    }
    expect(pickAuraColor(data)).toBe("#c81e1e");
  });
});
