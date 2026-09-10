# UI 前端全流程优化审查报告

基于全量代码审查（App.tsx、所有视图组件、styles.css、Poster.tsx）的 UI 优化建议。

---

## 1. 严重问题（必须修复）

### 1.1 CompareView 渲染期间调用 setState ✅ 已修复
**位置**：`src/views/CompareView.tsx:13-18`

已用 `useEffect` 包裹，依赖 `[compareKind, ownRankings.length, peerRankings.length]`。

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

### 2.4 HomeView 渲染中 Math.random() ✅ 已修复
已用 `useMemo` 包裹，依赖 `builtinWorks` 长度，避免每次渲染闪烁。

### 2.5 无错误边界
整个应用没有 React Error Boundary，任何视图运行时错误都会白屏。

### 2.6 键盘可访问性缺陷 ✅ 部分修复
- 广场卡片 `<div onClick>` ✅ 已添加 `tabIndex`、`role="button"`、`onKeyDown`
- 批注条目 `<div onClick>` ✅ 已添加 `tabIndex`、`role="button"`、`onKeyDown`
- 海报点击 `<div onClick>` ✅ 已添加 `tabIndex`、`role="button"`、`onKeyDown`（PlazaPostView、ShareView、CompareRankDetail）

### 2.7 useEffect 缺少依赖数组 ✅ 已修复
已添加依赖 `[view, comparison, accountOpen, act]`。

---

## 3. 打磨机会（锦上添花）

| 项目 | 位置 | 说明 |
|------|------|------|
| 视图切换无过渡动画 | App.tsx:305 | 添加 fade/slide CSS 过渡 |
| Toast 无进出动画 | App.tsx:810 | ✅ 已添加 toastIn 滑入动画 |
| 按钮高度不一致 | 多个文件 | minHeight: 32/34/38/44px 混用 |
| sessionStorage 无限增长 | Poster.tsx:8-13 | ✅ 已添加 500 条上限 LRU 淘汰 |
| 广场网格响应式冲突 | PlazaView + CSS | ✅ 改为 --plaza-cols CSS 变量 |
| note-textarea placeholder 换行 | App.tsx:813 | ✅ 已移除换行符 |
| --border 变量未定义 | App.tsx:842 | ✅ 已修复为 `var(--line)` |
| .note-textarea:focus 重复定义 | styles.css:61,63 | ✅ 已移除重复规则 |
| 奖牌 emoji 无 aria-hidden | 多个文件 | ✅ PlazaView 已添加，其他文件低优先级 |

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
