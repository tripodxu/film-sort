// scripts/ui-shadows.mjs — P1b-3 阴影收敛两级（36→2；零依赖、dry-run 先行、幂等）
// 分层策略（paren-aware 拆层，color-mix 内含逗号不可裸拆）：
//   inset 层 / 零模糊 hairline 层（0 Xpx 0）/ none → 保留（--ev-1 元素级约定）
//   发光层（0 0 … 或含 accent 色）→ 删除（AI 感光晕；主题人格发光在主题块内整块保护）
//   投影层 → 归一 var(--ev-2)（0 16px 45px rgba(0,0,0,.28)），每条声明至多一层投影
// 保护区：[data-theme=*] 主题块（括号配平整块跳过）、.note-reader 的 48px 140px 基准阴影（§9）。
// text-shadow → 删除（发光风味）。用法：node scripts/ui-shadows.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "src/styles.css");

function splitLayers(value) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const report = {
  keptInsetHairline: 0,
  keptNone: 0,
  keptProtected: 0,
  dropsEv2: 0,
  glowsRemoved: 0,
  textShadowsRemoved: 0,
};

function processDecls(text) {
  return text.replace(/((?:box|text)-shadow)\s*:\s*([^;}]+)/g, (whole, prop, value) => {
    const v = value.trim();
    if (/48px 140px/.test(v)) {
      report.keptProtected += 1;
      return whole; // note-reader 基准阴影（§9 保护清单）
    }
    if (prop === "text-shadow") {
      report.textShadowsRemoved += 1;
      return "";
    }
    if (v === "none") {
      report.keptNone += 1;
      return whole;
    }
    const kept = [];
    let dropped = false;
    for (const layer of splitLayers(v)) {
      if (/inset/.test(layer) || /^-?[\d.]+px -?[\d.]+px 0( |$)/.test(layer)) {
        kept.push(layer);
        report.keptInsetHairline += 1;
      } else if (/^0 0 /.test(layer) || /var\(--accent/.test(layer)) {
        report.glowsRemoved += 1;
      } else if (!dropped) {
        kept.push("var(--ev-2)");
        report.dropsEv2 += 1;
        dropped = true;
      }
    }
    return `box-shadow:${kept.join(",") || "none"}`;
  });
}

const src = readFileSync(FILE, "utf8");

// 括号配平切分：主题块整块保护，块外做归一
const THEME_OPEN = /\[data-theme=[a-z]+\]\s*\{/y;
let out = "";
let i = 0;
while (i < src.length) {
  THEME_OPEN.lastIndex = i;
  const m = THEME_OPEN.exec(src);
  if (!m) {
    out += processDecls(src.slice(i));
    break;
  }
  const start = m.index;
  let depth = 1;
  let j = start + m[0].length;
  while (j < src.length && depth > 0) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") depth -= 1;
    j += 1;
  }
  out += processDecls(src.slice(i, start));
  out += src.slice(start, j);
  i = j;
}

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--write")) {
  writeFileSync(FILE, out);
  console.error("written: src/styles.css");
} else {
  console.error("dry-run（未写盘）；加 --write 落地");
}
