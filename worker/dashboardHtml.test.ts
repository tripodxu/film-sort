import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DASHBOARD_HTML, DASHBOARD_JS } from "./dashboardHtml";

/**
 * 后台看板脚本已外置到 `/admin/app.js`（2026-10-29 严格 CSP 批）：
 * - HTML 里不再有内联 <script> 或内联事件（onclick/onkeydown/...），
 *   统一用 data-act / data-change / data-enter + 事件委托。
 * - DASHBOARD_JS 仍是模板字面量：任何想在「浏览器内层 JS 字符串」里出现的
 *   引号都必须写成 \\'（模板会吃掉一层反斜杠）。写 \' 的结果是产出 '' 相邻字符串
 *   ——整个脚本语法错误，doLogin 等全部函数未定义，登录按钮无响应
 *   （2026-09-25 生产事故：版本 2992c8c3 无法登录、70e8cdbf 可以，即此因）。
 * 本测试对脚本做语法检查，并锁死「禁止内联脚本/内联事件」这一 CSP 前提。
 */
describe("后台看板脚本外置与严格 CSP 前提", () => {
  it("外置脚本必须能通过语法解析", () => {
    expect(() => new Function(DASHBOARD_JS)).not.toThrow();
  });

  it("HTML 只通过 src 引入脚本，且没有任何内联事件处理器", () => {
    const inlineScripts = [...DASHBOARD_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inlineScripts).toHaveLength(0);
    expect(DASHBOARD_HTML).toContain('<script src="/admin/app.js">');
    expect(DASHBOARD_HTML).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("登录按钮与事件委托在位", () => {
    expect(DASHBOARD_JS).toContain("function doLogin");
    expect(DASHBOARD_HTML).toContain('data-act="login"');
    expect(DASHBOARD_JS).toContain("document.addEventListener('click'");
    expect(DASHBOARD_JS).toContain("document.addEventListener('keydown'");
  });

  it("看板内联的 dbTime 与前端同口径（space 格式按 UTC，ISO 原样）", () => {
    // 看板是外置脚本字符串，import 不进 src/lib/dbTime.ts，只能复刻一份；
    // 这里把复刻实现揪出来跑，防止两边判定分叉（2026-10-30 的 +8h 漂移就是这类分叉）。
    const line = DASHBOARD_JS.split("\n").find((l) => l.startsWith("function dbTime("));
    expect(line, "DASHBOARD_JS 缺少 dbTime 辅助函数").toBeTruthy();
    const dbTime = new Function(`${line}; return dbTime;`)() as (v: unknown) => Date;
    expect(dbTime("2026-09-19 16:58:23").getTime()).toBe(Date.UTC(2026, 8, 19, 16, 58, 23));
    expect(dbTime("2026-10-29T16:37:59.646Z").getTime()).toBe(
      Date.UTC(2026, 9, 29, 16, 37, 59, 646),
    );
  });

  it("库里时间一律走 dbTime，不再裸 new Date(..._at)", () => {
    const bare = [
      ...DASHBOARD_JS.matchAll(
        /new Date\([a-zA-Z]+\.(created_at|updated_at|last_edited_at|profile_updated_at)\)/g,
      ),
    ];
    expect(bare.map((m) => m[0])).toEqual([]);
  });

  it("后台 CSP 禁止内联脚本与内联事件属性", () => {
    const idx = readFileSync("worker/index.ts", "utf8");
    expect(idx).toContain("script-src 'self'; script-src-attr 'none'");
    expect(idx).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
