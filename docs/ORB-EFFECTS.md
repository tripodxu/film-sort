# ART/RANK 开场光球特效开发指南（Orb Effects）

> 版本：1（2026-09-25）。按此指南新增的特效会在「主题」菜单的「开场特效」组自动出现，
> 无需改动任何 UI 代码。本文面向人类开发者与 AI agent。

## 1. 架构

```
OrbScene.tsx（宿主）           持有 WebGLRenderer / PerspectiveCamera / ResizeObserver /
                               指针缓动 / prefers-reduced-motion 时钟
        │ create(host, palette)
        ▼
src/lib/orbEffects/
  types.ts      OrbEffect / OrbInstance / OrbPalette / OrbHost 接口
  registry.ts   效果注册表 + 选择持久化（localStorage art-rank:orb-effect）
  plasma.ts     等离子球（原默认光球，shader 驱动）
  halo.ts       极光环场（参考实现：无 shader，~150 行）
  <your>.ts     你的新效果
```

关键约束：**宿主持有 renderer 与 camera，效果只操作 scene 内容**。切换效果时宿主
调用旧实例 `dispose()` → 新实例 `create()`，WebGL 上下文不重建、不闪黑。

## 2. 最小可行特效（模板）

```ts
// src/lib/orbEffects/myEffect.ts
import { Mesh, MeshBasicMaterial, IcosahedronGeometry, AdditiveBlending } from "three";
import type { OrbHost, OrbPalette, OrbInstance } from "./types";

export function createMyEffect(host: OrbHost, palette: OrbPalette): OrbInstance {
  const { scene } = host;
  const geometry = new IcosahedronGeometry(1.5, 1);
  const material = new MeshBasicMaterial({
    color: palette.accent,
    wireframe: true,
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  return {
    update(elapsed, pointer) {
      mesh.rotation.y = elapsed * 0.12 + pointer.x;
    },
    resize(width) {
      mesh.position.x = width > 700 ? 0.68 : 0;   // 与 plasma/halo 一致的桌面偏移
    },
    applyPalette(next) {
      material.color.set(next.accent);            // 主题切换时重新着色
    },
    dispose() {
      scene.remove(mesh);                          // 必须摘除并释放
      geometry.dispose();
      material.dispose();
    },
  };
}
```

## 3. 注册（一行）

```ts
// src/lib/orbEffects/registry.ts
import { createMyEffect } from "./myEffect";

const EFFECTS: OrbEffect[] = [
  /* ...既有项... */
  { id: "my-effect", name: { zh: "我的特效", en: "My Effect" }, create: createMyEffect },
];
```

保存后「主题」菜单 → 「开场特效」组会自动出现新选项。`id` 用小写连字符，一旦发布
不要更改（用户选择按 id 持久化；未注册的存量 id 自动回退默认 plasma）。

## 4. 接口契约（必须遵守）

| 成员 | 契约 |
|---|---|
| `update(elapsed, pointer)` | 每帧调用；`elapsed` 秒。reduced-motion 下宿主冻结时钟（恒 0.8）并停用 rAF——效果内**不要再读时钟或 window 事件**，动画幅度自然冻结即可（参考 plasma 用 `host.reducedMotion` 停增量旋转） |
| `resize(width, height)` | 容器尺寸变化；桌面端（>700px）向右偏移 0.68 与站内布局对齐 |
| `applyPalette(palette)` | 主题切换时调用。**必须支持**：把材质/uniform/顶点色重新着色。palette 来自 CSS 变量（`--accent --accent-2 --film --book --music --other --bg`），随任意主题（含自定义导入主题）变化 |
| `dispose()` | 从 `scene.remove(...)` 摘除自己添加的**每一个**对象，并 `dispose()` 全部 geometry/material/texture。漏一项 = 显存泄漏 |

性能纪律：

- 只动画 `rotation`/`position`/`scale`/opacity，不碰几何顶点重建（除非必要且每帧 ≤ 一次）；
- 粒子上限建议 ≤ 1200；DPR 由宿主钳制（≤ 2），效果不要再调 `setPixelRatio`；
- additive blending 材质一律 `depthWrite: false`；
- 不要 `window.addEventListener`——需要交互就用宿主传入的 `pointer`；
- 不要在 effect 里创建第二个 renderer / 读取 localStorage。

## 5. 调色板语义

| 字段 | CSS 变量 | 建议用途 |
|---|---|---|
| `accent` | `--accent` | 主强调（核/主形体） |
| `accent2` | `--accent-2` | 辉光/亮部 |
| `film` `music` `book` `other` | 同名维度色 | 多色混合的点缀（粒子/环） |
| `bg` | `--bg` | 深浅判断（如浅色主题降低 additive 强度） |

切换主题时宿主自动重读 CSS 变量并调用 `applyPalette`——**不要**在效果里缓存旧色。

## 6. 验收清单（新特效合入前自查）

- [ ] plasma ↔ 新效果来回切换 ≥ 4 次无闪黑、无显存增长（dispose 完整）；
- [ ] 切到 paper/retro/minimal 等主题，特效颜色跟随变化（applyPalette 生效）；
- [ ] `prefers-reduced-motion: reduce` 下画面静止但不消失；
- [ ] 窗口缩放（含跨 700px 断点）位置/缩放正确；
- [ ] 刷新后选择持久（registry 已处理，确认 id 在 EFFECTS 里即可）；
- [ ] 移动端（≤700px）居中缩放 0.88–0.9。
