#!/usr/bin/env node
/**
 * scripts/ui-audit.mjs — P0 基线盘点（口径钉死脚本，零依赖）
 *
 * 口径声明（PLAN-ui-refresh.md §10.3 以此为准）：
 *  - 行数：text.split(/\r?\n/) 后去除「单一尾空串」
 *    （= [IO.File]::ReadAllLines 兼容：含空行、含尾行）
 *  - 其余均为正则 occurrence 计数；「规则」= 以 `}` 切分的 CSS 片段
 *
 * 用法：node scripts/ui-audit.mjs [--out docs/ui-baseline.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const lines = (t) => {
  const a = t.split(/\r?\n/);
  if (a.length > 1 && a[a.length - 1] === "") a.pop();
  return a;
};
const count = (re, s) => (s.match(re) ?? []).length;
const uniq = (xs) => [...new Set(xs)];

const css = read("src/styles.css");
const app = read("src/App.tsx");
const ls = lines(css);
const la = lines(app);

// 规则片段 = "<selector>{<decls"（末段 selector = 最后一个 "{" 之前的部分）
const rules = css.split("}");
const fragParts = (f) => {
  const i = f.lastIndexOf("{");
  return { sel: f.slice(0, i).split("{").pop().trim(), decls: f.slice(i + 1) };
};

// ---- !important（occurrence 口径 + 按族分类）----
const impFrag = rules.filter((f) => f.includes("!important"));
const impClass = { collectionRowList: 0, reducedMotion: 0, other: 0 };
for (const f of impFrag) {
  const key = /collection-(row|list)/.test(f)
    ? "collectionRowList"
    : /prefers-reduced-motion/.test(f)
      ? "reducedMotion"
      : "other";
  impClass[key] += count(/!important/g, f);
}

// ---- hex（token 定义层 vs 散落）----
const hexAll = count(/#[0-9a-fA-F]{3,8}\b/g, css);
const hexToken = count(/--[^:;{}]+:\s*#[0-9a-fA-F]{3,8}/g, css);

// ---- media query 全表（空格写法含在内）----
const media = uniq([...css.matchAll(/@media[^{]+/g)].map((m) => m[0].trim())).sort();

// ---- backdrop-filter（active vs none 覆写；blur 半径）----
const blurActive = [];
const blurRadii = [];
let blurNone = 0;
for (const f of rules) {
  if (!f.includes("backdrop-filter")) continue;
  const { sel, decls } = fragParts(f);
  for (const m of decls.matchAll(/backdrop-filter:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (v === "none") {
      blurNone += 1;
      continue;
    }
    blurActive.push(sel || "(top-level)");
    for (const b of v.matchAll(/blur\(([^)]*)\)/g)) blurRadii.push(b[1].trim());
  }
}

// ---- 圆角 / 阴影 / 字号 ----
const radii = uniq(
  [...css.matchAll(/border-radius:\s*([^;}]{1,16})/g)].map((m) => m[1].trim()),
).sort();
const shadowVals = uniq(
  [...css.matchAll(/(?:box|text)-shadow:\s*([^;}]{1,80})/g)].map((m) => m[1].trim()),
);
const shadowClass = { inset: 0, blackDrop: 0, colorGlow: 0, other: 0 };
for (const v of shadowVals) {
  if (/\binset\b/.test(v)) shadowClass.inset += 1;
  else if (/rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(v) || /#000/.test(v)) shadowClass.blackDrop += 1;
  else if (/var\(--|rgba?\(/.test(v)) shadowClass.colorGlow += 1;
  else shadowClass.other += 1;
}
const fontSize = {};
for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) {
  const k = `${m[1]}px`;
  fontSize[k] = (fontSize[k] ?? 0) + 1;
}

const lineStat = (a) => ({
  total: a.length,
  blank: a.filter((x) => x === "").length,
  nonEmpty: a.filter((x) => x !== "").length,
});

const out = {
  generatedAt: new Date().toISOString(),
  convention:
    "行数 = split(/\\r?\\n/) 去单一尾空串（ReadAllLines 兼容，含空行/含尾行）；其余为正则 occurrence 计数",
  lines: { "src/styles.css": lineStat(ls), "src/App.tsx": lineStat(la) },
  important: { total: count(/!important/g, css), rules: impFrag.length, byClass: impClass },
  hex: { total: hexAll, tokenDef: hexToken, scattered: hexAll - hexToken },
  media,
  blur: {
    activeSelectors: uniq(blurActive).length,
    noneOverrides: blurNone,
    radii: uniq(blurRadii).sort(),
  },
  radii,
  shadows: { distinct: shadowVals.length, byClass: shadowClass },
  fontSizePx: Object.fromEntries(
    Object.entries(fontSize).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)),
  ),
};

const json = JSON.stringify(out, null, 2);
console.log(json);
const i = process.argv.indexOf("--out");
if (i > -1 && process.argv[i + 1]) {
  writeFileSync(join(ROOT, process.argv[i + 1]), json + "\n");
  console.error(`written: ${process.argv[i + 1]}`);
}
