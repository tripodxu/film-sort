// 光球特效注册表：新增效果 = 新建文件 + 在 EFFECTS 里加一行（菜单自动枚举）。
// 选择持久化到 localStorage（art-rank:orb-effect）；未注册的存量 id 回退默认。
// 按主题推荐默认（PLAN-ui-modernization P2）：无持久化选择时，aurora 主题推荐 ribbon，
// 其余主题回退 EFFECTS[0]（plasma）——既有持久化逻辑不变，推荐只兜底。
import type { OrbEffect } from "./types";
import { createPlasmaEffect } from "./plasma";
import { createHaloEffect } from "./halo";
import { createBlackholeEffect } from "./blackhole";
import { createRibbonEffect } from "./ribbon";
import { readTheme } from "../theme";

export const ORB_EFFECT_KEY = "art-rank:orb-effect";

const EFFECTS: OrbEffect[] = [
  { id: "plasma", name: { zh: "等离子球", en: "Plasma" }, create: createPlasmaEffect },
  { id: "halo", name: { zh: "极光环场", en: "Halo" }, create: createHaloEffect },
  { id: "blackhole", name: { zh: "呼吸黑洞", en: "Black Hole" }, create: createBlackholeEffect },
  { id: "ribbon", name: { zh: "极光绸带", en: "Aurora Ribbon" }, create: createRibbonEffect },
];

/** 主题 → 推荐默认特效（仅无持久化选择时生效）。 */
const RECOMMENDED_BY_THEME: Record<string, string> = { aurora: "ribbon" };

export function listOrbEffects(): Array<{ id: string; name: { zh: string; en: string } }> {
  return EFFECTS.map(({ id, name }) => ({ id, name }));
}

export function readOrbEffectId(): string {
  try {
    const v = localStorage.getItem(ORB_EFFECT_KEY) ?? "";
    if (EFFECTS.some((effect) => effect.id === v)) return v;
  } catch {
    /* 隐私模式：无持久化，落到主题推荐 */
  }
  const recommended = RECOMMENDED_BY_THEME[readTheme()];
  if (recommended && EFFECTS.some((effect) => effect.id === recommended)) return recommended;
  return EFFECTS[0].id;
}

export function writeOrbEffectId(id: string): boolean {
  if (!EFFECTS.some((effect) => effect.id === id)) return false;
  try {
    localStorage.setItem(ORB_EFFECT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export function createOrbEffectById(
  id: string,
  host: Parameters<OrbEffect["create"]>[0],
  palette: Parameters<OrbEffect["create"]>[1],
): OrbEffect extends never ? never : ReturnType<OrbEffect["create"]> {
  const effect = EFFECTS.find((entry) => entry.id === id) ?? EFFECTS[0];
  return effect.create(host, palette);
}

/** 切换效果时派发；OrbScene 宿主监听并重建实例。 */
export function notifyOrbEffectChanged(): void {
  window.dispatchEvent(new CustomEvent("art-rank:orb-effect-changed"));
}
