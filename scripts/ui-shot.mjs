#!/usr/bin/env node
/**
 * scripts/ui-shot.mjs — headless Chrome 批量截图（零依赖；PLAN §8.0 工具链）
 *
 * 用法：node scripts/ui-shot.mjs --out <dir> [--shots scripts/ui-shots.json] [--dsf 2] [--no-seed]
 * manifest：[{ "name": "home-540", "path": "/", "width": 540, "height": 960 }, ...]
 * 静态服务 dist/（SPA fallback），逐条 spawn 本机 Chrome 出图。
 * 默认 `seed` 模式注入确定性预置脚本（抑制引导弹窗、冻结 Math.random、图片去过渡），
 * `--no-seed` 可关闭。Chrome 路径默认 %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe，
 * 可用 CHROME_PATH 覆盖。
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const CHROME =
  process.env.CHROME_PATH ??
  join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
};

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : dflt;
};
const outDir = resolve(ROOT, opt("--out", ".tmp/ui-shots"));
const shotsFile = resolve(ROOT, opt("--shots", "scripts/ui-shots.json"));
const dsf = opt("--dsf", "2");
const seed = !argv.includes("--no-seed");
// fixtures/ui-fixture 注入：按 shot 预置 localStorage（主题/演示画像）与 data-ns 变体开关
const fixtures = existsSync(join(ROOT, "scripts/ui-fixtures.json"))
  ? JSON.parse(readFileSync(join(ROOT, "scripts/ui-fixtures.json"), "utf8"))
  : {};
const extraSeed = (s) => {
  const parts = [];
  if (s?.name) {
    // 自证标签：把 shot 名烙进像素，根治多图批读时的附件错位问题（评审也更清晰）
    parts.push(
      `document.addEventListener("DOMContentLoaded",()=>{const d=document.createElement("div");` +
        `d.textContent=${JSON.stringify(String(s.name))};d.setAttribute("aria-hidden","true");` +
        `d.style.cssText="position:fixed;top:4px;left:4px;z-index:2147483647;font:10px/1.4 monospace;` +
        `letter-spacing:.08em;color:rgba(120,255,120,.6);pointer-events:none";document.body.appendChild(d);});`,
    );
  }
  if (s?.theme) parts.push(`localStorage.setItem("art-rank:theme",${JSON.stringify(s.theme)});`);
  if (s?.fixture && fixtures[s.fixture]) {
    parts.push(
      `localStorage.setItem("art-rank:library:v2",${JSON.stringify(JSON.stringify(fixtures[s.fixture]))});`,
    );
  }
  if (s?.ns) {
    parts.push(`document.documentElement.setAttribute("data-ns",${JSON.stringify(s.ns)});`);
  }
  return parts.join("");
};

if (!existsSync(DIST)) {
  console.error("dist/ 不存在，先 npm run build");
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error(`Chrome 不存在：${CHROME}（可用 CHROME_PATH 覆盖）`);
  process.exit(1);
}
const shots = JSON.parse(readFileSync(shotsFile, "utf8"));
mkdirSync(outDir, { recursive: true });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!extname(file) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, "index.html");
  }
  const type = MIME[extname(file)] ?? "application/octet-stream";
  res.setHeader("content-type", type);
  if (type.startsWith("text/html") && seed) {
    // 预置注入（工具层，零应用代码改动）：
    // ① 抑制首访「使用说明」引导弹窗（App.tsx 读 art-rank:guide-dismissed）
    // ② 确定性 PRNG 替换 Math.random —— 冻结 sampleByKind 每挂载随机挑封面（UI_REVIEW #2.4）
    // ③ 图片去过渡 —— 消除 Poster.tsx opacity:0→onLoad 渐显的时序抖动
    let html = readFileSync(file, "utf8");
    const extra = extraSeed(shots[Number(url.searchParams.get("__shot") ?? -1)] ?? {});
    html = html.replace(
      "</head>",
      `<script>try{localStorage.setItem("art-rank:guide-dismissed","1");` +
        `Math.random=(function(){let s=0x9E3779B9|0;return function(){` +
        `s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);` +
        `t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};})();` +
        `${extra}}catch(e){}</script><style>img{transition:none!important;animation:none!important}</style></head>`,
    );
    res.end(html);
    return;
  }
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// 固定 profile 目录 + 保留不清除：热缓存让远程海报加载跨轮确定（冷缓存是第 3 号非确定源）
const profile = join(ROOT, ".tmp", "chrome-profile-shots");
let failed = 0;
for (const [shotIdx, s] of shots.entries()) {
  const file = join(outDir, `${s.name}-${s.width}x${s.height}.png`);
  const sep = s.path.includes("?") ? "&" : "?";
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-3d-apis",
    "--disable-webgl",
    "--hide-scrollbars",
    "--force-prefers-reduced-motion",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${dsf}`,
    `--window-size=${s.width},${s.height}`,
    "--virtual-time-budget=10000",
    `--screenshot=${file}`,
    `${base}${s.path}${sep}__shot=${shotIdx}`,
  ];
  // 注意：必须用异步 spawn——spawnSync 会阻塞事件循环，静态服务器无法响应 chrome 的请求（互等死锁）
  const code = await new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: "ignore" });
    const kill = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const done = (c) => {
      clearTimeout(kill);
      resolve(c);
    };
    child.on("exit", done);
    child.on("error", () => done(-1));
  });
  const ok = existsSync(file);
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${s.name} (exit ${code}) -> ${file}`);
}
server.closeAllConnections?.();
server.close();
console.log(`done: ${shots.length} shots, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
