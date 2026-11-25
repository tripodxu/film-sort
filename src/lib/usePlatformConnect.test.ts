import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  qrIssueFailureMessage,
  requestPlatformDisconnect,
  requestPlatformStatus,
  shouldPollQrState,
} from "./usePlatformConnect";

describe("平台连接状态查询", () => {
  const json = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("2xx 且 connected 为布尔值时采纳结果，并带上对应平台与凭据", async () => {
    const fetchImpl = json({
      connected: true,
      account: { nickname: "阿栗", avatarUrl: "https://a/v.png" },
    });
    await expect(requestPlatformStatus("netease", "token", fetchImpl)).resolves.toEqual({
      ok: true,
      connected: true,
      account: { nickname: "阿栗", avatarUrl: "https://a/v.png" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/netease/status",
      expect.objectContaining({
        headers: { authorization: "Bearer token" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("未连接且无账号信息时 account 归一为 null", async () => {
    await expect(
      requestPlatformStatus("douban", "token", json({ connected: false })),
    ).resolves.toEqual({
      ok: true,
      connected: false,
      account: null,
    });
  });

  it.each([401, 403, 429, 500, 503])("HTTP %i 属于无法确认，不得被当成未连接", async (status) => {
    await expect(
      requestPlatformStatus("netease", "token", json({ connected: false }, status)),
    ).resolves.toEqual({
      ok: false,
    });
  });

  it.each([
    ["畸形 JSON", () => vi.fn(async () => new Response("<html>502</html>", { status: 200 }))],
    ["connected 缺失", () => json({ account: { nickname: "x" } })],
    ["connected 非布尔", () => json({ connected: "false" })],
    ["网络错误", () => vi.fn(async () => Promise.reject(new TypeError("fetch failed")))],
  ])("%s 属于无法确认", async (_name, make) => {
    await expect(requestPlatformStatus("douban", "token", make())).resolves.toEqual({ ok: false });
  });

  it("状态查询必须带超时，查询失败时保持原状态；登出清掉上一账号的连接态", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(/`\$\{prefix\}\/status`[\s\S]*?AbortSignal\.timeout\(10000\)/);
    expect(source).toMatch(/if \(generation !== statusGenRef\.current \|\| !result\.ok\) return;/);
    expect(source).not.toMatch(/catch \{\s*setConnected\(false\);/);
    expect(source).toMatch(
      /if \(!scope\) \{[\s\S]*?setConnected\(false\);\s*setAccountInfo\(null\);\s*return;/,
    );
  });
});

describe("扫码轮询生命周期", () => {
  it("只在弹窗打开、已有二维码且处于 waiting/scanned 时轮询", () => {
    expect(shouldPollQrState(true, "key", "waiting")).toBe(true);
    expect(shouldPollQrState(true, "key", "scanned")).toBe(true);
    expect(shouldPollQrState(false, "key", "waiting")).toBe(false);
    expect(shouldPollQrState(true, "", "waiting")).toBe(false);
  });

  it.each(["confirmed", "expired", "risk"] as const)("%s 是当前二维码的终态", (state) => {
    expect(shouldPollQrState(true, "key", state)).toBe(false);
  });

  it("慢响应不并发重入，且每个请求都有超时与 finally 复位", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(/let inFlight = false/);
    expect(source).toMatch(/if \(inFlight\) return;\s*inFlight = true/);
    expect(source).toMatch(/finally \{\s*inFlight = false;\s*\}/);
    expect(source).toMatch(/qr\/poll\?\$\{param\}`[\s\S]*?AbortSignal\.timeout\(15000\)/);
  });

  it("过期后自动换码，但风控终态不自动重试", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(
      /倒计时进入 expired 后自动换码；risk 不在这里[\s\S]*?qrState !== "expired"\) return;\s*void autoRefreshQr\(\);/,
    );
    expect(source).toMatch(/if \(qrRefreshed >= 2\)/);
  });

  it("关闭或连续发码时，迟到响应必须被代际守卫丢弃", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toContain("const generation = ++issueGenRef.current");
    expect(source.match(/generation !== issueGenRef\.current/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/function closeQr\(\)[\s\S]*?issueGenRef\.current \+= 1/);
    expect(source).toMatch(
      /catch \{\s*if \(generation === issueGenRef\.current\) setQrState\("expired"\);/,
    );
  });

  it("扫码确认后 900ms 自动关闭弹窗：不得依赖会被轮询 cleanup 置位的 stopped", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).not.toMatch(/if \(!stopped\) setQrOpen\(false\)/);
    expect(source).toMatch(
      /const confirmedGen = issueGenRef\.current;[\s\S]*?if \(issueGenRef\.current === confirmedGen\) setQrOpen\(false\);/,
    );
  });

  it("Cookie 提交带超时，黑洞网络下不会把按钮永久锁死", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(/`\$\{prefix\}\/cookie`[\s\S]*?AbortSignal\.timeout\(20000\)/);
    expect(source).toMatch(/finally \{\s*setCookieBusy\(false\);/);
  });

  it("断开连接后，在途的旧状态快照不能把 connected 写回 true", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(
      /async function disconnect\(\)[\s\S]*?statusGenRef\.current \+= 1;\s*setConnected\(false\);/,
    );
  });
});

describe("断开平台连接", () => {
  it("只有 2xx 才视为断开成功，并携带对应平台与凭据", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(requestPlatformDisconnect("netease", "token", fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/netease/disconnect",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer token" },
      }),
    );
  });

  it.each([401, 429, 500, 503])("HTTP %i 不得被当作成功", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    await expect(requestPlatformDisconnect("douban", "token", fetchImpl)).resolves.toBe(false);
  });

  it("网络失败不得被当作成功", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(requestPlatformDisconnect("douban", "token", fetchImpl)).resolves.toBe(false);
  });

  it("失败分支在清除本地连接态之前返回", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    const failureNotice = source.indexOf("断开失败，请稍后重试；当前连接尚未变更。");
    const failureReturn = source.indexOf("return;", failureNotice);
    const clearConnected = source.indexOf("setConnected(false);", failureNotice);
    expect(failureNotice).toBeGreaterThan(-1);
    expect(failureReturn).toBeGreaterThan(failureNotice);
    expect(clearConnected).toBeGreaterThan(failureReturn);
  });
});

describe("发码非 2xx 独立终态（AUDIT-2026-11-25-R3 · 上轮 R-01）", () => {
  const zh = (a: string) => a;

  it.each([401, 403])("HTTP %i → 登录失效文案，不透传服务端错误码", (status) => {
    expect(qrIssueFailureMessage(status, { error: "unauthorized" }, zh)).toBe(
      "登录已失效，请重新登录后再试。",
    );
  });

  it("HTTP 429 → 限流文案并给 Cookie 降级指引", () => {
    expect(qrIssueFailureMessage(429, { error: "rate_limited" }, zh)).toContain("请求过于频繁");
    expect(qrIssueFailureMessage(429, null, zh)).toContain("Cookie");
  });

  it("其余状态优先透传服务端 msg / error", () => {
    expect(qrIssueFailureMessage(500, { msg: "上游维护中" }, zh)).toBe("上游维护中");
    expect(qrIssueFailureMessage(503, { error: "builtin_unavailable" }, zh)).toBe(
      "builtin_unavailable",
    );
  });

  it("服务端文本缺失 / 非字符串 / 空白时兜底带状态码", () => {
    expect(qrIssueFailureMessage(502, null, zh)).toContain("502");
    expect(qrIssueFailureMessage(500, { msg: 42 }, zh)).toContain("500");
    expect(qrIssueFailureMessage(500, { msg: "   " }, zh)).toContain("500");
  });

  it("failed 是终态：不轮询，也不进自动换码分支", () => {
    expect(shouldPollQrState(true, "key", "failed")).toBe(false);
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    expect(source).toMatch(
      /if \(!qrOpen \|\| qrState !== "expired"\) return;\s*void autoRefreshQr\(\);/,
    );
  });

  it("issueQr 非 2xx 在解析二维码字段之前分流 failed，带代际守卫", () => {
    const source = readFileSync("src/lib/usePlatformConnect.ts", "utf8");
    const issue = source.slice(
      source.indexOf("async function issueQr"),
      source.indexOf("async function openQr"),
    );
    const stripped = issue.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const nonOk = stripped.indexOf("if (!response.ok)");
    const parse = stripped.indexOf("const data = (await response.json())");
    expect(nonOk).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(nonOk);
    expect(stripped).toMatch(
      /if \(!response\.ok\) \{[\s\S]*?setQrError\(qrIssueFailureMessage\(response\.status, body, t\)\);\s*setQrState\("failed"\);\s*return;/,
    );
  });

  it("failed 在弹窗里渲染手动重试按钮，复用过期遮罩而非自动换码", () => {
    const modal = readFileSync("src/components/QrConnectModal.tsx", "utf8");
    expect(modal).toMatch(/\(state === "expired" \|\| state === "failed"\) &&/);
    expect(modal).toMatch(/state === "failed" \? t\("重试", "Retry"\)/);
  });
});
