#!/usr/bin/env node
/**
 * scripts/ui-diff.mjs — 纯 Node PNG 像素 diff（零依赖；PLAN §8.0 工具链）
 *
 * 用法：
 *   node scripts/ui-diff.mjs <a.png> <b.png> [--tol 0] [--out <dir>]
 *   node scripts/ui-diff.mjs <dirA> <dirB> [--tol 0] [--out <dir>]   （按文件名两两配对）
 *
 * 输出 JSON：每对 { name, width, height, totalPixels, diffPixels, pct, maxDelta, bbox } + summary
 * --out 时另存差异图（同像素压暗 35%，差异像素打品红），供人工复核。
 * 支持 8-bit 非隔行 PNG（ct = 0/2/4/6），即 Chrome 截图的输出格式。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        ct: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("no IHDR");
  if (ihdr.depth !== 8 || ihdr.interlace !== 0 || ![0, 2, 4, 6].includes(ihdr.ct)) {
    throw new Error(
      `PNG variant unsupported (depth=${ihdr.depth}, ct=${ihdr.ct}, interlace=${ihdr.interlace})`,
    );
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const pix = Buffer.alloc(ihdr.h * stride);
  let p = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[p++];
    const rowOff = p;
    p += stride;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? pix[o + x - ch] : 0;
      const b = y > 0 ? pix[o - stride + x] : 0;
      const c = x >= ch && y > 0 ? pix[o - stride + x - ch] : 0;
      let v = raw[rowOff + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pix[o + x] = v & 255;
    }
  }
  return { w: ihdr.w, h: ihdr.h, ch, pix };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodeRgbPng(w, h, pix) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) pix.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function diffPair(name, aBuf, bBuf, tol, outDir) {
  const a = decodePng(aBuf);
  const b = decodePng(bBuf);
  if (a.w !== b.w || a.h !== b.h) {
    return { name, mismatch: `dims differ: ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  }
  const total = a.w * a.h;
  let diffPixels = 0;
  let maxDelta = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  const mark = Buffer.alloc(total * 3);
  for (let i = 0; i < total; i++) {
    const ar = a.pix[i * a.ch];
    const ag = a.pix[i * a.ch + (a.ch > 2 || a.ch === 2 ? 1 : 0)];
    const ab = a.pix[i * a.ch + (a.ch > 2 ? 2 : 0)];
    const br = b.pix[i * b.ch];
    const bg = b.pix[i * b.ch + (b.ch > 2 || b.ch === 2 ? 1 : 0)];
    const bb = b.pix[i * b.ch + (b.ch > 2 ? 2 : 0)];
    const d = Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
    const o = i * 3;
    if (d > tol) {
      diffPixels += 1;
      if (d > maxDelta) maxDelta = d;
      const x = i % a.w;
      const y = (i / a.w) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      mark[o] = 255;
      mark[o + 1] = 0;
      mark[o + 2] = 255;
    } else {
      mark[o] = ar * 0.35;
      mark[o + 1] = ag * 0.35;
      mark[o + 2] = ab * 0.35;
    }
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${name}.diff.png`), encodeRgbPng(a.w, a.h, mark));
  }
  return {
    name,
    width: a.w,
    height: a.h,
    totalPixels: total,
    diffPixels,
    pct: Number(((diffPixels / total) * 100).toFixed(4)),
    maxDelta,
    bbox: diffPixels > 0 ? { x0, y0, x1, y1 } : null,
  };
}

const argv = process.argv.slice(2);
const flags = argv.filter((x) => x.startsWith("--"));
const pos = argv.filter((x) => !x.startsWith("--"));
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : dflt;
};
const tol = Number(opt("--tol", "0"));
const outDir = opt("--out", "");
void flags;
if (pos.length < 2) {
  console.error("用法：node scripts/ui-diff.mjs <a.png|dirA> <b.png|dirB> [--tol 0] [--out dir]");
  process.exit(1);
}
const [pa, pb] = pos.map((x) => resolve(ROOT, x));

const pairs = [];
if (statSync(pa).isDirectory()) {
  const namesA = readdirSync(pa).filter((f) => f.endsWith(".png") && !f.includes(".diff."));
  for (const n of namesA.sort()) {
    if (existsSync(join(pb, n))) pairs.push([n.replace(/\.png$/, ""), join(pa, n), join(pb, n)]);
  }
} else {
  pairs.push([basename(pa).replace(/\.png$/, ""), pa, pb]);
}

const results = pairs.map(([name, fa, fb]) =>
  diffPair(name, readFileSync(fa), readFileSync(fb), tol, outDir || null),
);
const summary = {
  pairs: results.length,
  zeroDiff: results.filter((r) => r.diffPixels === 0).length,
  changed: results.filter((r) => (r.diffPixels ?? 1) > 0).length,
  mismatches: results.filter((r) => r.mismatch).length,
};
console.log(JSON.stringify({ files: results, summary }, null, 2));
