// 光球特效的**动态加载表**（PLAN-BUNDLE-SPLIT.md）。
//
// 本文件是 registry 与 three 之间唯一的桥，也是本项目里唯一允许出现 three 静态 import 的
// 非特效文件——但它自己也不静态 import three：每个 loader 体内用 `import("three")` 之外的
// 模块级动态 import 取特效模块，vite 会据此把三个依赖 graph 切出主包。
//
// 为什么不直接把四个 loader 写成 `import("./plasma")` 的字面量表？
// —— 字面量动态 import 是 vite 的依赖分析入口，必须能被静态扫到；用一层函数包住
// 同样保留字面量（见下方 loaders），既满足扫，又让「表结构」和「id 集合」可单测。
import type { OrbEffect } from "./types";
import { EFFECT_META } from "./registry";

type EffectFactory = OrbEffect["create"];

/** 每个 loader 内部是字面量动态 import，vite 能扫到并据此拆 chunk。 */
const LOADERS: Record<string, () => Promise<EffectFactory>> = {
  plasma: async () => (await import("./plasma")).createPlasmaEffect,
  halo: async () => (await import("./halo")).createHaloEffect,
  blackhole: async () => (await import("./blackhole")).createBlackholeEffect,
  ribbon: async () => (await import("./ribbon")).createRibbonEffect,
};

/** loader 表的 key 集合，供单测与 EFFECT_META 对齐（新增特效漏登记会被这条抓住）。 */
export const ORB_EFFECT_LOADER_IDS: readonly string[] = Object.keys(LOADERS);

export async function loadOrbEffect(
  id: string,
  host: Parameters<EffectFactory>[0],
  palette: Parameters<EffectFactory>[1],
): Promise<ReturnType<EffectFactory>> {
  const loader = LOADERS[id] ?? LOADERS[EFFECT_META[0].id];
  const factory = await loader();
  return factory(host, palette);
}
