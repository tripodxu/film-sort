// scripts/ui-contrast.mjs — P1a.5 浅色主题对比度扫描与 --text-3 定案（零依赖）
// 解析 styles.css 的真实 token 值 → color-mix(in srgb) 求值 → WCAG 对比度矩阵 → 混合比自动搜索。
// 用法：node scripts/ui-contrast.mjs [--out docs/ui-contrast.json]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");

const THEMES = ["modern", "retro", "minimal", "simple", "classic", "cyber"];
const LIGHT = ["retro", "minimal", "simple", "classic"];

function blockAfter(anchor) {
  const i = css.indexOf(anchor);
  if (i < 0) throw new Error("anchor not found: " + anchor);
  return css.slice(i, css.indexOf("}", i));
}
function hexOf(block, name) {
  const m = block.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{3,8})"));
  if (!m) throw new Error(name + " missing in block");
  return normHex(m[1]);
}
function normHex(h) {
  let s = h.slice(1);
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join("");
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return [r, g, b];
}
// color-mix(in srgb, a p%, b) = sRGB 伽马编码坐标的逐通道线性混合（CSS Color 5）
const mix = (a, p, b) => a.map((v, i) => Math.round((v * p + b[i] * (100 - p)) / 100));
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

// ---- 取各主题 L1（modern 从首个 :root，其余从 [data-theme=X]）----
const base = blockAfter("/* theme primitives");
const vals = {};
for (const t of THEMES) {
  const blk = t === "modern" ? base : blockAfter(`[data-theme=${t}]{`);
  vals[t] = { bg: hexOf(blk, "--bg"), text: hexOf(blk, "--text") };
}

// ---- 派生层（混合比从文件解析，防漂移）----
const pctOf = (name) => {
  const m = css.match(
    new RegExp("--" + name + ":color-mix\\(in srgb,var\\(--text\\) (\\d+)%,var\\(--bg\\)\\)"),
  );
  if (!m) throw new Error("derive formula missing: " + name);
  return Number(m[1]);
};
const P = {
  surface: pctOf("surface"),
  surface3: pctOf("surface-3"),
  surfaceHover: pctOf("surface-hover"),
  text2: pctOf("text-2"),
  text3: pctOf("text-3"),
};

function derive(t, text3Pct) {
  const { bg, text } = vals[t];
  return {
    bg,
    surface: mix(text, P.surface, bg),
    surface3: mix(text, P.surface3, bg),
    surfaceHover: mix(text, P.surfaceHover, bg),
    text,
    text2: mix(text, P.text2, bg),
    text3: mix(text, text3Pct, bg),
  };
}

const PAIRS = [
  ["text3", "bg", "meta 11/12px → 需 4.5"],
  ["text3", "surface", "meta 11/12px → 需 4.5"],
  ["text3", "surface3", "meta 11/12px → 需 4.5"],
  ["text3", "surfaceHover", "meta 11/12px → 需 4.5"],
  ["text2", "surface3", "small 13px → 需 4.5"],
  ["text", "bg", "正文 → 需 4.5"],
];

function matrix(text3Pct) {
  const rows = [];
  for (const t of THEMES) {
    const d = derive(t, text3Pct);
    for (const [fg, bgName, need] of PAIRS) {
      rows.push({ theme: t, pair: `${fg} on ${bgName}`, ratio: contrast(d[fg], d[bgName]), need });
    }
  }
  return rows;
}

// ---- 混合比自动搜索：四浅色主题上 text3 对四级表面的最小对比度 ≥ 4.5 ----
function minLight(text3Pct) {
  let min = Infinity;
  let where = "";
  for (const t of LIGHT) {
    const d = derive(t, text3Pct);
    for (const s of ["bg", "surface", "surface3", "surfaceHover"]) {
      const r = contrast(d.text3, d[s]);
      if (r < min) {
        min = r;
        where = `${t}/text3 on ${s}`;
      }
    }
  }
  return { min, where };
}
const search = [];
let rec = null;
for (let p = P.text3; p <= 96; p += 1) {
  const { min, where } = minLight(p);
  search.push({ pct: p, minRatio: min, worst: where });
  if (!rec && min >= 4.5) rec = { pct: p, minRatio: min, worst: where };
}

const out = {
  generatedAt: new Date().toISOString(),
  formulas: P,
  themes: Object.fromEntries(Object.entries(vals).map(([t]) => [t, derive(t, P.text3)])),
  matrix: matrix(P.text3),
  search,
  recommendation: rec
    ? {
        text3Pct: rec.pct,
        minRatio: rec.minRatio,
        worst: rec.worst,
        action:
          rec.pct === P.text3 ? `keep ${P.text3}%` : `raise --text-3 mix ${P.text3}% → ${rec.pct}%`,
      }
    : { action: "96% 内无解——需改用独立 L1 灰阶" },
};
const json = JSON.stringify(out, null, 2);
console.log(json);
const i = process.argv.indexOf("--out");
if (i > -1 && process.argv[i + 1]) {
  writeFileSync(join(ROOT, process.argv[i + 1]), json + "\n");
  console.error("written: " + process.argv[i + 1]);
}
