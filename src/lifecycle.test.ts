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

  it("一次性提示定时器走 ref，重设与卸载两处都要清理", () => {
    // 只查这两个已知漏网视图：全仓扫 setTimeout 会把「revokeObjectURL 的
    // 延时释放」等合法用法一起算进来，反而变成一条永远绿的宽泛断言。
    const strip = (code: string) =>
      code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
    for (const file of ["src/views/ProfileView.tsx", "src/views/ShareView.tsx"]) {
      const code = strip(readFileSync(file, "utf8"));
      expect(code, file).toMatch(/useRef<number \| null>\(null\)/);
      expect(code, file).toMatch(/useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>/);
      expect((code.match(/clearTimeout\(/g) ?? []).length, file).toBeGreaterThanOrEqual(2);
      expect(code, file).not.toMatch(/setTimeout\(\(\) => set(?:PublishBurst|Copied)\(false\)/);
    }
  });
});
