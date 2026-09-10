# UI 前端全流程优化审查报告

基于全量代码审查（App.tsx、所有视图组件、styles.css、Poster.tsx）的 UI 优化建议。

---

## 1. 严重问题（必须修复）

### 1.1 CompareView 渲染期间调用 setState
**位置**：`src/views/CompareView.tsx:13-18`

`setManualOwnSelections` 和 `setManualPeerSelections` 在渲染体内直接调用（不在 useEffect 或事件处理器中），React 18+ StrictMode 会触发两次同步渲染。

**修复**：用 `useEffect` 包裹或改用 `useRef` + 懒初始化。

### 1.2 App.tsx 单体组件过大（~80 个 useState，~800 行）

每次状态变更重新渲染整个组件树，所有弹窗 DOM 即使不可见也在 reconciliation 树中。CompareView 接收 37+ props。

**修复**：用 React Context 共享状态（locale、account、notes），模态框与触发视图共置。

### 1.3 CSS 14 个 !important 覆盖
**位置**：`src/styles.css:23-34`

`.collection-list` / `.collection-row` 需要 14 个 `!important` 来覆盖 `.button` 基础样式，形成脆弱的特异性军备竞赛。

**修复**：给 collection-row 使用独立的 CSS 类而非继承 `.button`。

### 1.4 CSS 重复规则
**位置**：`src/styles.css:84-91` vs `186-191`

`.comment-item`、`.comment-author`、`.comment-content` 被定义两次，值不一致。级联规则让后者覆盖前者，但容易出错。

### 1.5 Modal backdrop 缺少 ARIA 语义

所有 `<div className="modal-backdrop" onClick={...}>` 缺少 `role`、`aria-label`、`aria-hidden`。

---

## 2. 高影响改进（应该修复）

### 2.1 所有模态框缺少焦点陷阱
违反 WCAG 2.1 Level A（2.4.3 Focus Order），键盘用户可以 Tab 出模态框。影响所有 10 个模态框。

### 2.2 大量内联样式
所有视图组件的 `style={{}}` 对象每次渲染创建新引用，无法使用媒体查询，无法统一主题。

### 2.3 关键操作缺少加载状态
- 导出 PNG（涉及图片加载 + Canvas 渲染）无加载指示
- 生成分享链接无 spinner
- AI 解读区域无骨架屏

### 2.4 HomeView 渲染中 Math.random()
`src/views/HomeView.tsx:25` 在渲染体内调用 `Math.random()`，每次重渲染产生不同海报，导致闪烁。应用 `useMemo` 固定。

### 2.5 无错误边界
整个应用没有 React Error Boundary，任何视图运行时错误都会白屏。

### 2.6 键盘可访问性缺陷
- 广场卡片 `<div onClick>` 无 `tabIndex`、`role="button"`、`onKeyDown`
- 批注条目 `<div onClick>` 无键盘支持
- 海报点击 `<div onClick>` 无键盘等效操作

### 2.7 useEffect 缺少依赖数组
`src/App.tsx:354` 的键盘事件监听 useEffect 无依赖数组，每次渲染都重新注册。

---

## 3. 打磨机会（锦上添花）

| 项目 | 位置 | 说明 |
|------|------|------|
| 视图切换无过渡动画 | App.tsx:305 | 添加 fade/slide CSS 过渡 |
| Toast 无进出动画 | App.tsx:810 | 添加 opacity/transform 动画 |
| 按钮高度不一致 | 多个文件 | minHeight: 32/34/38/44px 混用 |
| sessionStorage 无限增长 | Poster.tsx:8-13 | 海报缓存无 LRU 或大小限制 |
| 广场网格响应式冲突 | PlazaView + CSS | inline gridTemplateColumns 覆盖媒体查询 |
| note-textarea placeholder 换行 | App.tsx:813 | 浏览器忽略 textarea placeholder 中的 \n |
| --border 变量未定义 | App.tsx:842 | `var(--border)` 应为 `var(--line)` |
| .note-textarea:focus 重复定义 | styles.css:61,63 | 两个规则冲突 |
| 奖牌 emoji 无 aria-hidden | 多个文件 | 屏幕阅读器不一致朗读 |

---

## 4. 架构观察

### 好的做法
- `focus-visible` 轮廓样式
- `prefers-reduced-motion` 媒体查询
- 三个响应式断点（1300/800/540px）
- OrbScene 懒加载 + 图片 `loading="lazy"`
- 海报双层缓存（内存 Map + sessionStorage）
- 语义化 HTML（ol/section/nav/header/main/footer）
- Toast `role="status"` 无障碍通知
- 排序键盘快捷键（A/D/←/→/1/2）

### 待改进
- App.tsx 单体 800 行，建议 Context + 组合模式
- 无路由库，手动 pushState/popstate
- CSS 单文件压缩格式，建议 CSS Modules 或 Tailwind
- 无 React.memo 优化，所有视图每次重渲染
