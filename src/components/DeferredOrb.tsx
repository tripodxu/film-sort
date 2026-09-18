import { Suspense, lazy, useEffect, useState } from "react";

const OrbScene = lazy(() => import("./OrbScene").then((module) => ({ default: module.OrbScene })));

/**
 * 光球是纯装饰（`aria-hidden`），占位元素与 OrbScene 的根节点同 class，
 * 因此等待期间布局不跳动（无 CLS）。
 */
const placeholder = <div className="orb-scene orb-scene-fallback" aria-hidden="true" />;

/**
 * Three.js 光球是首屏最大的一块 JS（约 522KB 原始 / 128KB gzip，占落地页
 * JS 的 ~45%），但它只是一个装饰性背景。`lazy()` 本身只把它拆成第二个请求，
 * 并没有把它从关键路径上摘下来——这里补上这一步：
 *
 *   - 省流模式（`saveData`）或 2G 网络：完全不加载，保留 CSS 兜底背景；
 *   - 其余情况：等首屏空闲（`requestIdleCallback`，2s 上限）后再 import()。
 *
 * 注意 `prefers-reduced-motion` **不**在这里拦截：OrbScene 内部已经把该偏好
 * 处理成「只渲染一帧静止画面」，那些用户本来就该看到静态光球，跳过加载会
 * 反而变成视觉回归。
 */
export function DeferredOrb() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (prefersLiteMode()) return;
    return scheduleWhenIdle(() => setReady(true));
  }, []);

  if (!ready) return placeholder;
  return <Suspense fallback={placeholder}>{<OrbScene />}</Suspense>;
}

/** 省流 / 慢网用户不该为一张装饰背景付 128KB gzip。 */
function prefersLiteMode(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
}

/**
 * `requestIdleCallback` 在 Safari 上缺失，退回定时器；两者都返回取消函数，
 * 以便组件在空闲回调触发前卸载时不留下悬挂回调。
 */
function scheduleWhenIdle(run: () => void): () => void {
  const idleWindow = window as unknown as {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(run, { timeout: 2000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, 200);
  return () => window.clearTimeout(handle);
}
