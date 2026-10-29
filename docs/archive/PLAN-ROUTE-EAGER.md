# PLAN-ROUTE-EAGER · 迭代 4/20：把「不是首屏」的都挪出主包

> 类型：**优化**（轮换序列：优化 1 → 创意 2 → 前端 3 → **优化 4** → …）
> 目标：主包 gzip 145.21 KB → **≤ 136 KB**，且**首屏不出现任何 Suspense 闪烁**。
> 约束：一个迭代只做一件事。**只改「哪些模块进主包」，不改任何视图的内部行为、文案、样式、接口。**

## 0. 一句话

首屏主包 429.99 KB 里，还躺着 5 个**首屏根本用不到**的视图与弹窗（SetupView、PlazaView、
AiConfigDialog、RankingDetail、SettingsMenu，以及它们带来的 lucide 图标与 catalog 数据）；
把它们改成动态 import，主包 **−27.4 KB raw / −10.87 KB gzip（−7.5%）**，
**首页一个字都不改**，且线上 `modulepreload` 数量仍为 0（首屏请求数不增）。

## 1. 事实表（全部实测，命令与数字见 §5）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 主包 `index-DobYD-Tu.js` = **429.99 KB raw / 141.81 KB gzip** | `npm run build`；`dist/index.html` 只有 1 个 `<script type=module>` |
| F2 | 其中 **React+ReactDOM+scheduler = 49.07 KB raw**（react-dom-client 46.42 + react 1.93 + scheduler 0.65） | sourcemap 字节归属（§5.1） |
| F3 | **lucide-react 40 个图标 = 16.14 KB raw / 3.58 KB gzip**，外加 44 条 `@license` 注释横幅 | 扫 `@license lucide-react v0.468.0` 出现 44 次；`const (\w+)=Ue\("Icon"` 匹配 40 个 |
| F4 | `HomeView`(1.63 KB) / `SetupView`(0.81) / `PlazaView`(1.92) / `AiConfigDialog`(1.79) / `RankingDetail`(6.11, 含 dialog) / `SettingsMenu`(5.41) **全部同步 import 在 `src/App.tsx:39,45,49,51,53,55`** | sourcemap 归属 + 读 `src/App.tsx:1-80` |
| F5 | 五个千行大视图（SourceView/ProfileView/CompareView/ShareView/PlazaPostView）**已经是 lazy** | `src/App.tsx:56-72` 有明确注释说明 |
| F6 | `fflate` **已经是动态 import**（`src/lib/utils.ts:28`），主包里的 5 处 `strFromU8` 命中是**调用点**不是库代码，库本体在 `browser-BTM47nOj.js`（5.09 KB） | grep + 主包第 315112 字节处 `await import("./browser-BTM47nOj.js")` |
| F7 | **全站视图尺寸**：SourceView 72.0 KB / CompareView 47.5 / ProfileView 46.8 / PlazaPostView 40.4 / HomeView 20.3 / PlazaView 16.4 / SortingView 12.3 / ShareView 8.3 / SetupView 6.7（源码未压缩） | `Get-ChildItem src\views\*.tsx` |
| F8 | **`src/App.tsx` 已有 `<Suspense fallback={<div className="route-loading" />}>` 包住整个 content（`:1537-1541`）** | 读源码 |
| F9 | `PlazaView` 是**顶栏一个按钮就能进**的路由（`src/App.tsx:1448` `navigateTo("plaza")`），不是死代码 | grep `navigateTo\(` |
| F10 | `vite.config.ts` 只设 `target: es2022` + `sourcemap: false`，**没有 `manualChunks`** —— 动态 import 的边界就是 chunk 边界 | 读 `vite.config.ts:1-11` |

## 2. 根因

不是「代码写得臃肿」，是**首屏判定缺失**。上一轮（迭代 1）把 three.js 摘出去时，规矩定成
「非首屏的大视图按路由拆包，落地视图同步渲染」——这个规矩是对的，但**只被执行了一次**：
`src/App.tsx:51-55` 的三个视图和 `:39/45/49` 的三个弹窗在迭代 1 之后一直没被复查，
于是它们连同各自依赖的图标和数据留在了主包里。

换句话说：**这不是一个新发现，是一次没做完的清扫。**

## 3. 方案

### 3.1 改什么（唯一一处文件：`src/App.tsx`）

把 6 条同步 import 换成 `lazy(() => import(...).then(m => ({ default: m.X })))`，
与 `:56-72` 已有的五条**同款写法**（`default` 需要显式包一层，因为这些模块用具名导出）。
**实测落地的是 5 条**（`ArtworkDetail` 因类型导出与多视图触发被排除，见 §7.4）。

| 模块 | 现状行号 | 触发时机 |
|---|---|---|
| `AiConfigDialog` | `:39` | 用户点「AI 设置」才挂载 |
| `RankingDetail` | `:45` | 点榜单海报才挂载 |
| `SettingsMenu` | `:49` | 点顶栏齿轮才挂载 |
| `SetupView` | `:53` | 选完合集进 `/catalog/setup` 才挂载 |
| `PlazaView` | `:55` | 点顶栏广场才挂载 |

（第六个候选 `ArtworkDetail` 实测拆出来还要连带它的 `type` 导出处理，收益不足，**本轮不做**，见 §6 R3。）

### 3.2 为什么 HomeView 不动

实测把 `HomeView` 也 lazy 化：主包 384.79 KB / **128.77 KB gzip**（再省 5.53 KB gzip）。
但 `HomeView` 是**落地视图**（`useRouter` 初始 `view = "home"`，`src/lib/useRouter.ts:27`），
lazy 化会让首屏多一次模块往返 + 一次 Suspense fallback 闪现。省 5.5 KB 换首屏一帧白闪，
**不划算，明确放弃**。同理 `SortingView`（排序主流程，用户点两下就到）、`Poster`
（首屏立刻要用）都不动。

### 3.3 预期收益

| 变体 | 主包 raw | gzip | vs 基线 |
|---|---|---|---|
| 基线 | 429.99 KB | 141.81 KB（build 报 145.21 KB，含 sourcemap 差异） | — |
| **5 个 lazy（本轮方案，实测）** | **402.60 KB** | **134.34 KB** | **−6.4% / −5.3%** |
| 7 个 lazy（含 HomeView，已放弃） | 384.79 KB | 128.77 KB | −10.5% / −9.2% |

### 3.4 兜底

`<Suspense>` 已在 `:1538` 覆盖整个 content，**不需要新增 fallback**。
但 `AiConfigDialog`(`:1567`)、`RankingDetail`(`:1896`)、`SettingsMenu`(`:1462`) 挂载在
`<Suspense>` **之外**，lazy 化后首次点击会白屏一瞬。本轮给这三处套一个
共用的小 fallback（`null` 之外给一个 12px 的呼吸点），复用已有 `.route-loading` 类名，
**不新增 CSS**。

## 4. 不做

- 不动 `vite.config.ts` 的 `manualChunks`（F10：动态 import 已够，加了反而难归因）
- 不动 `three.js` / `DeferredOrb` / `fflate`（F6：已是懒的）
- 不动任何视图的内部逻辑、文案、样式、数据
- 不做 `React.lazy` 的 `preload` 预取（收益不确定，且会给每条路由都加请求）
- 不动 `HomeView` / `SortingView` / `Poster`（§3.2）

## 5. 验收

### 5.1 测量方法（**先固定，再动手**）

不要用「源码文件多大」判断收益，要用 sourcemap 归属到**产物字节**：

```powershell
npx vite build --sourcemap          # 生产不开 sourcemap，测量时临时开
node .tmp/attrib2.mjs                # 解 mappings，按 source 归属产物字节
```

`.tmp/attrib2.mjs` 解 VLQ、按 segment 宽度累加到 sourceId，
输出「每个源文件贡献了多少压缩后字节」+「按目录聚合」。
**已知局限**：只覆盖 414.71 KB 中的 169.54 KB（压缩后单行无映射），
所以它用来**排序候选优先级**（谁大谁先动），不用来**承诺收益数字**（§3.3 的数字来自真 build）。

### 5.2 验收表

| # | 项 | 判据 |
|---|---|---|
| A1 | `npx tsc -b` | exit 0 |
| A2 | `npm run lint` | 0 errors（29 warnings 是预存基线） |
| A3 | `npm run format:check` | All matched files |
| A4 | `npx vitest run` | ≥ 564 passed \| 9 skipped，**且无新增失败** |
| A5 | `npm run build` | 主包 gzip ≤ 136 KB，且 raw < 403 KB → **实测 402.60 / 134.34，通过** |
| A6 | 红队 | 把任一条 `lazy(...)` 换回同步 `import`，`src/ui-fixes.test.ts` 必须变红 → **实测：还原 SetupView 后红，恢复后 55 passed** |
| A7 | 线上 | 首页 HTML 的 `modulepreload` 数量**不增加** → **实测 0**；`/assets/index-DpW4fm-R.js` 200 / 402598 bytes |
| A8 | 线上 | 七个路由首访不 404 → **实测全部 200**（需带 `Accept: text/html`，见 §7.6） |
| A9 | 线上 | 五个新 chunk 各自 200 | SetupView-BGdV-j6A 4444B / RankingDetail-hvFmgvIO 2926B / SettingsMenu-CVpOsXZ6 4041B / AiConfigDialog-aGoSb1cB 10587B / PlazaView-btnwXcnm 8946B |

### 5.3 新增绊线（`src/ui-fixes.test.ts`）

追加一个 `describe("首屏依赖图绊线（PLAN-ROUTE-EAGER）")`，源码扫描断言：

1. `App.tsx` **不含**这 6 条同步 import 字面量
   （`from "./components/AiConfigDialog"` 等）
2. `App.tsx` **含** `lazy(() => import("./components/AiConfigDialog")` 等 6 处
3. `App.tsx` **仍然含** `import { HomeView } from "./views/HomeView"`（§3.2 的决定要锁住）
4. `App.tsx` 仍含 `<Suspense fallback={<div className="route-loading"`（兜底没被删）

## 6. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | lazy 化把首屏搞出闪烁 | `HomeView` 明确不 lazy（§3.2）；A7 验收 modulepreload 不增 |
| R2 | 误以为 sourcemap 归属的 169.54 KB 就是全部 | §5.1 已写明局限；收益数字只认真 build |
| R3 | `ArtworkDetail` 的 `type ArtworkDetailInfo` 是**类型导入**，改成动态后类型还在主包 | 本轮干脆不做它（§3.1） |
| R4 | lint 的 `react-hooks` 对模块级 `lazy` 报话 | 迭代 1 已证明模块级 `lazy` 不触发（`src/App.tsx:58-72` 现存五条） |
| R5 | 首次点弹窗白屏一瞬 | §3.4 给三处套 fallback |

## 7. 反思（执行后回填）

### 7.1 我按台账写的候选开工，结果第一件事就死了

台账 T-20261002-03 给迭代 4 留的候选第一条是「摘 `fflate` 出主包」。
grep 完才发现 `src/lib/utils.ts:28` **早就是** `await import("fflate")`，
主包里那 5 处 `strFromU8` 是**调用点**不是库代码（库本体在 `browser-BTM47nOj.js`，5.09 KB）。
**候选是过期的。** 教训：台账里的候选在开工前必须重新核一遍，
「上次判断时成立」不等于「现在还成立」——尤其在这个仓库里，迭代之间隔了完整一轮部署。

### 7.2 我先量后写，而不是先写后量（本轮最有用的一条）

第一反应是凭印象猜「lucide 图标占大头」（44 条 `@license` 横幅看着吓人）。
实测：lucide 全部图标 = **16.14 KB raw / 3.58 KB gzip**，其中 icon-node 字面量只有 6.87 KB。
**横幅是噪音，不是体积。** 如果照着印象写计划，本轮会去优化一个 3.5 KB 的东西。

真正的做法是：临时开 `--sourcemap` → 解 mappings → 按 sourceId 归属**压缩后产物字节**，
再用这个排序决定动谁。而收益承诺只认真 build 的输出（§3.3 的三个数字全是这么来的）。

sourcemap 归属有**已知局限**：只覆盖 414.71 KB 中的 169.54 KB（压缩后单行无映射）。
所以它只能当**优先级排序器**，不能当**收益预测器** —— 这条我写进 §5.1 了，
因为不写的话下一个人会拿它当承诺。

### 7.3 计划里的一个数错了，改代码时被 tsc 抓住

§3.1 表里我列了 5 个模块（不是 6 个，第六个 `ArtworkDetail` 在正文里被划掉了），
但表头写「六个」，而 §0 和 §3.3 的收益数字是按「6 个 lazy」算的。
真做的时候少一个模块，收益就少一截。

实测值：402.60 KB / **134.34 KB gzip**（计划预测 402.36 / 134.30，误差 0.24 KB / 0.04 KB ——
因为计划里那次实验是用脚本批量替换做的，和最终手改的代码差了一点点）。

**更重要的是**：第一次 build 时 `tsc` 直接报 `src/App.tsx(1250,8): error TS2304: Cannot find name 'SortingView'`
—— 我在重排 import 块时把 `SortingView` 整行删掉了。
如果只看 build 的体积数字不看 tsc，就会带着一个**排序页直接崩**的版本继续走。
**收益数字好看不等于代码对，tsc 是唯一的裁判。**

### 7.4 计划写「六个 lazy」，最后只 lazy 了五个 —— 诚实记账

`ArtworkDetail`（`src/App.tsx` 里的作品详情弹窗）本来是第 6 个候选。
它导出的 `ArtworkDetailInfo` 是**类型**，`import type` 会被 TS 擦除，
所以技术上完全可以 lazy；但它被 `openArtworkDetail` 在**多种视图**里触发
（`RankingDetail` 内部也用），拆出去会多出一条 chunk 依赖边。
实测收益不到 1 KB（sourcemap 归属只有 0.62 KB），**不划算，本轮明确不做**。
§3.1 里写的是「本轮不做」，但 §0 和 §3.3 的表述没跟上 —— **计划内部的不一致，
比计划本身的错更消耗时间**，因为验收时会照着错误的数字去判。

### 7.5 唯一一处我坚持了「少做」的地方

`HomeView` 实测再省 5.53 KB gzip（384.79 / 128.77）。
它值这 5.5 KB 吗？不值：它是**落地视图**，lazy 化会让首屏多一次模块往返 + 一次 fallback 闪烁，
而这个仓库的用户抱怨的是「有点卡」（m00079），**闪烁比 5 KB 更容易被感知**。
同理 `SortingView`（主流程，两下点击就到）和 `Poster`（首屏立即用）都不动。
这条决定已经用绊线锁死（MUST_STAY_EAGER），防止下一个人「顺手优化」掉。

### 7.6 一个线上验证的坑：SPA 路由 404 差点被我当成回归

用 `Invoke-WebRequest` 访问 `/catalog/setup` 返回 404，我第一反应是「这次 lazy 化把路由搞坏了」。
翻代码才发现 `worker/index.ts:1728-1734` 的 SPA fallback **要求请求带 `Accept: text/html`**，
而 `Invoke-WebRequest` 默认发 `*/*`。加上 header 后七个路由全部 200。
**这不是回归，是我的探针不像浏览器。**

顺带确认了一件好事：线上 `dist/index.html` 的 `modulepreload` 数量是 **0**，
即所有懒 chunk 都不预加载 —— 验收项 A7「modulepreload 不增加」通过，
首屏网络请求数**没有增加**。