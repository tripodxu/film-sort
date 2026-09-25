// 光球特效注册表：新增效果 = 新建文件 + 在 EFFECTS 里加一行（菜单自动枚举）。
// 选择持久化到 localStorage（art-rank:orb-effect）；未注册的存量 id 回退默认。
import type { OrbEffect } from "./types";
import { createPlasmaEffect } from "./plasma";
import { createHaloEffect } from "./halo";

export const ORB_EFFECT_KEY = "art-rank:orb-effect";

const EFFECTS: OrbEffect[] = [
  { id: "plasma", name: { zh: "等离子球", en: "Plasma" }, create: createPlasmaEffect },
  { id: "halo", name: { zh: "极光环场", en: "Halo" }, create: createHaloEffect },
];

export function listOrbEffects(): Array<{ id: string; name: { zh: string; en: string } }> {
  return EFFECTS.map(({ id, name }) => ({ id, name }));
}

export function readOrbEffectId(): string {
  try {
    const v = localStorage.getItem(ORB_EFFECT_KEY) ?? "";
    return EFFECTS.some((effect) => effect.id === v) ? v : EFFECTS[0].id;
  } catch {
    return EFFECTS[0].id;
  }
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
