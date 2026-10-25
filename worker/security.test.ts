// 安全审计 2026-10-25 修复绊线（T-20261025-04）——把 M1-M4/L3/L4 的修复固化为源码断言：
// 任何未来改动若悄悄回退（登录哑哈希消失、redirect 跟随回归、限流拆除、密码下限回落），
// 这里先红。纯字符串/正则断言，与 worker/ 既有源码绊线测试同法。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("安全审计修复绊线（2026-10-25）", () => {
  it("M1：登录哑哈希抹平时序差，禁用判定后置到验密之后", () => {
    const src = read("worker/account.ts");
    expect(src).toContain("TIMING_DUMMY_SALT");
    const dummy = src.indexOf("TIMING_DUMMY_SALT, PBKDF2_ITERATIONS");
    const verify = src.indexOf("verifyPassword(password, user.password_hash)");
    const disabled = src.indexOf("user.disabled_at) return json");
    expect(dummy).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(dummy);
    expect(disabled).toBeGreaterThan(verify);
  });

  it("M1 既有闸门保持：登录在分派层 account_auth 严桶（8 次/10 分/IP）", () => {
    const idx = read("worker/index.ts");
    expect(idx).toMatch(/url\.pathname === "\/api\/account\/login"[\s\S]{0,400}account_auth/);
    expect(idx).toMatch(/const limit = authWrite \? 8 : 30/);
  });

  it("L3：用户密码三处下限 8 位，6 位旧下限不再存在", () => {
    const acc = read("worker/account.ts");
    expect((acc.match(/password\.length < 8|newPassword\.length < 8/g) ?? []).length).toBe(3);
    expect(acc).not.toMatch(/[Pp]assword\.length < 6/);
    const app = read("src/App.tsx");
    expect(app).not.toContain("至少6位");
  });

  it("M2：admin 登录挂 auth 限流桶，管理新密码下限 10 位", () => {
    const idx = read("worker/index.ts");
    const loginRoute = idx.indexOf('"/api/admin/login"');
    expect(loginRoute).toBeGreaterThan(-1);
    expect(idx.indexOf('allowUpstreamRequest(request, "auth", 30)', loginRoute)).toBeGreaterThan(
      loginRoute,
    );
    expect(idx).toContain("newPassword.length < 10");
  });

  it("M4：/api/image 匿名代理有独立限流桶（120 次/10 分/IP）", () => {
    const idx = read("worker/index.ts");
    const img = idx.indexOf('"/api/image"');
    expect(img).toBeGreaterThan(-1);
    expect(idx.indexOf('allowUpstreamRequest(request, "image", 120)', img)).toBeGreaterThan(img);
  });

  it("M3：media 出站全量逐跳复核——不再存在 redirect:follow，三处调用走 fetchValidated", () => {
    const m = read("worker/media.ts");
    expect(m).not.toContain('redirect: "follow"');
    expect(m).toContain("UPSTREAM_REDIRECT_SUFFIXES");
    expect(m).toMatch(/function redirectHostAllowed/);
    expect((m.match(/fetchValidated\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("M3：字节上限在位（声明值门 + proxyImage 实读门）", () => {
    const m = read("worker/media.ts");
    expect(m).toContain("UPSTREAM_MAX_BYTES");
    expect(m).toMatch(/declaredLength > UPSTREAM_MAX_BYTES/);
    expect(m).toMatch(/buffer\.byteLength > UPSTREAM_MAX_BYTES/);
  });

  it("L4：PBKDF2 注释不再误导（常量 100k，实现注释不再宣称 600k）", () => {
    const acc = read("worker/account.ts");
    expect(acc).toContain("PBKDF2_ITERATIONS = 100_000");
    expect(acc).toContain("轮数遵守平台");
    // 实现注释块（pbkdf2 函数上方）不得再出现「保持 600k」的旧措辞
    expect(acc).not.toContain("轮数保持");
  });
});
