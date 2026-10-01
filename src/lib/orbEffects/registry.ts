// 光球特效注册表：新增效果 = 在 EFFECT_META 加一行 + 在 orbEffectLoaders 加一个 loader（菜单自动枚举）。
// 选择持久化到 localStorage（art-rank:orb-effect）；未注册的存量 id 回退默认。
// 按主题推荐默认（PLAN-ui-modernization P2）：无持久化选择时，aurora 主题推荐 ribbon，
// 其余主题回退第一个（plasma）——既有持久化逻辑不变，推荐只兜底。
//
// four 个特效模块连同 Three.js 全量（约 522KB 原始 / 128KB gzip）会被拖进主包，
// **本文件必须保持零 three 依赖**（见 docs/PLAN-BUNDLE-SPLIT.md）。
// ThemeSwitcher 是首屏常驻组件，它静态 import 本文件；若本文件静态 import 特效模块，
// 四个特效模块连同 Three.js 全量（约 522KB 原始 / 128KB gzip）会被拖进主包，
// DeferredOrb 的 lazy() + requestIdleCallback 就成了空转 —— 那层保护只推迟了渲染，
// 没有把 three 从首屏关键路径上摘下来。因此这里只保留纯数据与纯字符串逻辑，
// 构造函数改走 orbEffectLoaders 的动态 import。
import { readTheme } from "../theme";
import type { OrbEffect } from "./types";

export const ORB_EFFECT_KEY = "art-rank:orb-effect";

/** 特效清单的唯一真相：菜单渲染、默认值回退、loader 查表都以此为准。 */
export const EFFECT_META: ReadonlyArray<{
  id: string;
  name: { zh: string; en: string };
}> = [
  { id: "plasma", name: { zh: "等离子球", en: "Plasma" } },
  { id: "halo", name: { zh: "极光环场", en: "Halo" } },
  { id: "blackhole", name: { zh: "呼吸黑洞", en: "Black Hole" } },
  { id: "ribbon", name: { zh: "极光绸带", en: "Aurora Ribbon" } },
];

export const DEFAULT_EFFECT_ID = EFFECT_META[0].id;

/** 主题 → 推荐默认特效（仅无持久化选择时生效）。 */
const RECOMMENDED_BY_THEME: Record<string, string> = { aurora: "ribbon" };

export function listOrbEffects(): Array<{ id: string; name: { zh: string; en: string } }> {
  return EFFECT_META.map(({ id, name }) => ({ id, name }));
}

export function isRegisteredEffectId(id: string): boolean {
  return EFFECT_META.some((effect) => effect.id === id);
}

export function readOrbEffectId(): string {
  try {
    const v = localStorage.getItem(ORB_EFFECT_KEY) ?? "";
    if (isRegisteredEffectId(v)) return v;
  } catch {
    /* 隐私模式：无持久化，落到主题推荐 */
  }
  const recommended = RECOMMENDED_BY_THEME[readTheme()];
  if (recommended && isRegisteredEffectId(recommended)) return recommended;
  return DEFAULT_EFFECT_ID;
}

export function writeOrbEffectId(id: string): boolean {
  if (!isRegisteredEffectId(id)) return false;
  try {
    localStorage.setItem(ORB_EFFECT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * 建实例。**异步** —— three 与四个特效模块都在这条动态 import 之后才进网络，
 * 调用方必须 await 并自行处理竞态（见 OrbScene 的 mountInstance token 守卫）。
 */
export async function createOrbEffectById(
  id: string,
  host: Parameters<OrbEffect["create"]>[0],
  palette: Parameters<OrbEffect["create"]>[1],
): Promise<ReturnType<OrbEffect["create"]>> {
  const { loadOrbEffect } = await import("./orbEffectLoaders");
  return loadOrbEffect(id, host, palette);
}

/** 切换效果时派发；OrbScene 宿主监听并重建实例。 */
export function notifyOrbEffectChanged(): void {
  window.dispatchEvent(new CustomEvent("art-rank:orb-effect-changed"));
}
