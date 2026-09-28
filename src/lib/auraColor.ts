// 海报取色（PLAN-ui-modernization P0）：从海报图像提取主色写入 --aura，
// editorial/gallery 主题用它晕染页面底色；取不到（跨域/灰调海报）时静默
// 移除 --aura，CSS 侧 var(--aura, 维度色) 自动降级——aura 缺失不阻塞主题。
//
// pickAuraColor 是纯函数（node 单测覆盖像素数学）；applyAuraFromImage 依赖
// canvas，在浏览器 smoke 中验收（同 themeRegistry 的测试边界约定）。
//
// 注意（AGENTS.md 硬规则 4）：只能读 allowedImage() 代理后的图像；
// 海报 URL 本身绝不进 items，本模块不触碰数据层。

/** 采样上限：把图缩到 48px 宽再取色，像素数可控且主色不受影响。 */
const SAMPLE_WIDTH = 48;
/** 色相分桶数（每桶 30°）。 */
const HUE_BUCKETS = 12;
/** 胜出桶至少占有效像素的比例，否则视为「没有主色」（灰调/拼贴海报）。
 * 12 桶均匀分布时每桶 8.3%，阈值须明显高于它——取 12%（约 1.5 倍均匀值）。 */
const MIN_DOMINANT_RATIO = 0.12;

function toHex(v: number): string {
  return Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * 从 RGBA 像素数组挑主色，返回 #rrggbb；无有效主色返回 null。
 * 过滤规则：近透明、近灰（饱和度 < 0.18）、近黑近白（明度两端）一律不计。
 */
export function pickAuraColor(data: Uint8ClampedArray): string | null {
  const count = new Array<number>(HUE_BUCKETS).fill(0);
  const weight = new Array<number>(HUE_BUCKETS).fill(0);
  const sumR = new Array<number>(HUE_BUCKETS).fill(0);
  const sumG = new Array<number>(HUE_BUCKETS).fill(0);
  const sumB = new Array<number>(HUE_BUCKETS).fill(0);
  let valid = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510;
    if (lightness < 0.12 || lightness > 0.92) continue;
    if (max === 0) continue;
    const saturation = (max - min) / max;
    if (saturation < 0.18) continue;

    // 色相（0–360）：max 所在通道决定扇区，与常规 RGB→HSL 一致
    const d = max - min;
    let hue: number;
    if (d === 0)
      continue; // 纯灰（饱和度守卫已拦，双保险）
    else if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;

    const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(hue / (360 / HUE_BUCKETS)));
    valid++;
    count[bucket]++;
    weight[bucket] += saturation;
    sumR[bucket] += r;
    sumG[bucket] += g;
    sumB[bucket] += b;
  }

  if (valid === 0) return null;
  let best = -1;
  let bestScore = 0;
  let secondScore = 0;
  for (let i = 0; i < HUE_BUCKETS; i++) {
    const score = weight[i] * count[i];
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = i;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  // 双条件：胜出桶既要有基本盘（占比），也要明显甩开第二名（双色对峙/多色
  // 拼贴时宁可返回 null 走维度色降级，也不要掷硬币选一个）。
  if (best < 0 || count[best] / valid < MIN_DOMINANT_RATIO) return null;
  if (secondScore > 0 && bestScore <= secondScore * 1.5) return null;

  return `#${toHex(sumR[best] / count[best])}${toHex(sumG[best] / count[best])}${toHex(
    sumB[best] / count[best],
  )}`;
}

/** 从已加载的图像提取主色并写入 --aura；任何失败（跨域/解码）都静默清除，走 CSS 降级。 */
export function applyAuraFromImage(
  img: HTMLImageElement | null,
  target: HTMLElement = document.documentElement,
): void {
  try {
    if (!img || !img.naturalWidth) throw new Error("no image");
    const scale = SAMPLE_WIDTH / img.naturalWidth;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_WIDTH;
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no ctx");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height); // 跨域在此抛 SecurityError
    const color = pickAuraColor(data);
    if (color) target.style.setProperty("--aura", color);
    else target.style.removeProperty("--aura");
  } catch {
    target.style.removeProperty("--aura");
  }
}

/** 切换榜单/主题时显式复位。 */
export function clearAura(target: HTMLElement = document.documentElement): void {
  target.style.removeProperty("--aura");
}
