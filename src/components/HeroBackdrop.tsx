import { useEffect, useRef } from "react";

/** 光斑的静止位置（右肩），指针离开 hero 后回到这里。 */
const REST_X = 0.72;
const REST_Y = 0.32;
/** 每帧向目标靠拢的比例：0.07 约 1 秒到位，既有惯性又不会拖尾。 */
const EASE = 0.07;

/**
 * Modern hero backdrop: layered animated mesh-gradient blobs + pointer parallax
 * + mouse spotlight. All styling lives in CSS tokens; this component only owns
 * the pointer rAF loop. Purely decorative (`aria-hidden`), so a failure here
 * must never break the page.
 */
export function HeroBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // `.md-backdrop` 是 `pointer-events:none` 的装饰层，也不是事件目标的祖先，
    // 指针事件不会落在它身上；必须监听包裹它的 hero 区域。
    const host = root.closest<HTMLElement>(".orb-hero") ?? root;
    const spot = root.querySelector<HTMLElement>(".md-spot");
    const layers = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]"));
    if (!spot) return;

    // 头部全局 CSS 只能熔断 CSS 动画，JS 的 rAF 写入要自己尊重该偏好。
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    // 起始位置放在右肩，避免首帧光斑从 (0,0) 飞过来
    let tx = REST_X;
    let ty = REST_Y;
    let cx = tx;
    let cy = ty;
    let raf = 0;
    let disposed = false;

    const paint = () => {
      const dx = (cx - 0.5) * 30;
      const dy = (cy - 0.5) * 30;
      spot.style.setProperty("--md-mx", `${(cx * 100).toFixed(2)}%`);
      spot.style.setProperty("--md-my", `${(cy * 100).toFixed(2)}%`);
      spot.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
      // 指针视差：每层按 data-depth 深度做相对位移（光球自带的漂移动画在子层，
      // 这里只动父级 translate3d，两者不冲突）。
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth ?? "0");
        const ox = (cx - 0.5) * 44 * depth;
        const oy = (cy - 0.5) * 32 * depth;
        layer.style.transform = `translate3d(${ox.toFixed(2)}px, ${oy.toFixed(2)}px, 0)`;
      }
    };

    const tick = () => {
      raf = 0;
      cx += (tx - cx) * EASE;
      cy += (ty - cy) * EASE;
      if (Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001) {
        cx = tx;
        cy = ty;
      }
      paint();
      // 收敛即停：静止时不再占一帧，避免整页挂着一个永不退出的动画循环。
      if (cx !== tx || cy !== ty) raf = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      tx = clamp01((e.clientX - rect.left) / rect.width);
      ty = clamp01((e.clientY - rect.top) / rect.height);
      kick();
    };

    const onPointerLeave = () => {
      // 离开 hero 后光斑缓缓回到右肩
      tx = REST_X;
      ty = REST_Y;
      kick();
    };

    // 先画一帧静态位置：reduced-motion 下这就是最终状态。
    paint();
    if (!reduceMotion) {
      host.addEventListener("pointermove", onPointerMove, { passive: true });
      host.addEventListener("pointerleave", onPointerLeave, { passive: true });
    }

    return () => {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      spot.style.removeProperty("--md-mx");
      spot.style.removeProperty("--md-my");
      spot.style.transform = "";
      for (const layer of layers) layer.style.transform = "";
    };
  }, []);

  return (
    <div className="md-backdrop" aria-hidden="true" ref={rootRef}>
      <div className="md-layer" data-depth="0.35">
        <div className="md-blob md-blob-a" />
      </div>
      <div className="md-layer" data-depth="0.7">
        <div className="md-blob md-blob-b" />
      </div>
      <div className="md-layer" data-depth="1">
        <div className="md-blob md-blob-c" />
      </div>
      <div className="md-spot" />
      <div className="md-grain" />
    </div>
  );
}
