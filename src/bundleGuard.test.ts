import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

/**
 * 构建产物入口闭包守卫：当 dist/.vite/manifest.json 存在时，
 * 验证首屏入口静态依赖闭包不含 three.module 等重装饰包。
 */
describe("构建产物首屏闭包守卫", () => {
  const manifestPath = "dist/.vite/manifest.json";

  it("入口 chunk 静态导入闭包不包含 three", () => {
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      ManifestChunk
    >;
    const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
    expect(entryKey).toBeDefined();

    const visited = new Set<string>();
    const queue = [entryKey!];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const imp of manifest[key]?.imports ?? []) queue.push(imp);
    }

    const staticFiles = [...visited].map((k) => manifest[k]?.file ?? k);
    expect(staticFiles.some((f) => /three/i.test(f))).toBe(false);
  });
});
