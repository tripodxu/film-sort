import { describe, expect, it } from "vitest";
import { computeWrappedCanvasHeight, pickExportScale } from "./exportPng";

/**
 * 画布面积有硬上限（Safari 约 16.7M 像素，超出静默出空白）。
 * 长榜单必须逐档降采样，而不是固定 2x 撑爆画布。
 */
const MAX_AREA = 16_000_000;

describe("PNG 导出画布缩放", () => {
  it("常规尺寸优先 2x", () => {
    expect(pickExportScale(1200, 760)).toBe(2);
  });

  it("长图逐档降采样且不超面积上限", () => {
    for (const h of [2000, 4000, 6000, 10000]) {
      const scale = pickExportScale(1200, h);
      expect(1200 * scale * h * scale).toBeLessThanOrEqual(MAX_AREA);
    }
  });

  it("超长图回落到最小档而不是返回 0", () => {
    expect(pickExportScale(1200, 100_000)).toBe(0.5);
  });

  it("年度报告画布高度覆盖四媒介两行图例与六年代分桶，不与页脚重叠", () => {
    const h = computeWrappedCanvasHeight({
      mediaShareCount: 4,
      decadesCount: 6,
      hasDraft: false,
      itemsCount: 12,
    });
    // 正文末尾 y = 580(页眉+占比) + 208(6年代) + 54 + 480(12条) = 1322；页脚顶线为 H - 56
    expect(h - 56).toBeGreaterThanOrEqual(1322);
  });
});
