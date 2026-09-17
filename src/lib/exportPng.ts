import type { ArtisticProfile, RankedArtwork, RankingExport } from "./profile";
import type { MediaKind } from "../data/media";

// ===== 画像 PNG 导出：纯 Canvas 手绘，主题感知（采样当前 data-theme 的 CSS 变量），五套版式 =====

export type ExportLayout = "editorial" | "collage" | "minimal" | "filmstrip" | "podium";

export interface PngExportContext {
  profile: ArtisticProfile;
  layout: ExportLayout;
  locale: "zh" | "en";
  label: (kind: MediaKind) => string;
  t: (zh: string, en: string) => string;
}

interface Palette {
  bg: string; text: string; text2: string; faint: string;
  accent: string; accentInk: string; line: string;
  film: string; book: string; music: string; other: string;
  fontBody: string; fontDisplay: string; fontMono: string;
}

function samplePalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback);
  const text = v("--text", "#eef2ec");
  const bg = v("--bg", "#080a0a");
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  return {
    bg, text,
    text2: mix(text, bg, 82), faint: mix(text, bg, 55),
    accent: v("--accent", "#d8f86a"), accentInk: v("--accent-ink", "#17200d"),
    line: mix(text, "transparent", 22),
    film: v("--film", "#d8f86a"), book: v("--book", "#efaa97"), music: v("--music", "#97bfc5"), other: v("--other", "#c7c2ee"),
    fontBody: v("--font-body", '"Segoe UI",sans-serif'), fontDisplay: v("--font-display", '"Segoe UI",sans-serif'), fontMono: v("--font-mono", "Consolas,monospace"),
  };
}

function kindColor(p: Palette, kind: MediaKind): string {
  return kind === "film" ? p.film : kind === "book" ? p.book : kind === "music" ? p.music : p.other;
}

// canvas 不支持 color-mix()：用离屏 1px 画布让浏览器解析任意 CSS 颜色为 rgba()
const colorCache = new Map<string, string>();
let swatch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
function resolveColor(cssColor: string): string {
  const cached = colorCache.get(cssColor);
  if (cached) return cached;
  if (!swatch) {
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return cssColor;
    swatch = { canvas, ctx };
  }
  try {
    swatch.ctx.clearRect(0, 0, 1, 1);
    swatch.ctx.fillStyle = cssColor;
    swatch.ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = swatch.ctx.getImageData(0, 0, 1, 1).data;
    const rgb = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    colorCache.set(cssColor, rgb);
    return rgb;
  } catch { return cssColor; }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function proxiedUrl(url: string): string {
  try {
    const parsed = new URL(url, location.origin);
    return /^(?:img\d+\.doubanio\.com|m\.media-amazon\.com|ia\.media-imdb\.com|image\.tmdb\.org|[\w-]+\.music\.126\.net|(?:upload|thumb)\.wikimedia\.org|bkimg\.cdn\.bcebos\.com)$/.test(parsed.hostname)
      ? `/api/image?url=${encodeURIComponent(parsed.toString())}` : parsed.toString();
  } catch { return url; }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0; let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export async function renderProfilePng({ profile, layout, locale, label, t }: PngExportContext): Promise<Blob> {
  await document.fonts.ready;
  const p = samplePalette();
  const W = 1200; const M = 72;
  const date = new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");

  // PNG 的浏览器画布有尺寸/内存上限。保留完整文字数据的同时，限制导出绘制量，
  // 并按需解析海报，避免持久化层移除 posterUrls 后整张图只剩占位图。
  const MAX_EXPORT_ITEMS = 240;
  const MAX_EXPORT_POSTERS = 80;
  let remaining = MAX_EXPORT_ITEMS;
  const exportRankings = profile.rankings.map((entry) => {
    const items = entry.items.slice(0, Math.max(0, remaining));
    remaining -= items.length;
    return { ...entry, items };
  }).filter((entry) => entry.items.length > 0);
  const shownWorks = exportRankings.reduce((sum, entry) => sum + entry.items.length, 0);
  const posterSources = new Map<string, string[]>();
  const posterKey = (kind: MediaKind, item: RankedArtwork) => `${kind}|${item.id}|${item.title}|${item.year ?? ""}`;
  const posterFor = (kind: MediaKind, item: RankedArtwork) => posterSources.get(posterKey(kind, item))?.[0] ?? item.posterUrls?.[0];

  async function resolvePosterUrls(kind: MediaKind, item: RankedArtwork) {
    const key = posterKey(kind, item);
    const cached = posterSources.get(key);
    if (cached) return cached;
    let urls = item.posterUrls ? [...item.posterUrls] : [];
    if (!urls.length && posterSources.size < MAX_EXPORT_POSTERS && (kind === "film" || kind === "book" || kind === "music")) {
      try {
        const params = new URLSearchParams({ q: item.title, en: item.subtitle ?? item.title, type: kind === "film" ? "movie" : kind, ...(item.year ? { year: String(item.year) } : {}) });
        const response = await fetch(`/api/posters?${params}`, { signal: AbortSignal.timeout(15000) });
        if (response.ok) {
          const data = await response.json() as { poster_urls?: string[] };
          urls = data.poster_urls ?? [];
        }
      } catch { /* Draw the text fallback when poster resolution fails. */ }
    }
    const resolved = [...new Set(urls)].slice(0, 4);
    posterSources.set(key, resolved);
    return resolved;
  }

  const posterCandidates = exportRankings.flatMap((entry) => entry.items.map((item) => ({ kind: entry.kind, item })));
  await Promise.all(posterCandidates.slice(0, MAX_EXPORT_POSTERS).map(({ kind, item }) => resolvePosterUrls(kind, item)));
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...posterSources.values()].flat().map(async (src) => {
    if (images.has(src)) return;
    const image = await loadImage(proxiedUrl(src));
    if (image) images.set(src, image);
  }));

  const count = (n: number, per: number) => Math.ceil(n / per);
  const sectionHeight = (entry: RankingExport) => {
    const n = entry.items.length;
    if (layout === "minimal") return 64 + n * 42 + 26;
    if (layout === "collage") return 52 + count(n, 5) * 316 + 30;
    if (layout === "filmstrip") return 56 + count(n, 6) * 268 + 34;
    if (layout === "podium") return 56 + 452 + Math.max(0, n - 3) * 46 + 30;
    return 56 + 372 + count(Math.max(0, n - 1), 2) * 46 + 34; // editorial
  };
  const headerH = 300;
  const H = Math.max(760, headerH + exportRankings.reduce((sum, entry) => sum + sectionHeight(entry), 0) + 90);

  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2; // 2x 导出保证清晰度
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.scale(2, 2);
  const bg = resolveColor(p.bg), text = resolveColor(p.text), text2 = resolveColor(p.text2), faint = resolveColor(p.faint), accent = resolveColor(p.accent), accentInk = resolveColor(p.accentInk), line = resolveColor(p.line);

  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const drawPoster = (src: string | undefined, x: number, y: number, w: number, h: number, radius = 8, tint = accent) => {
    const image = src ? images.get(src) : undefined;
    if (image) {
      ctx.save();
      roundedRect(ctx, x, y, w, h, radius); ctx.clip();
      const scale = Math.max(w / image.width, h / image.height);
      const dw = image.width * scale; const dh = image.height * scale;
      ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      ctx.restore();
      roundedRect(ctx, x, y, w, h, radius); ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
    } else {
      ctx.save();
      roundedRect(ctx, x, y, w, h, radius);
      ctx.fillStyle = resolveColor(`color-mix(in srgb, ${tint} 14%, ${p.bg})`); ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = resolveColor(`color-mix(in srgb, ${tint} 70%, ${p.text})`);
      ctx.font = `600 ${Math.max(11, Math.round(w / 9))}px ${p.fontMono}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("ART", x + w / 2, y + h / 2);
      ctx.restore();
    }
  };

  // ===== 页眉 =====
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 26px ${p.fontDisplay}`;
  ctx.fillStyle = text; ctx.fillText("ART", M, 84);
  const artW = ctx.measureText("ART").width;
  ctx.fillStyle = accent; ctx.fillText("/", M + artW + 2, 84);
  ctx.fillStyle = text; ctx.fillText("RANK", M + artW + 18, 84);
  ctx.font = `13px ${p.fontMono}`; ctx.fillStyle = faint; ctx.textAlign = "right";
  ctx.fillText(`PERSONAL CULTURE INDEX · ${date}`, W - M, 84);
  ctx.textAlign = "left";
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M, 112); ctx.lineTo(W - M, 112); ctx.stroke();
  ctx.font = `600 54px ${p.fontDisplay}`; ctx.fillStyle = text;
  ctx.fillText(ellipsis(ctx, profile.profileName, W - M * 2), M, 182);
  const totalWorks = profile.rankings.reduce((sum, entry) => sum + entry.items.length, 0);
  ctx.font = `15px ${p.fontMono}`; ctx.fillStyle = faint;
  const exportNote = shownWorks < totalWorks ? ` · ${t(`PNG 绘制前 ${shownWorks} 件`, `first ${shownWorks} in PNG`)}` : "";
  ctx.fillText(`${profile.rankings.length} ${t("个领域", "media")} · ${totalWorks} ${t("件作品", "works")}${exportNote}`, M, 218);

  // ===== 各榜单 =====
  let cursor = headerH;
  const rankLabel = (rank: number) => rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : String(rank).padStart(2, "0");

  for (const entry of exportRankings) {
    const kc = resolveColor(kindColor(p, entry.kind));
    // 区块头
    ctx.font = `600 13px ${p.fontMono}`; ctx.fillStyle = kc;
    const kindText = label(entry.kind).toUpperCase();
    ctx.fillText(kindText, M, cursor);
    const kindW = ctx.measureText(kindText).width;
    ctx.fillStyle = faint; ctx.fillText(`  /  ${entry.collectionTitle}`, M + kindW, cursor);
    cursor += 22;
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(M, cursor); ctx.lineTo(W - M, cursor); ctx.stroke();
    cursor += 26;

    const items = entry.items;
    if (layout === "minimal") {
      for (const item of items) {
        ctx.font = `400 15px ${p.fontMono}`; ctx.fillStyle = faint;
        ctx.fillText(String(item.rank).padStart(2, "0"), M, cursor + 16);
        ctx.font = `${item.rank === 1 ? 600 : 400} 21px ${p.fontBody}`;
        ctx.fillStyle = item.rank === 1 ? accent : text;
        ctx.fillText(ellipsis(ctx, item.title, W - M * 2 - 190), M + 52, cursor + 18);
        ctx.font = `13px ${p.fontMono}`; ctx.fillStyle = faint; ctx.textAlign = "right";
        ctx.fillText(ellipsis(ctx, [item.creator, item.year].filter(Boolean).join(" · "), 320), W - M, cursor + 17);
        ctx.textAlign = "left";
        cursor += 42;
      }
      cursor += 26;
    } else if (layout === "collage") {
      const tileW = 196; const tileH = 258; const gap = 18;
      items.forEach((item, index) => {
        const col = index % 5; const row = Math.floor(index / 5);
        const x = M + col * (tileW + gap); const y = cursor + row * (tileH + 58);
        ctx.save();
        ctx.translate(x + tileW / 2, y + tileH / 2);
        ctx.rotate(((index % 2 === 0 ? 1 : -1) * (0.7 + (index % 3) * 0.4) * Math.PI) / 180);
        ctx.translate(-(x + tileW / 2), -(y + tileH / 2));
        ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
        drawPoster(posterFor(entry.kind, item), x, y, tileW, tileH, 10, entry.kind === "film" ? p.film : entry.kind === "book" ? p.book : entry.kind === "music" ? p.music : p.other);
        ctx.restore();
        ctx.font = `600 15px ${p.fontMono}`; ctx.fillStyle = item.rank === 1 ? accent : text;
        ctx.fillText(rankLabel(item.rank), x + 2, y + tileH + 26);
        ctx.font = `13px ${p.fontBody}`; ctx.fillStyle = faint;
        ctx.fillText(ellipsis(ctx, item.title, tileW - 44), x + 34, y + tileH + 25);
      });
      cursor += count(items.length, 5) * (tileH + 58) + 30;
    } else if (layout === "filmstrip") {
      for (let start = 0; start < items.length; start += 6) {
        const strip = items.slice(start, start + 6);
        const bandH = 218;
        ctx.fillStyle = resolveColor(`color-mix(in srgb, ${p.text} 6%, ${p.bg})`);
        roundedRect(ctx, M, cursor, W - M * 2, bandH, 14); ctx.fill();
        // 齿孔
        ctx.fillStyle = bg;
        const holes = Math.floor((W - M * 2) / 44);
        for (let h = 0; h < holes; h += 1) {
          const hx = M + 14 + h * 44;
          roundedRect(ctx, hx, cursor + 8, 20, 12, 4); ctx.fill();
          roundedRect(ctx, hx, cursor + bandH - 20, 20, 12, 4); ctx.fill();
        }
        const thumbW = 150; const thumbH = 168; const pad = (W - M * 2 - strip.length * (thumbW + 16)) / 2;
        strip.forEach((item, index) => {
          const x = M + pad + index * (thumbW + 16); const y = cursor + 25;
          drawPoster(posterFor(entry.kind, item), x, y, thumbW, thumbH, 6, entry.kind === "film" ? p.film : entry.kind === "book" ? p.book : entry.kind === "music" ? p.music : p.other);
          ctx.font = `600 12px ${p.fontMono}`; ctx.fillStyle = item.rank === 1 ? accent : faint;
          ctx.fillText(rankLabel(item.rank), x + 2, y + thumbH + 18);
          ctx.font = `11px ${p.fontBody}`; ctx.fillStyle = text2;
          ctx.fillText(ellipsis(ctx, item.title, thumbW - 36), x + 30, y + thumbH + 17);
        });
        cursor += bandH + 20;
      }
      cursor += 14;
    } else if (layout === "podium") {
      const top = items.slice(0, 3);
      const rest = items.slice(3);
      const podiumW = 300; const gapX = (W - M * 2 - podiumW * 3) / 2;
      const heights = [330, 288, 288]; const baseY = cursor + 380;
      const order = [1, 0, 2]; // 亚军-冠军-季军
      order.forEach((ti, slot) => {
        const item = top[ti]; if (!item) return;
        const x = M + slot * (podiumW + gapX); const h = heights[ti];
        const y = baseY - h;
        drawPoster(posterFor(entry.kind, item), x + 40, y, podiumW - 80, h - 66, 10, ti === 0 ? p.film : ti === 1 ? p.book : p.music);
        ctx.font = `700 34px ${p.fontDisplay}`; ctx.textAlign = "center";
        ctx.fillStyle = ti === 0 ? accent : text2;
        ctx.fillText(rankLabel(ti + 1), x + podiumW / 2, baseY + 4);
        ctx.font = `600 16px ${p.fontBody}`; ctx.fillStyle = text;
        ctx.fillText(ellipsis(ctx, item.title, podiumW - 30), x + podiumW / 2, baseY + 30);
        ctx.font = `12px ${p.fontMono}`; ctx.fillStyle = faint;
        ctx.fillText(ellipsis(ctx, [item.creator, item.year].filter(Boolean).join(" · "), podiumW - 40), x + podiumW / 2, baseY + 50);
        ctx.textAlign = "left";
      });
      cursor = baseY + 72;
      for (const item of rest) {
        ctx.font = `400 14px ${p.fontMono}`; ctx.fillStyle = faint;
        ctx.fillText(String(item.rank).padStart(2, "0"), M, cursor + 15);
        ctx.font = `400 18px ${p.fontBody}`; ctx.fillStyle = text;
        ctx.fillText(ellipsis(ctx, item.title, W - M * 2 - 260), M + 48, cursor + 16);
        ctx.font = `12px ${p.fontMono}`; ctx.fillStyle = faint; ctx.textAlign = "right";
        ctx.fillText(ellipsis(ctx, [item.creator, item.year].filter(Boolean).join(" · "), 200), W - M, cursor + 15);
        ctx.textAlign = "left";
        cursor += 46;
      }
      cursor += 30;
    } else {
      // editorial：首件大图 + 双列名录
      const lead = items[0];
      if (lead) {
        const posterH = 320; const posterW = 224;
        drawPoster(posterFor(entry.kind, lead), M, cursor, posterW, posterH, 12, entry.kind === "film" ? p.film : entry.kind === "book" ? p.book : entry.kind === "music" ? p.music : p.other);
        // 冠军徽章
        ctx.fillStyle = accent; roundedRect(ctx, M + 14, cursor + 14, 64, 34, 10); ctx.fill();
        ctx.font = `700 18px ${p.fontDisplay}`; ctx.fillStyle = accentInk; ctx.fillText("TOP 1", M + 26, cursor + 38);
        const tx = M + posterW + 36;
        ctx.font = `600 34px ${p.fontDisplay}`; ctx.fillStyle = text;
        ctx.fillText(ellipsis(ctx, lead.title, W - M - tx), tx, cursor + 60);
        ctx.font = `15px ${p.fontMono}`; ctx.fillStyle = faint;
        ctx.fillText(ellipsis(ctx, [lead.creator, lead.year, lead.subtitle].filter(Boolean).join("  ·  "), W - M - tx), tx, cursor + 92);
        cursor += posterH + 28;
      }
      const rest = items.slice(1);
      for (let i = 0; i < rest.length; i += 2) {
        rest.slice(i, i + 2).forEach((item, col) => {
          const colW = (W - M * 2 - 40) / 2; const x = M + col * (colW + 40);
          ctx.font = `400 14px ${p.fontMono}`; ctx.fillStyle = faint;
          ctx.fillText(String(item.rank).padStart(2, "0"), x, cursor + 15);
          ctx.font = `400 19px ${p.fontBody}`; ctx.fillStyle = text;
          ctx.fillText(ellipsis(ctx, item.title, colW - 120), x + 44, cursor + 16);
          ctx.font = `12px ${p.fontMono}`; ctx.fillStyle = faint; ctx.textAlign = "right";
          ctx.fillText(ellipsis(ctx, [item.creator, item.year].filter(Boolean).join(" · "), 150), x + colW, cursor + 15);
          ctx.textAlign = "left";
        });
        cursor += 46;
      }
      cursor += 34;
    }
  }

  // ===== 页脚 =====
  ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(M, H - 64); ctx.lineTo(W - M, H - 64); ctx.stroke();
  ctx.font = `13px ${p.fontMono}`; ctx.fillStyle = faint;
  ctx.fillText(t("偏好没有标准答案", "PREFERENCE HAS NO ANSWER KEY"), M, H - 34);
  ctx.textAlign = "right"; ctx.fillText("ART/RANK", W - M, H - 34); ctx.textAlign = "left";

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("toBlob failed")); }, "image/png");
  });
}

/** 导出文件名：画像名（清洗）+ 日期 + 版式 */
export function pngFileName(profileName: string, layout: ExportLayout): string {
  const clean = profileName.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "art-profile";
  const d = new Date();
  return `${clean}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${layout}.png`;
}
