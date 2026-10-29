import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/** PWA 验收绊线（T-20261014-08）：manifest/图标/Service Worker 三件套齐了
 *  才算可安装。文件级断言（不跑浏览器）：字段齐、图标真实存在且非空、
 *  sw 版本化且不碰 /api、注册代码只在生产域名生效。 */

const root = new URL("../", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, root), "utf8");
}

describe("PWA 可安装三件套", () => {
  it("manifest 字段齐 + 引用的图标真实存在", () => {
    const manifest = JSON.parse(read("public/manifest.json")) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
    };
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    // 可安装底线：192+ PNG（any）与 maskable 各至少一个，且文件真实存在非空。
    const png = (manifest.icons ?? []).filter((icon) => icon.type === "image/png");
    expect(png.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(png.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
    expect(png.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons ?? []) {
      const file = new URL(`public${icon.src}`, root);
      expect(existsSync(file), `manifest 引用的图标缺失：${icon.src}`).toBe(true);
      expect(readFileSync(file).length, `图标为空文件：${icon.src}`).toBeGreaterThan(0);
    }
  });

  it("index.html 接好 manifest + apple-touch-icon + theme-color", () => {
    const html = read("index.html");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color"');
  });

  it("sw.js 版本化缓存 + 跳过 /api + 只缓存壳页", () => {
    const sw = read("public/sw.js");
    expect(sw).toMatch(/CACHE_NAME = "art-rank-v\d+"/);
    expect(sw).toContain("/api/");
    expect(sw).toContain("skipWaiting");
    expect(sw).toContain("clients.claim");
  });

  it("sw.js 预缓存构建产物（否则离线打开没访问过的路由会落到 ErrorBoundary）", () => {
    const sw = read("public/sw.js");
    // 占位符必须原样存在，构建脚本才能注入清单与构建号。
    expect(sw).toContain("/*__PRECACHE_ASSETS__*/ []");
    expect(sw).toContain('/*__BUILD_ID__*/ "dev"');
    // 缓存桶必须带构建号，否则新旧产物会混在同一个桶里。
    expect(sw).toMatch(/RUNTIME_CACHE = `\$\{CACHE_NAME\}-\$\{BUILD_ID\}`/);
    // 单条预缓存失败不能让整个 install 失败。
    expect(sw).toMatch(/Promise\.allSettled\(/);
    expect(sw).toContain("...PRECACHE_ASSETS");
    // 构建脚本必须接在 vite build 之后。
    expect(JSON.parse(read("package.json")).scripts.build).toContain("scripts/pwa-precache.mjs");
  });

  it("Service Worker 只在生产域名注册（localhost 保持 HMR 新鲜）", () => {
    const main = read("src/main.tsx");
    expect(main).toContain('register("/sw.js")');
    expect(main).toContain("localhost");
  });

  it("导出池不变量：海报解析限并发 + 图片加载有超时", () => {
    const code = read("src/lib/exportPng.ts");
    expect(code).toMatch(/mapPool\(\s*posterCandidates/);
    expect(code).toMatch(/function loadImage\(url: string, timeoutMs = \d+\)/);
  });
});
