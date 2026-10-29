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
const tmpDir = join(process.cwd(), ".tmp", "gates-tmp");
mkdirSync(tmpDir, { recursive: true });
const env = { ...process.env, TEMP: tmpDir, TMP: tmpDir, TMPDIR: tmpDir };

const gates = [
  ["check", "npm run check"],
  ["lint", "npm run lint"],
  ["format:check", "npm run format:check"],
  ["test", "npm test -- --run"],
  ["build", "npm run build"],
];

for (const [name, command] of gates) {
  console.log(`\n=== 门禁 ${name} ===`);
  const result = spawnSync(command, { shell: true, stdio: "inherit", env });
  if (result.status !== 0) {
    console.error(`\n✘ 门禁 ${name} 失败（exit ${result.status ?? "signal"}）——后续门禁未执行。`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${name} 通过`);
}
console.log("\n五道门禁全绿 ✅");
