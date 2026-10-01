import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  Clock,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import {
  createOrbEffectById,
  notifyOrbEffectChanged,
  readOrbEffectId,
} from "../lib/orbEffects/registry";
import { readOrbPalette, type OrbInstance, type OrbPalette } from "../lib/orbEffects/types";

/**
 * 开场光球宿主：持有 renderer/camera/ResizeObserver/指针/reduced-motion 时钟，
 * 场景内容委托给 orbEffects 注册表里的当前效果。
 * 切换效果（art-rank:orb-effect-changed）与切主题（art-rank:theme-changed →
 * applyPalette）都不重建 WebGL 上下文。
 */
export function OrbScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      host.classList.add("orb-scene-fallback");
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 6.2);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "orb-canvas";
    host.appendChild(renderer.domElement);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let instance: OrbInstance | null = null;
    let currentEffectId = "";
    let width = 0;
    let height = 0;
    // createOrbEffectById 已 async（three 走动态 import）。连续切换 / 切主题时，
    // 先发起的 await 可能后到，把新实例顶掉 —— 用递增 token 让过期结果自行作废。
    let mountToken = 0;

    const mountInstance = async () => {
      const token = (mountToken += 1);
      instance?.dispose();
      instance = null;
      scene.clear();
      const effectId = readOrbEffectId();
      const palette = readOrbPalette();
      const next = await createOrbEffectById(
        effectId,
        { scene, camera, renderer, host, reducedMotion: mediaQuery.matches },
        palette,
      );
      if (token !== mountToken) {
        next.dispose();
        return;
      }
      instance = next;
      currentEffectId = effectId;
      if (width > 0) instance.resize(width, height);
    };
    void mountInstance();

    const onEffectChanged = () => void mountInstance();
    window.addEventListener("art-rank:orb-effect-changed", onEffectChanged);

    const onThemeChanged = () => {
      // 主题推荐默认（P2）：无持久化选择时，切到 aurora 等主题要按推荐换特效；
      // 有持久化选择则只换色（不动用户的选择）。
      const next = readOrbEffectId();
      if (next !== currentEffectId) {
        void mountInstance();
        return;
      }
      instance?.applyPalette(readOrbPalette());
    };
    window.addEventListener("art-rank:theme-changed", onThemeChanged);

    const resize = () => {
      const nextWidth = Math.max(host.clientWidth, 1);
      const nextHeight = Math.max(host.clientHeight, 1);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      instance?.resize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const pointer = new Vector2();
    const pointerTarget = new Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointerTarget.set(
        ((event.clientX - rect.left) / rect.width - 0.5) * 0.5,
        ((event.clientY - rect.top) / rect.height - 0.5) * 0.34,
      );
    };
    const onPointerLeave = () => pointerTarget.set(0, 0);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);

    const clock = new Clock();
    let frame = 0;
    const render = () => {
      const elapsed = mediaQuery.matches ? 0.8 : clock.getElapsedTime();
      pointer.lerp(pointerTarget, 0.035);
      instance?.update(elapsed, { x: pointer.x, y: pointer.y });
      renderer.render(scene, camera);
      if (!mediaQuery.matches) frame = requestAnimationFrame(render);
    };
    render();
    const onMotionChange = () => {
      cancelAnimationFrame(frame);
      clock.start();
      render();
    };
    mediaQuery.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mediaQuery.removeEventListener("change", onMotionChange);
      window.removeEventListener("art-rank:orb-effect-changed", onEffectChanged);
      window.removeEventListener("art-rank:theme-changed", onThemeChanged);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      instance?.dispose();
      instance = null;
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="orb-scene" aria-hidden="true" />;
}
