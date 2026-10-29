#!/usr/bin/env node
/**
 * 把构建产物清单注入 dist/sw.js（PWA 离线 Phase 8）。
 *
 * 为什么需要：public/sw.js 只预缓存 `/` 与 `/index.html`，路由 chunk 是懒加载的，
 * 用户没去过的路由其 chunk 不在缓存里——离线打开就动态 import 失败，落到
 * ErrorBoundary（线上实测 /myself 离线返回「Something went wrong」）。
 * 这里在 `vite build` 之后列出 dist/assets 下所有 JS/CSS/字体，写进 SW 的
 * PRECACHE_ASSETS，并给缓存桶打上内容哈希（BUILD_ID）。
 *
 * 用法：node scripts/pwa-precache.mjs [distDir]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_TOKEN = "/*__PRECACHE_ASSETS__*/ []";
const BUILD_ID_TOKEN = '/*__BUILD_ID__*/ "dev"';
/** 只预缓存「代码 + 字体」：图片靠运行时 cache-first 自然积累，不必撑大安装期。 */
const PRECACHE_EXTENSIONS = /\.(?:js|css|woff2?)$/i;

export function collectPrecacheAssets(distDir) {
  const assetsDir = join(distDir, "assets");
  if (!existsSync(assetsDir)) return [];
  return readdirSync(assetsDir)
    .filter((name) => PRECACHE_EXTENSIONS.test(name))
    .sort()
    .map((name) => `/assets/${name}`);
}

export function injectPrecache(swSource, assets) {
  if (!swSource.includes(MANIFEST_TOKEN)) {
    throw new Error(`sw.js 缺少预缓存占位符：${MANIFEST_TOKEN}`);
  }
  if (!swSource.includes(BUILD_ID_TOKEN)) {
    throw new Error(`sw.js 缺少构建号占位符：${BUILD_ID_TOKEN}`);
  }
  const buildId = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 10);
  return swSource
    .replace(MANIFEST_TOKEN, JSON.stringify(assets))
    .replace(BUILD_ID_TOKEN, JSON.stringify(buildId));
}

function main() {
  const distDir = process.argv[2] ?? "dist";
  const swPath = join(distDir, "sw.js");
  if (!existsSync(swPath)) throw new Error(`找不到构建产物：${swPath}`);
  const assets = collectPrecacheAssets(distDir);
  if (!assets.length) throw new Error(`dist/assets 为空，预缓存清单没东西可注入：${distDir}`);
  const source = readFileSync(swPath, "utf8");
  writeFileSync(swPath, injectPrecache(source, assets));
  console.log(`[pwa-precache] 已注入 ${assets.length} 个产物到 ${swPath}`);
}

// 只在被直接执行时跑；被测试 import 时不产生副作用。
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/pwa-precache.mjs")) main();
