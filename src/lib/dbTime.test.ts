import { describe, expect, it } from "vitest";
import { parseDbTime } from "./dbTime";

describe("parseDbTime — D1 混合时间格式统一按 UTC 解析", () => {
  it("space 格式（CURRENT_TIMESTAMP）按 UTC 解析，不被本地时区吞噬", () => {
    const got = parseDbTime("2026-09-19 16:58:23");
    expect(got.getTime()).toBe(Date.UTC(2026, 8, 19, 16, 58, 23));
  });

  it("space 格式带毫秒也能解析", () => {
    expect(parseDbTime("2026-10-29 16:26:00").getTime()).toBe(Date.UTC(2026, 9, 29, 16, 26));
  });

  it("ISO 带 Z 原样解析（edits/last_edited_at 通道）", () => {
    expect(parseDbTime("2026-10-29T16:37:59.646Z").getTime()).toBe(
      Date.UTC(2026, 9, 29, 16, 37, 59, 646),
    );
  });

  it("行为锚点：同一天 「8 小时前」类相对时间不再漂移（16:26Z 距 00:26+8h 本地恰好 8 小时）", () => {
    const now = Date.UTC(2026, 9, 30, 0, 26, 0);
    const diffHours = (now - parseDbTime("2026-10-29 16:26:00").getTime()) / 3_600_000;
    expect(diffHours).toBeCloseTo(8, 5);
  });
});
