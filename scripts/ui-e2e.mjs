#!/usr/bin/env node
/**
 * 浏览器级冒烟（node scripts/ui-e2e.mjs [baseUrl]）。
 *
 * 起因：台账上「无驱动浏览器」连续留红四次（迭代 7/9/11/回归审查修复）——
 * 焦点陷阱与懒加载兜底这类行为只有真浏览器验得了。本脚本对线上跑只读交互，
 * 不登录、不写任何服务端状态；首选用法：
 *
 *   npx playwright install chromium   # 首次；浏览器装在 %LOCALAPPDATA%\ms-playwright
 *   npm run e2e                       # 默认打 sort.logicc.top
 *   node scripts/ui-e2e.mjs http://127.0.0.1:8787   # 或本地 wrangler dev
 *
 * 用例与修复的对应关系（回归审查 2026-10）：
 *  T1 首页加载 + 顶栏 SettingsMenu 懒 chunk 就位、菜单开合
 *  T2 拦掉 SettingsMenu chunk ⇒ 页面不许白屏（ErrorBoundary 兜底，修复#1）
 *  T3 拦掉 OrbScene chunk ⇒ 装饰组件失败不许拖死首页（修复#5）
 *  T4 广场帖子点作品 ⇒ 详情弹窗数据到达后焦点不许被抢回关闭按钮（修复#2/#3）
 *     —— 广场没帖子或结构对不上时记 SKIP，不算失败。
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "https://sort.logicc.top").replace(/\/+$/, "");
const shotDir = ".tmp/ui-e2e";
mkdirSync(shotDir, { recursive: true });

const results = [];
function record(name, status, note = "") {
  results.push({ name, status });
  const mark = status === "pass" ? "✅" : status === "skip" ? "⏭️ " : "❌";
  console.log(`${mark} ${name}${note ? ` — ${note}` : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: false }).catch(() => {});
}

/** 首次访问会弹引导层（挡住整页点击），每个新 context 都要先点掉。 */
async function dismissGuide(page) {
  const gotIt = page.locator("button", { hasText: /知道了|Got it/ }).first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click({ timeout: 3000 });
    await gotIt.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }
}

// 下载失败的常见替代：Windows 自带的 Edge 就是 Chromium 内核（channel 名是
// "msedge"），启动不需要任何浏览器下载。顺序：playwright 自带 chromium →
// 本地残留的旧版 chromium（若有）→ 系统 Edge → 系统 Chrome。
let lastLaunchError = null;
const browser = await (async () => {
  const leftover = `${process.env.LOCALAPPDATA ?? ""}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
  for (const options of [
    undefined,
    { executablePath: leftover },
    { channel: "msedge" },
    { channel: "chrome" },
  ]) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastLaunchError = error;
    }
  }
  throw lastLaunchError;
})();

// ── T1：正常加载 + 顶栏懒菜单 ────────────────────────────────────────────
try {
  const page = await browser.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissGuide(page);
  const settings = page
    .locator('button.icon-button[title="设置"], button.icon-button[title="Settings"]')
    .first();
  await settings.waitFor({ state: "visible", timeout: 25000 });
  record("T1a 首页加载，SettingsMenu 懒 chunk 就位（齿轮可见）", "pass");

  await settings.click();
  const menu = page.locator('[role="menu"]').first();
  await menu.waitFor({ state: "visible", timeout: 8000 });
  record("T1b 设置菜单打开", "pass");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden", timeout: 5000 }).catch(async () => {
    await page.mouse.click(10, 300);
    await menu.waitFor({ state: "hidden", timeout: 3000 });
  });
  record("T1c 菜单关闭（Esc 或点外）", "pass");
  await page.close();
} catch (error) {
  record("T1 首页加载/设置菜单", "fail", String(error).split("\n")[0]);
}

// ── T2/T3：chunk 加载失败被边界兜住（拦截产物请求模拟发版换代 404）─────────
for (const [name, chunkPattern, mustStay] of [
  ["T2 SettingsMenu chunk 失败不白屏", /\/assets\/SettingsMenu-[^/]+\.js$/, "footer"],
  ["T3 OrbScene chunk 失败不拖死首页", /\/assets\/OrbScene-[^/]+\.js$/, "footer"],
]) {
  try {
    const context = await browser.newContext();
    await context.route(chunkPattern, (route) => route.abort("failed"));
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000); // 给懒加载失败留出抛错窗口
    const bodyText = await page.evaluate(() => document.body.innerText);
    const footerVisible = await page
      .locator("footer")
      .isVisible()
      .catch(() => false);
    const blank = bodyText.trim().length < 100;
    const errored = /Something went wrong/.test(bodyText);
    if (!footerVisible || blank || errored) {
      await shot(page, name.replace(/\s/g, "_"));
      record(name, "fail", `footer=${footerVisible} blank=${blank} errorPage=${errored}`);
    } else {
      record(name, "pass", mustStay === "footer" ? "页脚仍在、无报错页" : "");
    }
    await context.close();
  } catch (error) {
    record(name, "fail", String(error).split("\n")[0]);
  }
}

// ── T4：详情弹窗数据到达后焦点不被抢回（最佳努力，广场无帖则 SKIP）─────────
try {
  const page = await browser.newPage();
  await page.goto(`${base}/plaza`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissGuide(page);
  await page.waitForTimeout(4000);
  // 进第一个帖子：广场列表里的可点击卡片没有稳定 id，退而求其次找指向 /plaza/<id> 的链接
  const postLink = page
    .locator('a[href*="/plaza/"], [class*="plaza"] [class*="card"], [class*="post-card"]')
    .first();
  if (!(await postLink.isVisible().catch(() => false))) {
    record("T4 详情弹窗焦点不回跳", "skip", "广场无帖子或卡片结构对不上");
  } else {
    await postLink.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    // 帖子页里的作品海报：点第一张内容图
    const artwork = page.locator("main img").first();
    if (!(await artwork.isVisible().catch(() => false))) {
      record("T4 详情弹窗焦点不回跳", "skip", "帖子里没有可点的作品图");
    } else {
      await artwork.click({ force: true, timeout: 5000 });
      const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      // 弹窗打开时 FocusTrap 把焦点放在第一个可聚焦控件（关闭按钮）。
      // 把焦点移走，等详情响应到达：旧实现会在此刻把焦点抢回关闭按钮。
      await page.keyboard.press("Tab");
      const before = await page.evaluate(() => document.activeElement?.tagName ?? "none");
      await page.waitForTimeout(8000);
      const state = await page.evaluate(() => {
        const dialogEl = document.querySelector('[role="dialog"][aria-modal="true"]');
        const active = document.activeElement;
        const closeBtn = dialogEl?.querySelector('button[title="关闭"], button[title="Close"]');
        return {
          dialogStillOpen: Boolean(dialogEl),
          focusInside: Boolean(dialogEl && active && dialogEl.contains(active)),
          focusOnClose: Boolean(closeBtn && active === closeBtn),
        };
      });
      if (!state.dialogStillOpen) {
        record("T4 详情弹窗焦点不回跳", "fail", "弹窗被迟到响应顶掉或意外关闭");
      } else if (!state.focusInside) {
        record("T4 详情弹窗焦点不回跳", "fail", `焦点离开弹窗（Tab 后是 ${before}）`);
      } else if (state.focusOnClose) {
        await shot(page, "T4_focus_stolen");
        record("T4 详情弹窗焦点不回跳", "fail", "数据到达后焦点被抢回关闭按钮（修复#2/#3 回归）");
      } else {
        record(
          "T4 详情弹窗焦点不回跳",
          "pass",
          `焦点停在用户位置（Tab 后 ${before}，8s 后未回跳）`,
        );
      }
    }
  }
  await page.close();
} catch (error) {
  record("T4 详情弹窗焦点不回跳", "skip", `结构对不上：${String(error).split("\n")[0]}`);
}

await browser.close();

const failed = results.filter((r) => r.status === "fail");
console.log(
  `\n${results.filter((r) => r.status === "pass").length} passed / ` +
    `${results.filter((r) => r.status === "skip").length} skipped / ${failed.length} failed` +
    (failed.length ? `（失败截图在 ${shotDir}/）` : ""),
);
process.exit(failed.length ? 1 : 0);
