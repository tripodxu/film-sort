import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import worker from "./index";
// @ts-expect-error 工程脚本为 .mjs 无声明文件
import { collectPrecacheAssets } from "../scripts/pwa-precache.mjs";

describe("Phase 0c 后端与 PWA 止血回归", () => {
  it("GET /api/health 在数据库异常时返回 503 与 ok:false", async () => {
    const brokenDb = {
      prepare: () => ({
        first: async () => {
          throw new Error("d1 down");
        },
      }),
    } as unknown as D1Database;
    const response = await worker.fetch(
      new Request("https://sort.logicc.top/api/health"),
      { DB: brokenDb, ASSETS: { fetch: async () => new Response("ok") } } as never,
      { waitUntil: () => {} } as never,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; checks: { database: string } };
    expect(body.ok).toBe(false);
    expect(body.checks.database).toBe("error");
  });

  it("GET /api/posters 拒绝非法 type 参数", async () => {
    const response = await worker.fetch(
      new Request("https://sort.logicc.top/api/posters?q=Test&type=film"),
      { ASSETS: { fetch: async () => new Response("ok") } } as never,
      { waitUntil: () => {} } as never,
    );
    expect(response.status).toBe(400);
  });

  it("删户与 RESET_SCOPES.accounts 清理 qr_transactions，且删评论前解除 parent_id", () => {
    const acc = readFileSync("worker/account.ts", "utf8");
    const adm = readFileSync("worker/routes/admin.ts", "utf8");
    expect(acc).toContain("DELETE FROM qr_transactions WHERE user_id = ?");
    expect(acc).toContain("UPDATE plaza_comments SET parent_id = NULL");
    expect(adm).toContain('"DELETE FROM qr_transactions"');
  });

  it("边缘路由缓存对 /api/posters 与 /api/image 绑定 posters 代次而非 misc", () => {
    const idx = readFileSync("worker/index.ts", "utf8");
    expect(idx).toContain('const cacheScope = isPosterCacheRoute ? "posters" : "misc";');
  });

  it("plaza visibility 缺 body 或 is_public 时返 400，不静默隐藏帖子", () => {
    const plaza = readFileSync("worker/plaza.ts", "utf8");
    expect(plaza).toContain('if (!body) return json({ error: "invalid_is_public" }, 400);');
    expect(plaza).toContain("if (visibility === null || visibility === undefined)");
  });

  it("pwa-precache 跳过 three.module 与 orbEffects 装饰 chunk", () => {
    const tmp = join(".tmp", "test-precache-dist");
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(join(tmp, "assets", "index-aaa.js"), "");
    writeFileSync(join(tmp, "assets", "three.module-bbb.js"), "");
    writeFileSync(join(tmp, "assets", "OrbScene-ccc.js"), "");
    writeFileSync(join(tmp, "assets", "blackhole-ddd.js"), "");
    const assets = collectPrecacheAssets(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(assets).toEqual(["/assets/index-aaa.js"]);
  });
});
