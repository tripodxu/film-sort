// ui-orb-probe.mjs — 开场光球（orb）特效验收探针
//
// 为什么需要它：scripts/ui-shot.mjs 显式 --disable-webgl（截图工具链限制），
// 所有 ui-shot 截图里 orb 都不渲染——orb 类改动的视觉验收必须走本探针
// （CDP 驱动 headless Chrome，SwiftShader 软渲 WebGL，连续帧 + Runtime.evaluate + 截图）。
//
// 用法（Git Bash 下建议 MSYS_NO_PATHCONV=1，避免 /path 被改写成 Windows 路径）：
//   node scripts/ui-orb-probe.mjs --theme aurora --width 1300 --height 900 --tag d1 --shots-dir .tmp/shots
//   node scripts/ui-orb-probe.mjs --theme aurora --motion reduced --tag rm        # reduced-motion 双采样
//   node scripts/ui-orb-probe.mjs --theme aurora --width 420 --height 840 --tag m1 # 移动端断点
//   node scripts/ui-orb-probe.mjs --theme aurora --flow resume --draft scripts/ui-fixtures-sorting.json --tag duel
//   node scripts/ui-orb-probe.mjs --theme aurora --flow duel-pulse --draft scripts/ui-fixtures-sorting.json --tag pulse
//
// 输出：harness 步骤 JSON（canvas 挂载 / 特效切换 / 主题换色 / 像素统计 litRatio·meanX·sdX·hue）
//    + 收尾截图 + 双截图比对（reduced-motion 应逐字节一致；normal 应不同）。
// 依赖：dist/ 已构建（npm run build）；Chrome 默认取 %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe，
//    可用环境变量 CHROME_PATH 覆盖。
import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const THEME = opt("--theme", "aurora");
const MOTION = opt("--motion", "normal");
const WIDTH = Number(opt("--width", "1300"));
const HEIGHT = Number(opt("--height", "900"));
const SHOTS_DIR = opt("--shots-dir", "");
const TAG = opt("--tag", "run");
let PATH = opt("--path", "/");
if (!PATH.startsWith("/")) PATH = "/" + PATH; // 兜底：禁 MSYS 路径转换后仍接受 sorting 形式
const DRAFT = opt("--draft", "");
const SKIP_HARNESS = argv.includes("--skip-harness");
const FLOW = opt("--flow", "");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const CHROME =
  process.env.CHROME_PATH ??
  join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe");
const MIME = {
  ".html": "text/html; charset=utf8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const fixtures = JSON.parse(
  readFileSync(join(ROOT, "scripts/ui-fixtures.json"), "utf8").replace(/^\uFEFF/, ""),
);
const draftJson = DRAFT ? readFileSync(resolve(ROOT, DRAFT), "utf8") : "";
const seed = `
  try{localStorage.setItem("art-rank:guide-dismissed","1");}catch(e){}
  Math.random=(function(){let s=0x9E3779B9|0;return function(){s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};})();
  try{localStorage.setItem("art-rank:theme",${JSON.stringify(THEME)});}catch(e){}
  try{localStorage.setItem("art-rank:library:v2",${JSON.stringify(JSON.stringify(fixtures["demo-profile"]))});}catch(e){}
  ${draftJson ? `try{localStorage.setItem("art-rank:draft:v2",${JSON.stringify(draftJson)});}catch(e){}` : ""}
`;

// —— 页内 harness：等 canvas → 走真实菜单点击 → rAF 尾帧采样 → 汇总 JSON ——
const harness = String.raw`
(async () => {
  const R = { steps: [] };
  const log = (k, v) => R.steps.push([k, v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (sel, ms) => {
    const t0 = Date.now();
    for (;;) {
      const el = document.querySelector(sel);
      if (el) return el;
      if (Date.now() - t0 > ms) return null;
      await sleep(120);
    }
  };
  const menuBtn = (text) => {
    const btns = document.querySelectorAll('.rank-menu.theme-menu:not(.settings-menu) [role=menuitemradio], .rank-menu.theme-menu:not(.settings-menu) [role=menuitem]');
    for (const b of btns) {
      const n = b.querySelector(".theme-name");
      if (n && n.textContent.trim() === text) return b;
    }
    return null;
  };
  const openMenu = () => {
    if (document.querySelector(".rank-menu.theme-menu:not(.settings-menu)")) return true; // 已开
    const b = document.querySelector('.theme-switcher > button[aria-label="主题"], .theme-switcher > button[aria-label="Theme"]');
    if (!b) return false;
    b.click();
    return true;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const state = (tag) => ({
    tag,
    canvases: document.querySelectorAll("canvas.orb-canvas").length,
    fallback: !!document.querySelector(".orb-scene-fallback"),
    effect: (() => { try { return localStorage.getItem("art-rank:orb-effect"); } catch (e) { return "?"; } })(),
    theme: document.documentElement.dataset.theme || "",
    accent: cssVar("--accent"), film: cssVar("--film"), music: cssVar("--music"), book: cssVar("--book"),
  });
  // rAF 尾帧技巧：应用 render 回调先注册先执行，本回调同帧尾端取图时缓冲未清空
  const sampleOrb = () => new Promise((res) => {
    requestAnimationFrame(() => {
      try {
        const c = document.querySelector("canvas.orb-canvas");
        const host = document.querySelector(".orb-scene");
        if (!c || !host) return res(null);
        const url = c.toDataURL("image/png");
        const img = new Image();
        img.onload = () => {
          try {
            const r = host.getBoundingClientRect();
            const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
            const d = document.createElement("canvas");
            d.width = img.width; d.height = img.height;
            const ctx = d.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const x0 = Math.max(0, Math.floor(r.left * sx));
            const y0 = Math.max(0, Math.floor(r.top * sy));
            const x1 = Math.min(img.width, Math.ceil(r.right * sx));
            const y1 = Math.min(img.height, Math.ceil(r.bottom * sy));
            const w = Math.max(1, x1 - x0);
            const data = ctx.getImageData(x0, y0, w, Math.max(1, y1 - y0)).data;
            let lit = 0, sxSum = 0, sxxSum = 0, n = 0;
            const hue = [0, 0, 0, 0]; // 0:红橙 1:黄绿 2:青蓝 3:紫粉
            for (let i = 0; i < data.length; i += 4) {
              const R2 = data[i], G2 = data[i + 1], B2 = data[i + 2], A2 = data[i + 3];
              if (A2 > 16 && (R2 + G2 + B2) > 60) {
                lit++;
                const px = (i / 4) % w;
                sxSum += px; sxxSum += px * px;
                const mx = Math.max(R2, G2, B2), mn = Math.min(R2, G2, B2), dd = mx - mn;
                let h = 0;
                if (dd > 0) {
                  if (mx === R2) h = ((G2 - B2) / dd + 6) % 6;
                  else if (mx === G2) h = (B2 - R2) / dd + 2;
                  else h = (R2 - G2) / dd + 4;
                }
                hue[Math.min(3, Math.floor(h / 1.5))]++;
              }
              n++;
            }
            const mean = lit ? sxSum / lit : -1;
            const sd = lit ? Math.sqrt(Math.max(0, sxxSum / lit - mean * mean)) : -1;
            res({ lit, n, litRatio: +(lit / n).toFixed(4), meanX: +(mean / w).toFixed(3), sdX: +(sd / w).toFixed(3), hue, fp: url.length });
          } catch (e) { res({ err: String(e) }); }
        };
        img.onerror = () => res({ err: "img decode failed" });
        img.src = url;
      } catch (e) { res({ err: String(e) }); }
    });
  });
  try {
    const canvas = await waitFor("canvas.orb-canvas", 25000);
    log("mounted", !!canvas);
    log("motion", { reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, saveData: !!navigator.connection?.saveData });
    if (!canvas) return R;
    let lost = false;
    canvas.addEventListener("webglcontextlost", () => { lost = true; });
    log("initial", Object.assign(state("initial"), await sampleOrb()));
    if (!openMenu()) { log("menu", "open-fail"); return R; }
    await sleep(400);
    const menuEl = document.querySelector(".rank-menu.theme-menu:not(.settings-menu)");
    log("menu-debug", {
      found: !!menuEl,
      radios: document.querySelectorAll('.rank-menu.theme-menu:not(.settings-menu) [role=menuitemradio]').length,
      names: [...document.querySelectorAll('.rank-menu.theme-menu:not(.settings-menu) .theme-name')].map((n) => n.textContent.trim()),
      html: menuEl ? menuEl.outerHTML.slice(0, 200) : "",
    });
    const pickEffect = async (name) => {
      const b = menuBtn(name);
      if (!b) { log("effect-btn-missing", name); return false; }
      b.click();
      await sleep(450);
      return true;
    };
    const pickTheme = async (name) => {
      const b = menuBtn(name);
      if (!b) { log("theme-btn-missing", name); return false; }
      b.click();
      await sleep(450);
      return true;
    };
    // —— 清单①：plasma ↔ ribbon 来回 ≥4 次（同一 canvas，无 contextlost，无 fallback）——
    await pickEffect("极光绸带");
    for (let i = 1; i <= 4; i++) {
      await pickEffect("等离子球");
      log("switch" + i + "-plasma", Object.assign(state("s" + i + "p"), await sampleOrb(), { lost }));
      await pickEffect("极光绸带");
      log("switch" + i + "-ribbon", Object.assign(state("s" + i + "r"), await sampleOrb(), { lost }));
    }
    // —— 清单②：同特效下切主题，palette 变量与像素色相跟随 ——
    for (const tn of ["复古纸感", "极简", "纸上擂台"]) {
      await pickTheme(tn);
      log("theme-" + tn, Object.assign(state("t-" + tn), await sampleOrb()));
      openMenu(); await sleep(300);
    }
    // —— 清单③：reduced-motion 双采样一致性（宿主冻结时钟）——
    if (${MOTION === "reduced" ? "true" : "false"}) {
      const a = await sampleOrb();
      await sleep(600);
      const b = await sampleOrb();
      log("reduced-still", { same: JSON.stringify(a) === JSON.stringify(b), a: a && { litRatio: a.litRatio, meanX: a.meanX, sdX: a.sdX }, b: b && { litRatio: b.litRatio, meanX: b.meanX, sdX: b.sdX } });
    }
    // 恢复 aurora + ribbon，记录持久化状态
    openMenu(); await sleep(300);
    await pickTheme("极光");
    openMenu(); await sleep(300);
    await pickEffect("极光绸带");
    log("final", Object.assign(state("final"), await sampleOrb(), { lost }));
    return R;
  } catch (e) {
    log("fatal", String((e && e.stack) || e));
    return R;
  }
})()
`;

const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // SPA fallback：无扩展名且文件不存在 → index.html（与 ui-shot.mjs 同款）
  let f = p === "/" ? join(DIST, "index.html") : join(DIST, p);
  if (!extname(f) && (!existsSync(f) || statSync(f).isDirectory())) f = join(DIST, "index.html");
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end("nf");
    return;
  }
  if (f === join(DIST, "index.html")) {
    const html = readFileSync(f, "utf8").replace("</head>", `<script>${seed}</script></head>`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${WIDTH},${HEIGHT}`,
    "--remote-debugging-port=0",
    "--user-data-dir=" + join(ROOT, ".tmp/chrome-cdp-" + TAG),
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  const t = setTimeout(() => rej(new Error("devtools url timeout: " + buf.slice(-200))), 15000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      clearTimeout(t);
      res(m[1]);
    }
  });
  chrome.on("exit", (c) => {
    clearTimeout(t);
    rej(new Error("chrome exited " + c));
  });
});

// —— 极简 CDP 客户端 ——
let msgId = 0;
const pending = new Map();
const events = [];
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("ws error"));
});
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res: ok, rej: no } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? no(new Error(m.error.message)) : ok(m.result);
  } else if (m.method) {
    events.push(m);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const evalJs = async (expression, sessionId, awaitPromise = true) => {
  const r = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise },
    sessionId,
  );
  if (r.exceptionDetails)
    throw new Error(
      "eval exception: " +
        JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text),
    );
  return r.result.value;
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
if (MOTION === "reduced") {
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    sessionId,
  );
}
await send(
  "Emulation.setDeviceMetricsOverride",
  { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
  sessionId,
);

const loaded = new Promise((res) => {
  const t = setInterval(() => {
    if (events.some((e) => e.method === "Page.loadEventFired")) {
      clearInterval(t);
      res();
    }
  }, 100);
  setTimeout(() => {
    clearInterval(t);
    res();
  }, 20000);
});
const navUrl = `http://127.0.0.1:${port}${PATH}`;
console.log("navigate:", navUrl);
await send("Page.navigate", { url: navUrl }, sessionId);
await loaded;
await new Promise((r) => setTimeout(r, 1500));

const shot = async (name) => {
  if (!SHOTS_DIR) return;
  const r = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(join(SHOTS_DIR, name), Buffer.from(r.data, "base64"));
  console.log("  shot ->", name);
};

if (SHOTS_DIR) mkSync(SHOTS_DIR);

if (FLOW === "duel-pulse") {
  // 真实流程 + 按住左卡不松（:active），让 Node 在脉冲动画中段截图
  console.log("== duel-pulse steps ==");
  const prep = await evalJs(
    `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (sel, ms) => {
      const t0 = Date.now();
      for (;;) {
        const el = document.querySelector(sel);
        if (el) return el;
        if (Date.now() - t0 > ms) return null;
        await sleep(120);
      }
    };
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("继续上次进度"));
    if (!btn) return { ok: false, why: "resume-btn-missing" };
    btn.click();
    const grid = await waitFor(".duel-grid", 15000);
    if (!grid) return { ok: false, why: "duel-grid-missing" };
    await sleep(600);
    const card = document.querySelector(".artwork-card");
    const r = card.getBoundingClientRect();
    return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), title: card.textContent.trim().slice(0, 20) };
  })()`,
    sessionId,
  );
  console.log("prep", JSON.stringify(prep));
  if (prep.ok) {
    await send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: prep.x, y: prep.y, button: "left", clickCount: 1 },
      sessionId,
    );
    await new Promise((r) => setTimeout(r, 350));
    // 截图发生在松开前 —— Node 端 shot() 在流程返回后执行
  }
  await evalJs(`window.__pulseHeld = true`, sessionId);
} else if (FLOW === "resume") {
  // 真实流程：首页点「继续上次进度」→ 等 duel-grid → 报卡面标题
  console.log("== flow steps ==");
  const flowResult = await evalJs(
    `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (sel, ms) => {
      const t0 = Date.now();
      for (;;) {
        const el = document.querySelector(sel);
        if (el) return el;
        if (Date.now() - t0 > ms) return null;
        await sleep(120);
      }
    };
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("继续上次进度"));
    if (!btn) return { steps: [["resume-btn", "missing"]] };
    btn.click();
    const grid = await waitFor(".duel-grid", 15000);
    if (!grid) return { steps: [["duel-grid", "missing"]] };
    await sleep(800);
    const titles = [...document.querySelectorAll(".artwork-card .artwork-title, .artwork-card h3, .artwork-card .title")].map((n) => n.textContent.trim());
    const cards = document.querySelectorAll(".artwork-card").length;
    const progress = document.querySelector(".duel-progress, .progress-track")?.textContent?.trim() ?? "";
    return { steps: [["duel-grid", "ok"], ["cards", cards], ["titles", titles.slice(0, 4)], ["progress", progress.slice(0, 40)]] };
  })()`,
    sessionId,
  );
  for (const [k, v] of flowResult.steps) console.log(k.padEnd(14), JSON.stringify(v));
} else {
  console.log("== harness steps ==");
  const result = SKIP_HARNESS ? { steps: [["skipped", true]] } : await evalJs(harness, sessionId);
  for (const [k, v] of result.steps) {
    const compact =
      typeof v === "object" && v !== null
        ? Object.fromEntries(
            Object.entries(v).map(([kk, vv]) => [
              kk,
              Array.isArray(vv)
                ? vv.join("/")
                : typeof vv === "object" && vv !== null
                  ? JSON.stringify(vv)
                  : vv,
            ]),
          )
        : v;
    console.log(k.padEnd(18), JSON.stringify(compact));
  }
}
if (FLOW === "duel-pulse") {
  await send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: 400, y: 400, button: "left", clickCount: 1 },
    sessionId,
  );
}
await shot(`${TAG}-${WIDTH}x${HEIGHT}-final.png`);
// 双截图比对：reduced-motion 应逐字节一致（静止）；正常模式应不同（动画推进）
if (SHOTS_DIR) {
  const cap = async (n) => {
    const r = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    return Buffer.from(r.data, "base64");
  };
  const a = await cap("a");
  await new Promise((r) => setTimeout(r, 1200));
  const b = await cap("b");
  let diff = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) diff++;
  console.log(
    "dual-shot:",
    MOTION,
    "| bytes equal:",
    a.equals(b),
    "| diffBytes:",
    diff,
    "/",
    len,
    "| sizeA:",
    a.length,
    "sizeB:",
    b.length,
  );
}

ws.close();
chrome.kill();
server.close();
function mkSync(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
