// 开场光球特效的插件接口。
//
// 架构分工（切换效果不闪黑、不重建 WebGL 上下文的关键）：
//   OrbScene（宿主）持有 renderer/camera/ResizeObserver/指针/ reduced-motion 时钟，
//   每个效果（OrbEffect）只负责往 scene 里添加自己的对象并在 update() 里驱动动画。
//   切换效果 = dispose 旧实例（从 scene 摘除并释放几何/材质）→ create 新实例。
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

/** 从 CSS 变量读出的主题调色板（theme 切换时宿主会重新读取并回调 applyPalette）。 */
export interface OrbPalette {
  accent: string;
  accent2: string;
  film: string;
  book: string;
  music: string;
  other: string;
  bg: string;
}

/** 宿主交给效果的稳态设施。renderer/camera 的生命周期归宿主。 */
export interface OrbHost {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  host: HTMLDivElement;
  reducedMotion: boolean;
}

export interface OrbPointer {
  /** -0.5..0.5 的归一化指针偏移（宿主已做缓动）。 */
  x: number;
  y: number;
}

export interface OrbInstance {
  /** 每帧调用；elapsed 为秒。宿主在 reduced-motion 下传入冻结时间并停用 rAF。 */
  update(elapsed: number, pointer: OrbPointer): void;
  /** 宿主容器尺寸变化时调用（camera.aspect/renderer.setSize 由宿主处理）。 */
  resize(width: number, height: number): void;
  /** 主题切换时调用：效果应把新调色板应用到自己的材质/uniform。 */
  applyPalette(palette: OrbPalette): void;
  /** 必须从 scene 摘除全部对象并 dispose 几何/材质/纹理。 */
  dispose(): void;
}

export interface OrbEffect {
  id: string;
  name: { zh: string; en: string };
  create(host: OrbHost, palette: OrbPalette): OrbInstance;
}

/** 从当前 data-theme 读调色板（自定义主题的变量同样可读）。 */
export function readOrbPalette(): OrbPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    accent: v("--accent", "#d8f86a"),
    accent2: v("--accent-2", "#c9ff74"),
    film: v("--film", "#d8f86a"),
    book: v("--book", "#efaa97"),
    music: v("--music", "#97bfc5"),
    other: v("--other", "#c7c2ee"),
    bg: v("--bg", "#080a0a"),
  };
}
