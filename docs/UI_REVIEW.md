# UI 前端全流程优化审查报告

基于全量代码审查（App.tsx、所有视图组件、styles.css、Poster.tsx）的 UI 优化建议。

> 校订说明：全仓已执行一次 Prettier 统一格式化（printWidth 100），本文原引用的**行号全部失效**，
> 现统一改为引用文件与符号名。所有「已修复」标记已按当前代码逐条复核，凡不成立的已改回未修复。

---

## 1. 严重问题（必须修复）

### 1.1 CompareView 渲染期间调用 setState ✅ 已修复
**位置**：`src/views/CompareView.tsx` 的 `CompareView` ——「手动模式下默认全选」的那段 `useEffect`

已用 `useEffect` 包裹，依赖 `[compareKind, ownRankings.length, peerRankings.length]`。

### 1.2 App.tsx 单体组件过大

`App` 组件（`src/App.tsx` 的 `export default function App()`）独占约 2360 行，内含 38 个 `useState`；每次状态变更重新渲染整个组件树。`CompareView` 接收 44 个 props。

补充：各弹窗均为**条件渲染**（`{shareModal && …}` 之类），并不常驻 reconciliation 树，这一点不构成问题；真正的问题只是组件本身过大。

**修复**：用 React Context 共享状态（locale、account、notes），模态框与触发视图共置。

### 1.3 CSS 32 个 !important 覆盖
**位置**：`src/styles.css` 的 `.collection-list` / `.collection-row` 一族规则

`.collection-row` 直接挂在 `<button>` 上，因此需要 32 个 `!important` 来覆盖全局 `button` 基础样式与基础 `.collection-row` 规则，形成脆弱的特异性军备竞赛。（全文件共 37 处 `!important`，其余 5 处属于 `prefers-reduced-motion` 与一个响应式断点。）

**修复**：给 collection-row 使用独立的 CSS 类而非继承全局 button 样式。

### 1.4 CSS 重复规则
**位置**：`src/styles.css` 的 `.comment-item` / `.comment-author` / `.comment-content`

**当前代码中这三个类各只定义一次**（与 `.comment-item-header` 相邻），未再发现重复定义。原报告所记的「定义两次、值不一致」在现文件中无法复现，也无法核实是曾经重复后已被清理，还是原报告有误。

### 1.5 Modal backdrop 缺少 ARIA 语义

14 处 `<div className="modal-backdrop" onClick={...}>` 均不带 `role`、`aria-label`、`aria-hidden`。

但弹窗语义本身没有缺失：每个 backdrop 的内层都渲染了一个 `role="dialog"` + `aria-modal="true"` 的 `<section>`。backdrop 只是纯装饰性遮罩，缺的是「它不应作为可聚焦/可读节点」的显式声明；真正未覆盖的是**焦点陷阱**（见 2.1）。

---

## 2. 高影响改进（应该修复）

### 2.1 所有模态框缺少焦点陷阱 ✅ 部分修复
已创建 `FocusTrap` 组件（`src/components/FocusTrap.tsx`），目前只有指南弹窗（`App.tsx` 的 `showGuide` 分支）接入。其余 13 处 modal-backdrop 仍未接入。

### 2.2 大量内联样式
所有视图组件的 `style={{}}` 对象每次渲染创建新引用，无法使用媒体查询，无法统一主题。

### 2.3 关键操作缺少加载状态 ✅ 已修复
- 导出 PNG：按钮显示「导出中…」+ disabled 状态（`ProfileView` 的 `exporting`）
- 生成分享链接：按钮显示「生成中…」+ disabled 状态（`ProfileView` 的 `busy`）
- AI 解读：按钮已显示「正在生成…」+ 面板区域显示加载脉冲动画（`CompareView` 的 `aiBusy`）

### 2.4 HomeView 渲染中 Math.random() ✅ 已修复
`HomeView` 中按维度随机挑封面（`sampleByKind`）已用 `useMemo` 包裹，避免每次渲染闪烁。
注意实现细节：依赖数组是**空数组**（只在挂载时计算一次），原报告所写的「依赖 builtinWorks 长度」不成立——仓库中不存在 `builtinWorks` 这个标识符。

### 2.5 无错误边界 ✅ 已修复
已创建 `ErrorBoundary` 组件（`src/components/ErrorBoundary.tsx`），在 `App` 中包裹主内容区域。运行时错误会显示友好的重载页面。

### 2.6 键盘可访问性缺陷 ✅ 部分修复
- 广场卡片 `<div onClick>` ✅ 已添加 `tabIndex`、`role="button"`、`onKeyDown`（`PlazaView` 的 `.plaza-sticker`）
- 海报点击 `<div onClick>` ✅ 已添加 `tabIndex`、`role="button"`、`onKeyDown`（`RankingDetail` 的 `.ranking-card-poster`；PlazaPostView、ShareView、比较页榜单详情共用同一实现）
- 批注条目 `<p onClick>` ❌ **未修复**：`ExpandableNote` 只有 `onClick`，没有 `tabIndex` / `role` / `onKeyDown`，键盘无法触发「查看全文」

### 2.7 useEffect 缺少依赖数组 ✅ 已修复
排序页键盘快捷键的 `useEffect` 已补上依赖 `[view, comparison, accountOpen, act]`。

---

## 3. 打磨机会（锦上添花）

| 项目 | 位置 | 说明 |
|------|------|------|
| 视图切换无过渡动画 | App.tsx 的视图渲染分支 | 添加 fade/slide CSS 过渡 |
| Toast 无进出动画 | styles.css 的 `@keyframes toastIn` | ✅ 已添加 toastIn 滑入动画 |
| 按钮高度不一致 | 多个文件 | minHeight 32/34/36/38px 与 CSS 里的 44px 混用 |
| sessionStorage 无限增长 | Poster.tsx 的 `writePosterCache` | ✅ 已添加 `POSTER_CACHE_MAX = 500` 上限与淘汰 |
| 广场网格响应式冲突 | PlazaView + CSS | ✅ 改为 `--plaza-cols` CSS 变量 |
| note-textarea placeholder 换行 | App.tsx 批注弹窗的 textarea | ✅ 已移除换行符 |
| --border 变量未定义 | App.tsx | ✅ 已修复为 `var(--line)`（仓库中现已无 `var(--border)` 引用） |
| .note-textarea:focus 重复定义 | styles.css | ✅ 已移除重复规则（现仅剩一条 `.note-textarea` 规则，且无 `:focus` 变体） |
| 奖牌 emoji 无 aria-hidden | 多个文件 | ✅ PlazaView 已添加；`RankingDetail` 行首的 🥇🥈🥉 仍无（低优先级） |

---

## 4. 架构观察

### 好的做法
- `focus-visible` 轮廓样式
- `prefers-reduced-motion` 媒体查询
- 三个响应式断点（1300/800/540px）
- `DeferredOrb` 在首屏空闲时（`requestIdleCallback`）才加载 3D 光球，省流/2G 直接不加载 + 图片 `loading="lazy"`
- 海报双层缓存（内存 Map `resolvedPosters` + sessionStorage `POSTER_CACHE_KEY`）
- 语义化 HTML（ol/section/nav/header/main/footer）
- Toast `role="status"` 无障碍通知
- 排序键盘快捷键（A/D/←/→/1/2）

### 待改进（暂缓）
- App.tsx 单体组件约 2360 行 → 建议 Context + 组合模式（大型重构）
- 无路由库，手动 pushState/popstate（功能正常，暂无迁移必要）
- CSS 单文件压缩格式 → 建议 CSS Modules 或 Tailwind（工作量大）
- 无 React.memo 优化（性能已可接受）

---

## 进度汇总

| 类别 | 总数 | 已修复 | 部分修复 | 未修复 |
|------|------|--------|----------|--------|
| 严重问题 | 5 | 1 | 0 | 4（1.2、1.3、1.4、1.5） |
| 高影响改进 | 7 | 4 | 2 | 1（2.2） |
| 打磨机会 | 9 | 6 | 1 | 2（视图过渡、按钮高度） |
| **合计** | **21** | **11** | **3** | **7** |

## 剩余未完成项（清单）

1. **App.tsx 单体组件过大**（1.2）——Context + 组合模式，大型重构
2. **CSS `!important` 军备竞赛**（1.3）——`.collection-list` / `.collection-row` 一族 32 处
3. **modal-backdrop 的 ARIA 声明**（1.5）——内层 dialog 语义已具备，缺 backdrop 自身声明
4. **大量内联样式**（2.2）
5. **FocusTrap 覆盖面**（2.1）——13 处模态框未接入
6. **批注条目键盘可达性**（2.6）——`ExpandableNote`
7. **视图切换无过渡动画**
8. **按钮高度不一致**（32/34/36/38/44px 混用）
9. **`RankingDetail` 行首奖牌 emoji 无 `aria-hidden`**（低优先级）

另需复核：1.4「CSS 重复规则」在当前代码中已无法复现，见上文章节说明。

未修复项里 1.2 / 2.2 属大型重构，建议在下次大规模 UI 改版时处理；其余为可独立处理的小项。
