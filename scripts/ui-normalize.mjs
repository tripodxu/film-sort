// scripts/ui-normalize.mjs — P1b-2 裸数值归一（间距 8px 基准 / 字阶档位；零依赖、可审计、可复跑）
// 规则（§2.1 定案 + 容差约束）：
//   间距（margin/padding/gap 族）→ 就近归入 {0,4,8,12,16,24,32,48,64}，平手取小；位移 ≤6px。
//   字阶（font-size）→ ±1px 就近归档（12→13 / 14→15 / 16→17 / 18→17 / 19→20 / 21→20 / 30→29）；
//   22px 以上 display 族（22/24/27/31/32/38/45/48/52/54/64/68/80）与 meta 带 12→13 之外不动。
//   定位类属性（top/left/inset 等）、尺寸类（width/height/min-height，含 44px 触控基线）绝不触碰。
// 用法：node scripts/ui-normalize.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "src/styles.css");

const SPACE_BASE = [0, 4, 8, 12, 16, 24, 32, 48, 64];
const spaceMap = (px) => {
  // <4px：向上归 4（间距呼吸只增不减——2→0 会把微 gap 塌没）；
  // 其余就近归档、平手取小；|Δ|>6 = 宏观留白（hero/section 级），保留原值待 P3/P5 视图阶段定夺。
  if (px < 4) return { to: 4, delta: 4 - px };
  let best = SPACE_BASE[1];
  let bd = Infinity;
  for (const b of SPACE_BASE) {
    const d = Math.abs(px - b);
    if (d < bd || (d === bd && b < best)) {
      bd = d;
      best = b;
    }
  }
  return bd > 6 ? { to: px, delta: 0, retained: true } : { to: best, delta: best - px };
};
const FONT_MAP = { 12: 13, 14: 15, 16: 17, 18: 17, 19: 20, 21: 20, 30: 29 };

const SPACE_DECL =
  /((?:margin|padding)(?:-(?:top|right|bottom|left|inline|block))?|gap|row-gap|column-gap)\s*:\s*([^;}]+)/g;

const src = readFileSync(FILE, "utf8");
const report = { spacing: {}, spacingViolations: [], font: {} };

let out = src.replace(SPACE_DECL, (whole, prop, value) => {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = tok.match(/^(\d+)px$/);
      if (!m) return tok; // 0 / em / % / calc 等原样
      const px = Number(m[1]);
      const { to, delta, retained } = spaceMap(px);
      if (retained) {
        report.retainedMacro = (report.retainedMacro ?? 0) + 1;
        return tok;
      }
      report.spacing[`${px}px→${to}px`] = (report.spacing[`${px}px→${to}px`] ?? 0) + 1;
      if (Math.abs(delta) > 6) report.spacingViolations.push(`${prop}:${px}px→${to}px`);
      return `${to}px`;
    });
  return `${prop}:${parts.join(" ")}`;
});

out = out.replace(/font-size:\s*(\d+)px/g, (whole, n) => {
  const px = Number(n);
  const to = FONT_MAP[px];
  if (to === undefined) return whole;
  report.font[`${px}px→${to}px`] = (report.font[`${px}px→${to}px`] ?? 0) + 1;
  return `font-size:${to}px`;
});

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--write")) {
  writeFileSync(FILE, out);
  console.error("written: src/styles.css");
} else {
  console.error("dry-run（未写盘）；加 --write 落地");
}
