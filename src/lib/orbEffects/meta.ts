import { ORB_EFFECT_KEY } from "../storageKeys";

export { ORB_EFFECT_KEY };

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
