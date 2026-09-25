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
    let width = 0;
    let height = 0;

    const mountInstance = () => {
      instance?.dispose();
      instance = null;
      scene.clear();
      const palette = readOrbPalette();
      instance = createOrbEffectById(
        readOrbEffectId(),
        { scene, camera, renderer, host, reducedMotion: mediaQuery.matches },
        palette,
      );
      if (width > 0) instance.resize(width, height);
    };
    mountInstance();

    const onEffectChanged = () => mountInstance();
    window.addEventListener("art-rank:orb-effect-changed", onEffectChanged);

    const onThemeChanged = () => {
      const palette = readOrbPalette();
      instance?.applyPalette(palette);
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
