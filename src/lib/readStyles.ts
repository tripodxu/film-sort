import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../styles");

/** 按 src/styles/index.css 的 @import 顺序拼接主样式表（不含 atlas.css）。 */
export function readMainStyles(): string {
  const index = readFileSync(join(STYLES_DIR, "index.css"), "utf8");
  const imports = [...index.matchAll(/@import\s+["']\.\/([^"']+)["'];/g)].map((m) => m[1]);
  return imports.map((file) => readFileSync(join(STYLES_DIR, file), "utf8")).join("\n");
}
