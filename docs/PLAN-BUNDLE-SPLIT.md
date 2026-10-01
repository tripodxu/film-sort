# PLAN — 迭代 1（优化类）：把 Three.js 从主包真正摘出去

> 状态：🔄 进行中（2026-10-02）
> 类别：**优化**（首屏关键路径体积）
> 纪律：规划 → 执行 → 验证 → 反思 → 一次 commit（见 `docs/agents/CONVENTIONS.md` §7/§8）

---

## 1. 事实（构建产物实测，不是估算）

`npm run build` 后的 `dist/assets`：

| chunk | 原始大小 |
|---|---|
| `index-*.js`（主包） | **963.7 KB** |
| `index-*.css` | 141.9 KB |
| `SourceView-*.js` | 38.1 KB |
| 其余懒加载 chunk | < 38 KB |
| `OrbScene-*.js` | **2.4 KB** |

**指纹检索**（在 `index-*.js` 里数出现次数）：

| 标记 | 主包内出现 | 说明 |
|---|---|---|
| `WebGLRenderer` | 38 | Three.js 渲染器全量 |
| `THREE.` | 41 | Three.js 命名空间引用 |
| `ShaderMaterial` | 16 | 四个特效的着色器材质 |
| `DataTexture` | 7 | plasma 的 CanvasTexture 等 |
| `alphahash_pars_fragment` | 11 | **three 内置 GLSL 着色器库**（`REVISION` 常量被 terser 内联掉了，所以计数为 0） |

结论：**Three.js 全量躺在主包里**。`OrbScene-*.js` 只有 2.4 KB —— 那个 chunk 里根本没有 three
（`REVISION`/`ShaderMaterial`/`alphahash` 计数全为 0），它只是 OrbScene 的壳。

## 2. 为什么：`DeferredOrb` 的 `lazy()` 被旁路了

```
App.tsx ──► ThemeSwitcher.tsx (顶层常驻组件)
                └─ 静态 import ──► lib/orbEffects/registry.ts
                                     ├─ 静态 import plasma.ts ──┐
                                     ├─ 静态 import halo.ts     ├─ 全部静态 import "three"
                                     ├─ 静态 import blackhole.ts│
                                     └─ 静态 import ribbon.ts  ─┘
```

`DeferredOrb` 确实 `lazy(() => import("./OrbScene"))`，但 **treeshaking 是按 chunk 图算的，
不是按运行时**。`registry.ts` 是主包的一部分，它静态依赖的四个特效模块连同 three 就一并留在主包里；
`OrbScene` 这个动态入口再 lazy 也没有意义 —— 它 import 的 three 已经在主包里了。

`DeferredOrb` 的注释写着「Three.js 光球是首屏最大的一块 JS（约 522KB 原始 / 128KB gzip，
占落地页 JS 的 ~45%）」—— **作者清楚它贵，也加了 `requestIdleCallback` 推迟加载，但那份代码
从未真正离开首屏**。省流模式（`saveData` / 2g）确实不会触发 `import()`，可普通用户的首包
依然为此付出 ~522KB。

## 3. 改法：注册表拆成「元数据」与「加载器」两层

核心矛盾：`ThemeSwitcher` 需要**特效列表（id + 中英文名）**来渲染菜单，
`OrbScene` 需要**构造函数**来建场景。前者只需要字符串，后者才需要 three。
现在两者被静态 import 绑死在一起，于是菜单（首屏常驻）拖着 three 一起进主包。

```
registry.ts（保持纯数据，零 three 依赖，可进主包）
  ├─ EFFECT_META: ReadonlyArray<{ id, name: {zh,en} }>   ← 纯字面量，不 import 任何特效模块
  ├─ listOrbEffects() / readOrbEffectId() / writeOrbEffectId() / notifyOrbEffectChanged()
  └─ createOrbEffectById()  ← 改为 async：动态 import 四个 loader

orbEffectLoaders.ts（新，主包内但零 three 静态依赖）
  └─ import("three") 放在函数体内；每个 loader 函数体内动态 import 对应特效模块
```

要点：

1. **`EFFECT_META` 与 `EFFECTS` 必须共享同一份 id 列表**，否则注册表和菜单会漂移。
   用「`EFFECT_META` 是唯一真相、loader 表用 `Record<string, () => Promise<…>>`」的结构，
   并加一条单测断言两者 key 集合相等。
2. **`createOrbEffectById` 从同步变异 async**。调用点只有 `OrbScene.tsx:67` 一处，
   改成 `await` 即可；`mountInstance` 已经是命令式挂载，改成 async 需要防止
   「快速切换特效时旧 await 回来把新实例顶掉」的竞态（用递增 token 守卫）。
3. **`notifyOrbEffectChanged` 的监听方 `OrbScene` 在 `useEffect` 里同步 `mountInstance()`**，
   改 async 后同样要走 token 守卫。
4. **注册表单测要跟着改**：`registry.test.ts:110-131` 的 `createOrbEffectById` 契约用例
   现在是同步调用，改 async 后用 `await`；这条用例原本靠 `ribbon`（无 CanvasTexture 依赖）
   在 node 环境跑通，async 化后依然可以。
5. **tripwire**：新增一条断言「主包 chunk 里不得出现 `WebGLRenderer`」。
   但构建产物不在源码树里，单测读不到 —— 改用**源码级 tripwire**：`registry.ts` 与
   `orbEffectLoaders.ts` 都不得出现字面量 `from "three"`（只允许 `import("three")` 动态形式），
   且四个特效模块不得被任何主包可达模块**静态** import。用源码扫描锁死，
   语义与 `src/ui-fixes.test.ts` 里既有的源码扫描断言一致。

## 4. 不做什么（明确划界）

- 不动 `manualChunks`：`three` 已经被 5 个模块共用，硬拆 vendor chunk 反而多一次请求，
  且掩盖真实的依赖问题。**先修依赖图，再谈分包策略。**
- 不动 `fflate`：`src/lib/utils.ts:28` 的 `decode()` 已经是 `await import("fflate")`，
  但主包里仍有 `compressSync`（3 处）与 `alphahash_*`（11 处）。这是**下一轮**的题目
  （`compressSync` 的调用点需要先查清），本轮不夹带。
- 不动 `lucide-react`：46 次引用是真实使用的图标集合，按需优化收益小、风险高。
- 不改视觉行为：光球效果、时序、reduced-motion 语义全部保持不变。

## 5. 验收

| 门禁 | 判据 |
|---|---|
| 构建 | `index-*.js` 显著变小；出现 `three-*.js` 独立 chunk |
| 指纹 | 主包内 `WebGLRenderer` / `THREE\.` / `ShaderMaterial` / `alphahash_pars_fragment` **全部归零** |
| 体积 | 记录主包 before/after 数字，写进台账 |
| 单测 | `npx vitest run` 全绿（预期 +3：loader key 集合对齐、async 契约、源码 tripwire） |
| 类型 | `npx tsc --b` exit 0 |
| 格式 | `npm run format:check` 通过 |
| 线上 | 部署后线上首页 HTML → 抽取 script 标签确认首包已不含 three 指纹；`/api/health` 正常 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| `createOrbEffectById` async 化引入切换竞态 | 递增 token 守卫，`mountInstance` 开头比对 |
| 动态 import 在 vite 下与静态 import 产物不一致 | 构建后用指纹计数复核，不靠推测 |
| 菜单渲染依赖 `EFFECT_META` 顺序与原 `EFFECTS` 不一致 | 单测断言 id 顺序完全一致 |
