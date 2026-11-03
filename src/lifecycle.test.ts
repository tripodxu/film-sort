/**
 * 定时器生命周期绊线：每个 `setInterval` 必须在同文件出现 `clearInterval`。
 * 只做源码计数（node 环境），防止新增轮询时漏掉 effect 清理。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return walk(join(dir, entry.name));
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [join(dir, entry.name)];
  });

describe("定时器生命周期", () => {
  it("每个 setInterval 都有对应的 clearInterval", () => {
    for (const file of walk("src")) {
      const code = readFileSync(file, "utf8");
      const timers = (code.match(/setInterval\(/g) ?? []).length;
      if (!timers) continue;
      const clears = (code.match(/clearInterval\(/g) ?? []).length;
      expect(clears, file).toBeGreaterThanOrEqual(timers);
    }
  });
});
