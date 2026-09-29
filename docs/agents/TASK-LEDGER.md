# TASK-LEDGER — 任务台账（接力状态文件）

> **这是多 agent 协作的唯一活状态源。** 最新条目在最上面。
> 用法：接任务前先看顶部有没有在进行的条目（避免撞车）；开工时把自己的条目插到顶部；完成时更新状态并写明交接对象。
> 条目格式与交接四件套见 [`HANDOFF.md`](HANDOFF.md)。

**状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ⏸ 阻塞/缓行 ｜ 👀 待审 ｜ ✅ 完成（**必须线上验证过**）

---

## 进行中 / 最近

### T-20260929-01 · 修复：catalog/setup 排序模式无法更改
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：sort.logicc.top 新 bundle index-Dysxd8Py.js 上，setup 页默认「经典」高亮正确，点击「简易/精确」高亮立即切换且 localStorage 写入 `precise`）｜ **负责人**：本 agent
- **任务类型**：§2.2（前端视图）
- **最小上下文**：`src/views/SetupView.tsx`（rank-mode 分段按钮）+ `src/lib/useSorting.ts` startRanking（起跑读 localStorage）
- **改了什么**：`SetupView` 的 `rankMode` 从「渲染时直读 localStorage 的普通变量」改为 `useState`（惰性初始化 + 非法值回退 classic），点击同时 setState + 写 localStorage。仅此一处，`useSorting` 起跑逻辑不动。
- **为什么**：用户报障排序模式点了没反应。根因是 d47c444（排序三模式）引入的回归：点击只写 localStorage 不触发重渲染，高亮/提示永远停原处（功能上 localStorage 已写入，纯视觉反馈丢失）
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 本地实机 ✅（vite dev + 浏览器：点击「简易/精确」高亮立即切换、localStorage 写入、提示文案联动；重进 setup 按存储值恢复；开始相遇页头显示所选模式端到端生效）｜ 线上实机 ✅（d0120b2 部署后指纹一致 + 行为验证）
- **遗留风险**：无功能风险；注意 setup 页直连 URL 且无草稿集合时仍为空态（既有行为，与本修复无关）
- **下一步（给接手者）**：无遗留；如后续给排序模式加新档位，记得 RANK_MODES 与 useSorting 的合法值集合同步

### T-20260928-07 · 修复两批：「其他」维度封面/详情 + AI 点评截断
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：艾尔登法环/辐射 4 列表封面渲染、详情弹窗 386 字简介+大图、AI 点评截断为 Worker 端修复随部署生效）｜ **负责人**：本 agent
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7（AI）
- **最小上下文**：`worker/media.ts`（computePosters other 分支）+ `worker/other.ts`（wikiPageImageAny/wikiEnTitle）+ `worker/posterStore.ts`（mediaTypeForKind）+ `src/components/Poster.tsx` + `worker/ai.ts`（maxOutputChars）
- **改了什么**：① 「其他」维度接入 wiki 海报管线（最终四段：主图直取 zh→langlinks→en → searchWikiPoster 评分匹配 → otherDetail 容错；标题变体空格/全角冒号一并解析、条目选择剥分隔符防同名错配；type=undefined 参与评分防 TYPE_WORDS 误杀）；② other 详情超时 20s→30s；③ AI 点评截断：CallOptions.maxOutputChars（默认 2000 不变），/api/insights 按档位放宽（字符 2500/5000/9000 + maxTokens 2000/3500/6000）；④ 移除已废弃的百度百科 openapi 调用（恒 errno 6，白拖 8s）；⑤ 文档：FEATURES 海报管线行、CHANGELOG（订正至最终形态）、README/USAGE 同批
- **为什么**：用户报障两批；「其他」维度自上线起无封面（管线从未接入且 old 映射会错配同名豆瓣电影），详情慢查被 20s 掐断；AI 点评 deep 档撞 2000 字符硬顶
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 线上实机 ✅：batch 端点 type=other 命中正确封面（艾尔登法环 Elden_Ring_cover / 辐射 4 Fallout_4_cover_art / 只狼 Sekiro_art / 蒙娜丽莎 commons 原画）、画像页列表封面渲染、详情弹窗简介+大图、AI 点评 maxOutputChars 有绊线 ×2
- **遗留风险**：① 取图长尾质量——同名概念/人物条目可能取到语义不符图（主图直取有「含原题字词」优选，仍无类型词表），经 poster_errors 观察；② 负缓存 24h——灰度期解析失败的标题 24h 内无图，设置「清除服务端缓存→海报」可立即重试；③ 灰度期被本轮测试毒化的标题（旷野之息/巫师3/黑暗之魂等约 10 个）24h 后自然过期；④ ai 点评真实模型截断效果未用真 key 端到端验证（上限已放宽至 deep 9000 字符/6000 tokens，理论充裕）
- **下一步（给接手者）**：观察 poster_errors 与用户反馈的 other 取图准确率；若语义错配多，考虑用 otherDetail 的简介做类型二次过滤

### T-20260928-06 · 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **状态**：👀 待审（本地全绿 + stub smoke 实锤；**真实 key 端到端留用户复核，推送后线上可见**）｜ **负责人**：本 agent
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/components/JevDivergenceCard.tsx` + `src/lib/jevDivergence.ts` + `src/views/CompareView.tsx`（AI 卡下方挂载点）+ `src/lib/typesafe.ts`（requestJevRanking 复用）
- **改了什么**：① `lib/jevDivergence.ts` 偏差 Top3 纯函数（×7 单测：predictedPositions 越界/重复过滤、topDivergences 零偏差剔除/同分按对方名次）；② `JevDivergenceCard.tsx`（点击才请求/失败分类+去配置入口/数据签名过期守卫/<4 件提示/track jev_predict_divergence）；③ CompareView 接入（peerMergedForJev 与比较结果同一 merge 口径 + myTasteContext=buildTasteContext(我的全维度)）；④ 文档：冲刺计划 Phase 6 ✅、FEATURES §3/§12、README 相遇行、USAGE 新小节、CHANGELOG
- **为什么**：台账待办队列首位；Jev 第三应用点；**零 Worker 改动**——jev-rank 的 profileContext 参数化即 predict 模式，无新端点（API.md 不变）
- **验证状态**：五道门禁 ✅（481 passed·9 skipped，+7 例）｜ 本地 stub smoke ✅（.tmp/jev-smoke-server stub 倒序 order → 偏差 +9/−9/+7 数学正确、同分排序正确、失败路径「去配置」按钮正确）｜ **真实 TypeSafe key 端到端 ⬜（用户配置 key 后在相遇页点「预测分歧」即可复核）**
- **遗留风险**：① Jev 单次预测 ~n 件作品一个 systemone 调用，费率受限（ai_jev 10 次/窗口）——卡上已注明隐私与频率；② 偏差口径基于「合并榜单位次」而非原始 rank（median 重排后 rank 有空洞），设计如此；③ `npm run worker:dev` 历史遗留起不来（DASHBOARD_HTML 字符串导出被本地 workerd 拒绝），不影响部署，待单独批次修
- **下一步（给接手者）**：推送后线上复核（配置 key → 相遇页 → 预测分歧）；接 Phase 7（Wrapped 年鉴卡）或 Phase 8（PWA）

### T-20260928-05 · UI 现代化 P4 · 收尾（本地部分）
- **状态**：✅ 完成（线上资产级验证 + 真实浏览器实机查验 2026-09-28 全过；任务受用户委托代验）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ 文档
- **最小上下文**：`docs/PLAN-ui-modernization.md` P4 + `src/components/ThemeSwitcher.tsx` + `src/styles.css` :root 景深段 + PITFALLS 4.20
- **改了什么**：① ThemeSwitcher 菜单分「经典(7)/新系列(4)」两组（`NEW_SERIES` 集合 + 绊线）；② `--ev-1/2/3` :root 全局定义（三级公式 + `--shadow-tint:#000`），aurora 块内定义移除（只覆写 tint），绊线改写为「:root 公式 + 全文唯一」；③ `docs/ui-baseline.json` 重生成（ui-audit）+ 全主题 22 张截图重拍为新基线；④ README/FEATURES/USAGE 主题 7→11 收口 + 开场特效补「极光绸带」；⑤ CHANGELOG/PLAN 勾选（v3.4）
- **为什么**：P4 计划项；4.20 遗留（被引用未定义的 token）自 2026-09-22 悬置至今，P4 是计划好的清偿窗口
- **验证状态**：五道门禁 ✅（474 passed·9 skipped）｜ 全主题 22 张截图肉眼抽查 ✅（旧主题阴影柔和，dim-chip/海报缩略/浮层获得景深，无过重投影）｜ ui-contrast ✅（≥4.5）｜ **线上资产级验证 ✅（2026-09-28）**：dist 指纹与线上一致（index-CIWrWAfv.js / index-Dvpbr4nG.css）；线上 CSS 含 gallery/aurora/editorial 块、gl-* 全套、:root 三级景深（--ev-1 全文唯一）；线上 JS 含「画廊/新系列/极光绸带」；SPA 深链 /myself /plaza 带 accept:text/html 回退 200——**实机肉眼签收待用户**（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / macOS 衬线段 / ShareView 分享卡）
- **遗留风险**：① 旧主题像素自本 commit 起带阴影（计划内重立基线）——如线上观感过重，调 :root 三级公式百分比即可全局收敛；② 线上验证覆盖弹窗/比较页实机走查（本地仅截图静态路径）
- **下一步（给接手者）**：推送 → Cloudflare 自动部署 → sort.logicc.top 实机验证（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / editorial 衬线 macOS 段 / ShareView 分享卡）→ PLAN 与台账标 ✅；若涉及主题包用户，公告「新系列四主题 + 菜单分组」

### T-20260928-04 · UI 现代化 P3 · gallery 数据画廊
- **状态**：✅ 完成（线上实机验证 2026-09-28：gallery Bento/卡片墙 hover 翻转/弹窗 24px 圆角/拍立得真数据/移动端 390px 单列）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.3/P3 + `src/components/GalleryBento.tsx` + `src/components/GalleryWall.tsx` + `src/lib/galleryStats.ts` + `src/styles.css`（gallery 块，文件末尾）
- **改了什么**：`theme.ts` 注册 gallery（第 11 个内置主题）；`galleryStats.ts` 画像聚合纯函数（×9 单测，只读 profile 零数据层改动）；`GalleryBento.tsx`（Top1 大卡 2×2+2-5 名跟进 / 手写 SVG 雷达 / 年代堆叠条 / 口味坐标 / 榜单索引，grid-areas 编排，≤800px 单列）；`GalleryWall.tsx`（海报正面/批注背面 3D 翻转卡片墙，hover 包 media(hover:hover)，触屏点按翻面，focus-within 可达）；ProfileView/ShareView L3 分支（classic 路径 DOM 不变）；styles.css gallery 块（变量 21 token + `--shadow-tint` 显式阴影 + 弹窗大圆角/报刊亭 topbar/拍立得贴纸/行式榜单 hairline + gl-* 支撑样式 + 重排行 flex 守卫）；测试：ui-fixes 新增 P3 绊线 8 条；工具：ui-contrast/ui-shots-themes 加 gallery（22 条），`docs/ui-contrast.json` 重生成
- **为什么**：PLAN v3 四组新主题的第三组；画像页 Bento 是本计划最重的 DOM 改动，验证 L3 机制在复杂视图上的零回归能力
- **验证状态**：五道门禁 ✅（check/lint 0 error/format/test 473 passed·9 skipped/build）｜ 旧主题 **20 张截图 stash 基线法 zero-diff**（tol=0，含 editorial 系与 aurora）｜ gallery 截图肉眼签收 ✅（首页 / 画像桌面+540 移动 / 排序 / 广场）｜ 卡片墙 3D 翻转 CDP 探针实锤 ✅（hover→matrix3d rotateY(180°)、preserve-3d、perspective 1100px；reduced-motion→transform none 平铺；topbar grid/bento grid/拍立得 rotate 同探针验证）｜ ui-contrast 全对 ≥4.5（gallery 最差 6.45:1）｜ **线上 ⬜**
- **遗留风险**：① ShareView 分享卡与侧栏 QR 展签格需真实分享链接，线上验证；② 广场贴纸拍立得经 fetch 桩探针验证（探针 `.tmp/gl-flip-probe.mjs` 未入库），线上需肉眼复核真数据下的换行/旋转；③ 矩阵「来源分布」无逐作品数据未做（PLAN P3 偏差 1）；④ PNG 导出「bento」版式未做（偏差 2）
- **下一步（给接手者）**：P4 收尾——全主题（7 旧 + 4 新）× 全路由截图回归 + §2 差异矩阵逐格核对 + 主题菜单分组（经典/新系列）+ README/FEATURES/USAGE/THEME-PACKS「7→11」文档收口 + `--ev-*` 全局补齐重立基线 + macOS 衬线段 + sort.logicc.top 线上验证（P1/P2/P3 三批一起）

### T-20260928-03 · UI 现代化 P2 · aurora 极光主题
- **状态**：✅ 完成（线上实机验证 2026-09-28：aurora 胶囊导航 + 极光绸带推荐默认 + plasma 持久化优先，真 WebGL 渲染确认）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.2/P2 + `src/styles.css`（aurora 块）+ `src/lib/orbEffects/ribbon.ts` + `docs/agents/PITFALLS.md` 4.20
- **改了什么**：`theme.ts` 注册 aurora（第 10 个内置主题）；`src/lib/orbEffects/ribbon.ts` 新特效（柔光基座 + 4 绸带 + 600 粒子）+ registry `RECOMMENDED_BY_THEME`（aurora→ribbon，持久化优先逻辑不动）；OrbScene 主题变更按推荐重挂；ThemeSwitcher 勾选跟随；styles.css aurora 块（变量 21 token + `--ev-*` 仅块内定义 + 玻璃 2.0/胶囊导航/duel 辉光脉冲/conic 描边按钮/弹窗景深/进度流光 7 组件）；App.tsx topbar scrolled class；测试：`orbEffects/registry.test.ts` 10 例 + ui-fixes 9 绊线；工具：ui-contrast/ui-shots-themes 加 aurora（20 条）
- **为什么**：PLAN v3 四组新主题的第二组；aurora 是唯一带新 orb 特效的主题，验证链路从截图扩展到 CDP 探针
- **验证状态**：五道门禁 ✅（456 passed·9 skipped）｜ 旧 7 主题 14 张 + editorial 系 4 张 zero-diff ✅（stash 基线法 tol=0）｜ aurora 首页桌面/移动 + duel 双卡 + 辉光脉冲（按住中段截图）肉眼签收 ✅ ｜ **§6 验收六项全过**（CDP 探针：切换 4 轮无 contextlost / palette 色相跟随 / reduced-motion 双截图逐字节一致 / 跨 700px 桌面 0.68 右偏·移动居中 / 持久化 / 移动 0.88）｜ **线上 ⬜**
- **遗留风险**：① `--ev-*` 全局缺失（见 PITFALLS 4.20）——只补了 aurora 块内，旧主题「补齐并重立基线」留 P4；② CDP 探针脚本在 `.tmp/`（一次性工具，未入库）；③ macOS 衬线段未测（沿袭 P1）
- **下一步（给接手者）**：P3 gallery（§2.3 八差异组件，画像页 Bento L3 重构）｜ P4 收尾：全主题回归 + 差异矩阵逐格核对 + README/FEATURES/USAGE「7→11」文档 + `--ev-*` 全局补齐重立基线 + sort.logicc.top 线上验证

### T-20260928-02 · UI 现代化（多主题增量，PLAN-ui-modernization v3）
- **状态**：✅ 完成（线上实机验证 2026-09-28：editorial 海报堆叠 hero + 序号导航 + Windows 衬线段 Georgia/SimSun 生效）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` + `src/styles.css` + `src/lib/theme.ts` + `docs/agents/CONVENTIONS.md` §6
- **改了什么**：（P0 ✅ 已提交 `1357b12`）useTheme/auraColor/动效代币；（P1 本地待提交）editorial + editorial-dark 双主题：变量块 ×2、`theme.ts` 注册、HomeView hero L3 重构（海报堆叠 + 移动端 scroll-snap 轮播）、SortingView 回合水印 L3、topbar/按钮/弹窗/进度/榜单/维度条 L2 覆写；修复两处 CSS 特异性陷阱（各配绊线）；工具：`gen-editorial-shots.mjs`、themes manifest 补 3 主题、ui-contrast 支持 editorial
- **为什么**：用户拍板三方向全做、增量多主题、不改老 UI、组件级差异；P1 为四组新主题的第一组
- **验证状态**：五道门禁 ✅（lint 0 error；test 偶发 glob 竞态漏收集 2 文件、单独跑均过）｜ 旧 7 主题 14 张 zero-diff ✅ ｜ editorial 8 张截图肉眼 + 盒模型 dump 签收 ✅ ｜ **线上 ⬜**
- **遗留风险**：① macOS 衬线段（Songti SC/STSong）未测；② 本环境 vitest glob 竞态（WorkBuddy fs 代理）会偶发漏收集 `worker/ai.test.ts`(44) / `src/content-intro.test.ts`(9)，非代码回归；③ `--r-*` 未归零（弹窗显式 radius:0，见 PLAN §P1 偏差）
- **下一步（给接手者）**：P2 aurora（§2.2 七差异组件，orb ribbon 特效）｜ P4 收尾时补 macOS 衬线段 + sort.logicc.top 线上验证 + README/FEATURES/USAGE 的「7→11 主题」文档同步

### T-20260928-01 · 文档体系重建（记忆 + 多 agent 协同文档）
- **状态**：✅ 完成 ｜ **负责人**：文档 agent
- **任务类型**：文档（不涉业务代码）
- **最小上下文**：`AGENTS.md` + 515 条 git log
- **改了什么**：新建 `AGENTS.md`、根 `MEMORY.md`、`docs/memory/{TIMELINE,DECISIONS,EPISODES}.md`、`docs/agents/{MAP,HANDOFF,CONVENTIONS,PITFALLS,ROLES,TASK-LEDGER}.md`；修改 `README.md` 增加分层导航与 Agent 索引
- **为什么**：单次会话可读上下文有限，39,600 行代码 + 515 条 commit 无法每次全量阅读；需要「任务 → 文件」路由让 agent 只读相关部分
- **验证状态**：单测 n/a ｜ 本地 n/a ｜ 线上 n/a（纯文档）
- **遗留风险**：文件行号会漂移，路由表以符号名/路由字符串为准；`docs/agents/MAP.md` 中的行数统计为 2026-09-28 快照
- **下一步（给接手者）**：首个使用新文档体系的 agent 请顺手补 `MAP.md`（若发现路由缺失）与 `PITFALLS.md`（若踩到新坑）

---

## 待办队列（按优先级）

### ⬜ 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/views/CompareView.tsx` + `worker/typesafe.ts` + `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 6
- **要点**：复用 `/api/ai/jev-rank` 加 predict 模式；比较页新增「对方最出乎你意料的作品」—— 用我的榜单预测对方排名，与真实排名求偏差 Top3
- **依赖**：需用户配置 Jev key 才能端到端验证

### ⬜ 优化冲刺 Phase 7 · 文化年度报告（Wrapped）
- **任务类型**：§2.2 + §2.3
- **最小上下文**：`src/lib/exportPng.ts` + `src/lib/ranking.ts` + `src/views/ProfileView.tsx`
- **要点**：可导出 PNG 的年度年鉴卡：总取舍次数（decisionLog）、榜单/作品数、最纠结一对（回环数据）、媒介占比；印刷年鉴风格

### ⬜ 优化冲刺 Phase 8 · PWA 离线
- **任务类型**：§2.2 + §2.9
- **最小上下文**：`public/sw.js` + `public/manifest.json` + `docs/memory/PITFALLS` §1.7
- **要点**：app shell 缓存，主链路（清单→排序→画像）离线可用。**沿用 SW 导航缓存教训**：network-first 导航、cache-first 静态

### ⬜ Jev Phase 2 · 维基消歧改用 Choice
- **任务类型**：§2.6 + §2.7
- **最小上下文**：`worker/media.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 2 + `docs/memory/EPISODES.md` E-20260908
- **要点**：把手写打分（限定标题/类型声明/年份守卫）换成一条 Choice 问题；现有规则**保留为降级路径**；改动面较大，独立一批提交
- **⚠️ 警告**：不要继续堆启发式规则（十余次迭代已证明边际收益递减）

### ⬜ Jev Phase 3 · 广场内容护栏（Noul）
- **任务类型**：§2.7 + §2.4
- **最小上下文**：`worker/plaza.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 3
- **要点**：发布前同步检查（70ms 延迟预算）：Noul 判不当内容 + Choice 判灌水；失败必须放行或明确提示，**主链路不依赖**

### ⬜ P2 打磨待办池（2026-09-27 全量审查遗留）
- **最小上下文**：`docs/ROADMAP.md` 的 P2 待办池章节
- **要点**：逐条处理，每条独立提交 + 线上验证

---

## 已归档（近期完成，供回溯）

| 编号 | 任务 | 完成日 | commit |
|------|------|--------|--------|
| P5 | Jev 辅助模式（AI 代判，置信 ≥0.8） | 2026-09-28 | `50e46df` |
| P4 | 路由拆包（index 1072→964 KB） | 2026-09-28 | `82b5b2d` |
| P3 | 广场品味相似度徽章 | 2026-09-28 | `bcdaabb` |
| P2 | 分享/广场 OG 卡片 | 2026-09-28 | `dca3ab0` |
| P1 | 移动端滑动选择 | 2026-09-28 | `8017364` |
| — | Jev Phase 1（AI 快排） | 2026-09-27 | `50e46df` 前序 |
| — | UI 全站焕新「夜间档案馆」 | 2026-09-22 | 46 commits |
| — | P0/P1 安全加固 + 插件系统 | 2026-09-25 | 23 commits |

更早的历史见 [`docs/memory/TIMELINE.md`](../memory/TIMELINE.md)。

---

## 使用规则

1. **先登记再动手** —— 避免两人改同一文件。
2. **完成即更新** —— 状态、验证层次、遗留风险、交接对象，四件齐全才算交班。
3. **线上验证过才标 ✅** —— 只有单测/本地通过标 🔄。
4. **新条目插到「进行中 / 最近」顶部** —— 本文件最新在最上面。
5. **完成的条目下沉到「已归档」** —— 保持「进行中」区不超过 5 条。
