import { describe, expect, it } from "vitest";
import { DASHBOARD_HTML } from "./index";

/**
 * 后台看板是 worker 直接输出的 HTML + 大段内联脚本（登录/看板/AI 提示词管理）。
 * DASHBOARD_HTML 是一个模板字面量：任何想在「浏览器内层 JS 字符串」里出现的
 * 引号都必须写成 \\'（模板会吃掉一层反斜杠）。写 \' 的结果是产出 '' 相邻字符串
 * ——整个 <script> 语法错误，doLogin 等全部函数未定义，登录按钮无响应
 * （2026-09-25 生产事故：版本 2992c8c3 无法登录、70e8cdbf 可以，即此因）。
 * 本测试对每个内联脚本块做语法检查，杜绝复发。
 */
describe("后台看板内联脚本语法（模板字面量转义回归）", () => {
  it("每个内联 <script> 块都必须能通过语法解析", () => {
    const blocks = [
      ...DASHBOARD_HTML.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g),
    ].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const [index, code] of blocks.entries()) {
      // new Function 只做语法解析不执行；内联脚本必须完整可解析，
      // 否则 doLogin/getToken 等全部未定义，看板登录按钮变成死按钮。
      expect(() => new Function(code), `inline script #${index} 语法错误`).not.toThrow();
    }
  });

  it("登录函数存在于内联脚本中且 onclick 引用可解析", () => {
    expect(DASHBOARD_HTML).toContain("function doLogin");
    expect(DASHBOARD_HTML).toContain('onclick="doLogin()"');
  });
});
