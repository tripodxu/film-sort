import { describe, expect, it } from "vitest";
import { csvCell } from "./index";

/**
 * CSV 导出会被 Excel/Sheets 直接打开：以 = + - @ 或制表/回车开头的单元格
 * 会被当成公式执行（CSV 注入）。这里钉住「前缀单引号强制文本」的行为。
 */
describe("CSV 导出单元格转义", () => {
  it("公式前缀被强制为文本", () => {
    for (const raw of ['=HYPERLINK("http://evil")', "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      const cell = csvCell(raw);
      expect(cell.startsWith("\"'")).toBe(true);
      expect(cell.endsWith('"')).toBe(true);
    }
  });

  it("普通值与双引号按 CSV 规则转义", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell("霸王别姬")).toBe('"霸王别姬"');
  });
});
