import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { requestPlatformDisconnect, shouldPollQrState } from "./usePlatformConnect";

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
