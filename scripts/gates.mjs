#!/usr/bin/env node
/**
 * 五道门禁一条命令，退出码正确聚合。
 *
 * 动机：`npm run format:check 2>&1 | tail -3 && echo OK` 这种交互式管道会把
 * 非零退出码吞掉，造成「format 挂了但 && 链继续走」的假绿——2026-10-05 真实踩过。
 * 用法：`npm run gates`；任一道失败立即非零退出，后续门禁不再执行。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// 部分沙箱/CI 拒绝写入系统临时目录，Vitest 会把 Vite 模块缓存（ssr/<hash>）写 TEMP
// 并在 EPERM 时记为 unhandled error → 非零退出。统一把临时目录重定向到工作区内。
//
// 注意：重定向只解决了「系统临时目录不可写」这一半。**另一半是并发竞态**——
// 两个 worker 同时把同一个大模块（实测恒为 `worker/other.test.ts` 的 SSR 产物）
// 写到同一个缓存路径，Windows 上第二次 open 报 `EPERM ... ssr/<hash>`，
// Vitest 会**整份丢掉那个测试文件**（123 条用例）并 exit 1。
// 2026-10-29 实测：并行 843 条 / 串行 966 条，同一份代码。所以 test 门禁
// 命中这个特征时自动串行重试一次，既不放过真失败，也不再让门禁随机变红。
const tmpDir = join(process.cwd(), ".tmp", "gates-tmp");
mkdirSync(tmpDir, { recursive: true });
const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir };

/** 已知的 Vitest 模块缓存并发写入竞态（不是被测代码的失败）。 */
const CACHE_RACE_RE = /EPERM[\s\S]{0,400}?ssr[\\/]/i;

function run(command, { capture = false } = {}) {
  const result = spawnSync(command, {
    shell: true,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    env,
    encoding: "utf8",
  });
  if (capture) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  return result;
}

/** 命中缓存竞态时串行重试一次（真实失败不会被吞掉）。 */
function runRetryingCacheRace(name, command) {
  const first = run(command, { capture: true });
  if (first.status === 0) return first;
  const output = `${first.stdout ?? ""}${first.stderr ?? ""}`;
  if (!CACHE_RACE_RE.test(output)) return first;
  console.warn(
    `\n⚠️ ${name} 命中 Vitest 模块缓存并发写入竞态（EPERM ... ssr/<hash>），` +
      "改用串行执行重试一次。",
  );
  return run(`${command} --no-file-parallelism`);
}

const gates = [
  ["check", "npm run check", false],
  ["lint", "npm run lint", false],
  ["format:check", "npm run format:check", false],
  ["test", "npm test -- --run", true],
  ["build", "npm run build", false],
];

for (const [name, command, retryCacheRace] of gates) {
  console.log(`\n=== 门禁 ${name} ===`);
  const result = retryCacheRace ? runRetryingCacheRace(name, command) : run(command);
  if (result.status !== 0) {
    console.error(`\n✘ 门禁 ${name} 失败（exit ${result.status ?? "signal"}）——后续门禁未执行。`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${name} 通过`);
}

// 第六道护栏（2026-10-30 验收 F1）：五道门禁不覆盖「本地 dev 能否启动」，
// workerd 对入口模块具名导出的严格校验曾让 wrangler dev 挂了一个月。
// 失败同样阻断，避免假绿；CI 在 build 后跑同一条命令。
console.log("\n=== 附加 dev 启动冒烟 ===");
const smoke = run("npm run dev:smoke");
if (smoke.status !== 0) {
  console.error(`\n✘ dev 冒烟失败（exit ${smoke.status ?? "signal"}）。`);
  process.exit(smoke.status ?? 1);
}

console.log("\n五道门禁 + dev 冒烟全绿 ✅");
