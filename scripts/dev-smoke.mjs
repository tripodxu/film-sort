#!/usr/bin/env node
/**
 * 本地 dev server 启动冒烟：`npx wrangler dev` 必须能起来并伺服 SPA 与后台页。
 *
 * 动机（2026-10-30 验收 F1）：`d1c942d` 把两个字符串常量 export 进 worker 入口后，
 * workerd 拒绝非函数具名导出，`wrangler dev` 直接启动失败——五道门禁不含
 * workerd 启动、E2E 默认打线上，该回归潜伏了一个月才被发现。
 * 本脚本作为第六道护栏接在 `npm run gates` 末尾与 CI 的 build 之后；
 * 只验证「能启动 + 首页/后台页可伺服」，不依赖本地 D1 里有什么数据。
 *
 * 用法：`npm run dev:smoke`；SMOKE_PORT 可指定端口，默认向系统要一个空闲端口
 * （固定 8798 会与本机已开着的 wrangler dev 撞端口，冒出与代码无关的假红）。
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

/** 向内核要一个此刻空闲的端口；占用窗口只有毫秒级，够用且不会误伤并行任务。 */
async function freePort() {
  return await new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", () => resolve(0));
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const PORT = Number(process.env.SMOKE_PORT) || (await freePort()) || 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

const wranglerBin = join("node_modules", "wrangler", "bin", "wrangler.js");
const child = spawn(process.execPath, [wranglerBin, "dev", "--port", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});

let bootLog = "";
child.stdout.on("data", (chunk) => (bootLog += chunk));
child.stderr.on("data", (chunk) => (bootLog += chunk));

function killTree() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function fetchUntil(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target.url);
      const body = await res.text();
      if (target.accept(res.status, body)) return { res, body };
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw lastErr ?? new Error("timeout");
}

let failed = false;
try {
  const home = await fetchUntil(
    { url: BASE + "/", accept: (status, body) => status === 200 && body.includes("ART/RANK") },
    BOOT_TIMEOUT_MS,
  );
  console.log(`✓ dev / 伺服 SPA（${home.body.length} bytes）`);
  const admin = await fetchUntil(
    {
      url: BASE + "/admin",
      accept: (status, body) => status === 200 && body.includes("ART/RANK 后台"),
    },
    15_000,
  );
  console.log(`✓ dev /admin 伺服看板外壳（${admin.body.length} bytes）`);
} catch (err) {
  failed = true;
  console.error(`✘ dev 冒烟失败：${err?.message ?? err}`);
  console.error("—— wrangler 输出尾部 ——");
  console.error(bootLog.slice(-2000));
} finally {
  killTree();
  // workerd 子进程退出需要一点时间，避免后续步骤端口占用
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
process.exit(failed ? 1 : 0);
