# 优化冲刺计划(2026-09-28)

> 执行方式:内联逐个推进,每个 Phase 独立提交并「推送 → 自动部署 → sort.logicc.top 线上验证」后再进下一个。状态标记:⬜ 未开始 / 🔄 进行中 / ✅ 完成 / ⏸ 缓行。

背景与动机见 2026-09-28 会话讨论;事实核查结论:分享页无 OG 元数据、对战卡无触摸手势、Kendall τ 数学已有、qrcode 已动态引入(主包体积来自四个千行视图全量打包)。

---

## Phase 1 ✅ 移动端滑动选择(核心交互)

**目标**:对战页(duel-grid)支持触摸滑动——**往哪边甩就选哪边**(与键盘 ←/A = 左的语义一致):dx < -56px 选左卡,dx > +56px 选右卡;拖动中两卡轻微跟随位移给反馈,松手不足阈值回弹;`navigator.vibrate(10)` 触感确认。

**设计决策**
- 仅 `pointerType !== "mouse"` 启用(桌面鼠选拖拽会与正文选择冲突,键盘/点击已够用);
- 容器级单一 pointer 处理器(非每卡绑定),`touch-action: pan-y` 保垂直滚动原生;`.artwork-info` 内滚与手势无冲突(垂直意图 → `decideSwipe` 判 null → pointercancel);
- 拖动中直接改 transform(ref 引用,不进 React state),松手 commit 前恢复 transition;
- `prefers-reduced-motion` 用户跳过跟随位移(手势本身保留,松手即选)。

**文件**:`src/lib/swipe.ts`(纯函数 `decideSwipe(dx,dy,threshold=56)`)+ `src/lib/swipe.test.ts` + `src/views/SortingView.tsx`(手势)+ `src/styles.css`(`.duel-grid{touch-action:pan-y}`、触屏提示语替换键盘提示)。

**验证**:单测(水平阈值/垂直否决/方向映射)→ 线上 390px 实滑选卡、artwork-info 内滚不受扰、桌面无变化。

## Phase 2 ✅ 分享/广场 OG 卡片(传播漏斗)

**目标**:GET `/share/:code` 与 `/plaza/:id` 返回注入了 OG 元数据的 HTML——`og:title`(「XX 的艺术人格 / 榜单名」)、`og:description`(N 件作品 Top N)、`og:image`(第一名海报,走 `/api/image` 代理补 referer,否则爬虫抓不到豆瓣图)。

**设计决策**:worker 拦截这两个 HTML 路由 → 从 D1 取标题/作者/首图 → 往 `env.ASSETS` 的 index.html `<head>` 注入 meta 再返回;`cache-control: public, max-age=300`;爬虫与用户同 URL,无需 UA 分支。

**文件**:`worker/index.ts`(路由分支)+ `worker/og.ts`(组装+注入,纯函数可测)+ `worker/og.test.ts`。

**验证**:单测注入结果;线上 curl 带 UA 查看含 og: 标签;Telegram/Discord 调试器人工复核(可选)。

## Phase 3 ✅ 广场品味相似度(社交增长)

**目标**:广场帖子卡与详情页显示「与你的品味重合 NN%」徽章——客户端用已有 Kendall τ(`ranking.ts`)对同媒介榜单求相似度;未登录/无同媒介榜单则不显示。

**文件**:`src/views/PlazaView.tsx`、`src/views/PlazaPostView.tsx`、复用 `src/lib/ranking.ts` 的 τ 实现(如需导出小改)+ 单测补齐。

**验证**:单测;线上登录态看广场徽章数值与比较页 τ 口径一致。

## Phase 4 ✅ 按路由拆包(首屏性能)

**目标**:SourceView / PlazaPostView / CompareView 改 `React.lazy` + Suspense(DeferredOrb 同款模式),首屏 JS 预计降 30–40%。

**文件**:`src/App.tsx`(lazy 包裹 + 骨架 fallback)、构建产物核对。

**验证**:构建 chunk 报表对比;线上弱网节流首开;路由切换无闪烁异常。

## Phase 5 ✅ Jev 辅助模式(AI 代判,大件)

**目标**:排序进行中每步先 Jev 预测,confidence ≥ 阈值直接落位并在 UI 标「AI 代判」(可撤销),低置信才问用户;设置开关默认关。预计省 30–50% 取舍。

**文件**:`worker` 批量预测端点(或复用 jev-rank 换 Choice 双选)+ `src/lib/useSorting.ts` 挂钩 + SortingView 代判标记 + 设置开关。

**验证**:单测预测管线;线上真实 key 跑一份榜单,核对代判比例与撤销正确性。

## Phase 6 ✅ 相遇页「预测分歧」洞察(Jev)(2026-09-28)

**目标**:比较页新增「对方最出乎你意料的作品」——Jev 基于我的榜单预测对方排名,与真实排名求偏差 Top3。

**文件**:复用 `/api/ai/jev-rank` 加 predict 模式 + `CompareView.tsx` 洞察区。

**落地**:零 Worker 改动——既有 jev-rank 本身就是「profileContext=谁的品味 → 预测偏好序」,predict 模式即「我的档案 × 对方榜单」的调用语义。新增 `lib/jevDivergence.ts`(偏差 Top3 纯函数 ×7 单测)+ `JevDivergenceCard.tsx`(对齐 AiInsightCard 交互:点击才请求/失败分类/数据签名过期守卫)+ CompareView 接入(对方合并榜单同比较口径)。**验证**:五道门禁绿(481 passed);本地 stub smoke 实锤(倒序 stub → 偏差 +9/−9/+7 数学正确、失败路径带「去配置」按钮);真实 key 端到端留用户日常使用复核。

## Phase 7 ✅ 文化年度报告(Wrapped)(2026-09-30)

**目标**:可导出 PNG 的「年度年鉴卡」:总取舍次数(decisionLog)、榜单/作品数、最纠结一对(回环数据)、媒介占比。印刷年鉴风格,复用 exportPng。

**落地**:数据边界先行确认——decisionLog/cycleEvents 仅存于进行中草稿,画像里没有;年鉴主体用画像统计(复用 galleryStats),取舍+最纠结一对从草稿条件性附加(无草稿省略该节)。`lib/wrapped.ts`(纯函数 ×8 单测)+ `renderWrappedPng`(exportPng 印刷年鉴版式)+ 画像页侧栏「年度年鉴 PNG」按钮。**验证**:五道门禁绿(492 passed);本地烟测捕获生成 blob(2400×2620)逐节核对正确;线上验证随推送进行。

## Phase 8 ⬜ PWA 离线

**目标**:app shell 缓存 SW,主链路(清单→排序→画像)离线可用、可安装。沿用 P0 报告的 SW 导航缓存教训(network-first 导航、cache-first 静态)。

---

*Phase 5–8 为大件,按序推进;若与主线冲突随时可暂停回滚,互不依赖。*
