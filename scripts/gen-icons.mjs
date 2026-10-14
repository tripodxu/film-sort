#!/usr/bin/env node
/**
 * 从 public/favicon.svg 生成 PWA 光栅图标（node scripts/gen-icons.mjs）。
 * 产物：public/icons/icon-192.png / icon-512.png（any）+ icon-maskable-512.png
 * （maskable：深色底 + 居中 68% 安全区，圆形裁剪不吃字）。
 * 浏览器复用 scripts/ui-e2e.mjs 的启动顺序（自带 chromium → 残留 → Edge → Chrome）。
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const leftover = `${process.env.LOCALAPPDATA ?? ""}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
let browser = null;
let lastError = null;
for (const options of [
  undefined,
  { executablePath: leftover },
  { channel: "msedge" },
  { channel: "chrome" },
]) {
  try {
    browser = await chromium.launch(options);
    break;
  } catch (error) {
    lastError = error;
  }
}
if (!browser) throw lastError ?? new Error("no browser");

const svg = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const page = await browser.newPage({ deviceScaleFactor: 1 });
mkdirSync("public/icons", { recursive: true });

async function shot(size, inner, out) {
  const glyph =
    inner === size
      ? `<img width="${size}" height="${size}" src="data:image/svg+xml,${encodeURIComponent(svg)}">`
      : `<div style="width:${size}px;height:${size}px;background:#111313;display:flex;align-items:center;justify-content:center">` +
        `<img width="${inner}" height="${inner}" src="data:image/svg+xml,${encodeURIComponent(svg)}"></div>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${glyph}</body>`);
  const img = page.locator("img");
  await img.waitFor({ state: "visible" });
  // maskable 版按外框截图（含底色），any 版只截 svg 本体。
  await (inner === size ? img : page.locator("div")).screenshot({
    path: out,
    omitBackground: false,
  });
  console.log("wrote", out);
}

await shot(192, 192, "public/icons/icon-192.png");
await shot(512, 512, "public/icons/icon-512.png");
await shot(512, 348, "public/icons/icon-maskable-512.png");
await browser.close();
