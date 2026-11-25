import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseThemePackage } from "./themeRegistry";
import { THEME_TEMPLATE, THEME_TEMPLATE_ID } from "./themeTemplate";

describe("主题导入示例模板", () => {
  it("示例模板必须能原样通过导入校验", () => {
    const result = parseThemePackage(THEME_TEMPLATE);
    expect(result.ok ? result : (result as { error: string; detail?: string })).toEqual(
      expect.objectContaining({ ok: true }),
    );
    if (!result.ok) return;
    expect(result.theme.id).toBe(THEME_TEMPLATE_ID);
    expect(result.theme.dot).toEqual(["#0b0d10", "#d8f86a"]);
  });

  it("用户只改 id 时仍可导入（id 与声明块同步替换）", () => {
    const renamed = THEME_TEMPLATE.replaceAll(THEME_TEMPLATE_ID, "night-ink");
    expect(parseThemePackage(renamed).ok).toBe(true);
  });

  it("用户删掉必需变量时给出缺失清单，而不是笼统失败", () => {
    const stripped = THEME_TEMPLATE.replace(/\n\s*--accent-ink:[^;]+;/, "");
    const result = parseThemePackage(stripped);
    expect(result).toEqual({
      ok: false,
      error: "var_required_missing",
      detail: "--accent-ink",
    });
  });

  it("导入弹窗的填入与复制都使用同一份模板", () => {
    const source = readFileSync("src/components/ThemeImportDialog.tsx", "utf8");
    expect(source).toMatch(/import \{ THEME_TEMPLATE \} from "\.\.\/lib\/themeTemplate"/);
    expect(source.match(/THEME_TEMPLATE/g)?.length).toBe(3);
  });
});
