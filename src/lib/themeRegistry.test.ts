import { describe, expect, it } from "vitest";
import { parseThemePackage, THEME_PACKAGE_LIMIT, type ParseResult } from "./themeRegistry";

/** 窄化断言：result 必须失败且 error 等于期望值（可选校验 detail 包含）。 */
function expectFail(result: ParseResult, error: string, detailContains?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(error);
  if (detailContains) expect(result.detail).toContain(detailContains);
}

// 存储与 <style> 注入依赖浏览器环境（localStorage/document），在部署后的浏览器
// smoke 中验收；这里全覆盖安全核心——解析与校验（纯函数）。

// 合法包模板：纸上擂台配色（paper id 留给内置主题，自定义包用 paper-demo）。
const VALID_PACKAGE = `/*! art-rank-theme {"id":"paper-demo","name":{"zh":"纸上擂台","en":"Paper Arena"},"dot":["#F2EDE3","#D33A2C"]} */
[data-theme="paper-demo"]{
  --bg:#F2EDE3;--text:#171310;--text-2:#4A423A;--text-3:#8B8175;--muted:#8B8175;
  --accent:#A82A1E;--accent-2:#D33A2C;--accent-ink:#FBF8F1;
  --line:#D9D0BF;--border-2:#C9BFA9;--surface:#E8E1D3;--surface-2:#E0D8C6;--surface-3:#FBF8F1;--surface-hover:#EFE8D8;
  --film:#A82A1E;--book:#B08528;--music:#3E6B4A;--other:#27405C;
  --scrim:rgba(23,19,16,.5);--toast-bg:#FBF8F1;--toast-ink:#171310;
}`;

describe("parseThemePackage 校验器", () => {
  it("合法包通过并产出重建的受控 CSS（用户原文不进 DOM）", () => {
    const result = parseThemePackage(VALID_PACKAGE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe("paper-demo");
    expect(result.theme.name.zh).toBe("纸上擂台");
    expect(result.theme.css).toBe(
      '[data-theme="paper-demo"]{--bg:#F2EDE3;--text:#171310;--text-2:#4A423A;--text-3:#8B8175;--muted:#8B8175;' +
        "--accent:#A82A1E;--accent-2:#D33A2C;--accent-ink:#FBF8F1;--line:#D9D0BF;--border-2:#C9BFA9;" +
        "--surface:#E8E1D3;--surface-2:#E0D8C6;--surface-3:#FBF8F1;--surface-hover:#EFE8D8;" +
        "--film:#A82A1E;--book:#B08528;--music:#3E6B4A;--other:#27405C;" +
        "--scrim:rgba(23,19,16,.5);--toast-bg:#FBF8F1;--toast-ink:#171310}",
    );
  });

  it("缺元数据 / 元数据 JSON 坏 / id 格式非法 → 拒绝", () => {
    expectFail(parseThemePackage('[data-theme="x"]{--bg:#000}'), "meta_missing");
    expectFail(
      parseThemePackage('/*! art-rank-theme {"id": 1} */\n[data-theme="x"]{}'),
      "meta_invalid",
    );
    expectFail(
      parseThemePackage(
        '/*! art-rank-theme {"id":"1bad","name":{"zh":"x","en":"x"},"dot":["#000","#fff"]} */\n[data-theme="1bad"]{}',
      ),
      "meta_invalid",
    );
  });

  it("id 撞内置主题 → id_conflict", () => {
    expectFail(
      parseThemePackage(
        '/*! art-rank-theme {"id":"retro","name":{"zh":"冒牌","en":"Fake"},"dot":["#000","#fff"]} */\n[data-theme="retro"]{--bg:#000}',
      ),
      "id_conflict",
    );
  });

  it("必需变量缺失 → 指出缺失清单", () => {
    const result = parseThemePackage(
      '/*! art-rank-theme {"id":"half","name":{"zh":"半主题","en":"Half"},"dot":["#000","#fff"]} */\n[data-theme="half"]{--bg:#000;--text:#fff}',
    );
    expectFail(result, "var_required_missing", "--accent");
  });

  it("未知变量 → var_unknown（白名单 = :root 全集）", () => {
    const good = VALID_PACKAGE.split("{")[1].split("}")[0];
    const result = parseThemePackage(
      `/*! art-rank-theme {"id":"evil","name":{"zh":"x","en":"x"},"dot":["#000","#fff"]} */\n[data-theme="evil"]{--not-a-var:red;${good}}`,
    );
    expectFail(result, "var_unknown");
  });

  it("值里的逃逸尝试全部拒绝：} 破坏、@import、外链 url(、括号不平衡、坏字符", () => {
    const meta =
      '/*! art-rank-theme {"id":"evil","name":{"zh":"x","en":"x"},"dot":["#000","#fff"]} */';
    const good = VALID_PACKAGE.split("{")[1].split("}")[0];
    // } 提前闭合声明块 → 块内只剩 --bg，按「必需缺失」拒绝（不产生任何注入）
    const escapeAttempt = parseThemePackage(
      `${meta}\n[data-theme="evil"]{--bg:#000;} body{display:none}`,
    );
    expectFail(escapeAttempt, "var_required_missing");
    // url( 外链
    expect(
      parseThemePackage(
        `${meta}\n[data-theme="evil"]{--bg:url(https://evil.example/x.png);${good}}`,
      ).ok,
    ).toBe(false);
    // 括号不平衡
    expect(parseThemePackage(`${meta}\n[data-theme="evil"]{--bg:rgba(0,0,0,.5;${good}}`).ok).toBe(
      false,
    );
    // 值里的坏字符（<script 形态）
    expect(parseThemePackage(`${meta}\n[data-theme="evil"]{--bg:red<${good}}`).ok).toBe(false);
  });

  it("声明块缺失 / 超限 / 空包拒绝", () => {
    expectFail(
      parseThemePackage(
        '/*! art-rank-theme {"id":"noblock","name":{"zh":"x","en":"x"},"dot":["#000","#fff"]} */',
      ),
      "block_missing",
    );
    expect(parseThemePackage("   ").ok).toBe(false);
    const huge = `${VALID_PACKAGE}\n${"/* ".padEnd(THEME_PACKAGE_LIMIT + 10, "x")} */`;
    expectFail(parseThemePackage(huge), "too_large");
  });

  it("重复声明同一变量 → 拒绝（防覆盖歧义）", () => {
    const good = VALID_PACKAGE.split("{")[1].split("}")[0];
    const result = parseThemePackage(
      `/*! art-rank-theme {"id":"dup","name":{"zh":"x","en":"x"},"dot":["#000","#fff"]} */\n[data-theme="dup"]{--bg:#000;--bg:#111;${good}}`,
    );
    expectFail(result, "value_invalid");
  });
});
