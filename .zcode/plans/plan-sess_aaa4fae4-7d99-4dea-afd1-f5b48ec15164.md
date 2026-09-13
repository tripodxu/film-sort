# ART/RANK 六阶段优化计划（UI 主题优先，可迭代）

> 总原则：每阶段 = 本地 wrangler dev + 浏览器实测 + tsc/vitest 全绿 → commit → push（CF 自动部署）→ 线上抽查；每阶段结束输出「可优化点清单」滚入下一阶段。Phase 1 的功能入口清单建成 docs/FEATURES.md 后作为回归基线，确保不破坏既有功能。

## 现状关键结论（已全量阅读前后端+文档+参考主题）
- 主题化基础为零：styles.css 首行 1.5 万字符压缩块、accent 硬编码 64 处、无 data-theme；内联样式密度 PlazaPostView(68)/App(47)/ProfileView(40)/CompareView(38)。
- other 媒介五处短路（搜索/海报/详情/外部导入/编辑搜索），后端无 /api/other/*；百度百科只取 abstract 不取图，维基无 pageimages。
- PNG 导出 = App.tsx:634 手绘 Canvas 三版式，无设计感、不跟主题。
- 比较指标已有 11 项（profile.ts:300），缺 Kendall τ、Top-K Jaccard、年代偏好、综合评分。
- 文档系统性落后：README 甚至错误否认豆瓣扫码已存在；docs/ 六篇对 9/11 后功能簇近零覆盖；/api/share 在 API.md 整节缺失。
- App.tsx 1002 行、60 个状态、PNG 导出与全部弹窗混在一起。
- 第二主题参照 film-sort2/index.html：编辑部暖纸风（米白 #f4f2ec/森林绿 #173c32/橘红 #e66d3f/暖黄 #f3c86b/DM Mono 眉标/4-8px 小圆角/无玻璃态）。

三个方向性问题你未作答，按推荐定案（可随时纠正）：① UI 主题先行；② App.tsx 渐进拆分（不引状态库）；③ 现代=当前深色为默认、复古=film-sort2 暖纸风、切换入口在顶栏调色板下拉。

## Phase 1 — 主题令牌地基（最高优先，最大工作量）
1. styles.css 令牌化：压缩块按分区逐段解包，抽 :root 设计令牌（--bg/--surface/--text/--border/--accent 系列/--ok/--warn/--danger/--shadow/--radius），rgba 硬编码改 color-mix()；修复未定义的 var(--text)。
2. 主题机制：<html data-theme>，六主题各一个变量覆写块；顶栏调色板下拉切换，存 art-rank:theme；theme-color meta 动态更新。
3. 六套主题（字体/圆角/阴影/质感整体差异，非纯换色）：modern（=现深色玻璃，默认零感知）、retro（暖纸风，Manrope+DM Mono woff2 本地化过 CSP）、minimal（纯黑白灰细线）、simple（浅色扁平蓝灰）、classic（衬线米黄双线框印章红）、cyber（黑底霓虹青品红发光等宽）。
4. 内联颜色清理：高密度视图文件写死色 → 令牌 var（保留动态尺寸类内联）。
5. 移动端专项：540/600px 逐视图走查（topbar 收纳、rank-actions 换行、弹窗全宽、触控目标≥40px），375px 视口实测。
6. App.tsx 渐进拆分（行为不变）：lib/exportPng.ts、components/modals/*（账号/分享/批注/引导）、hooks/useAccountSync、hooks/useCloudCollections；App 降为编排层。
- 验收：六主题 × 8 核心视图截图走查；vitest 全绿；产出可优化点清单 v1。

## Phase 2 — other 类别数据（百度百科 + 维基，含海报）
1. 新增 worker/other.ts：GET /api/other/list?key= 与 /api/other/detail?name=——百度百科 BaikeLemmaCardApi 扩展取图（pic 等字段实测确定）+ 维基 prop=extracts|pageimages&pithumbsize=600 双源合并；复用现有限流/UA 基建，新增 "other" 桶。
2. 前端解锁 other 五处短路：searchWorks/handleCustomSearch/Poster/openArtworkDetail/WorkEditor 搜索走新端点。
3. 图片代理白名单与 CSP img-src 按需扩 bkimg.cdn.bcebos.com / upload.wikimedia.org。
- 验收：「纪念碑谷/蒙娜丽莎/星月夜」等实测出图出简介；film/book/music 回归不受影响。

## Phase 3 — PNG 导出设计感升级
1. 迁 lib/exportPng.ts 后重做：getComputedStyle 采样当前主题令牌，六主题各自配色。
2. 三版式扩为五版式：编辑杂志（大刊头+首件全幅海报+双列文字）/拼贴墙（网格+错落微旋）/极简名录（纯排版大留白）/胶片条（横排缩略+齿孔）/榜单卡（Top3 大海报+奖牌）。
3. 无海报时画主题化占位；文件名含画像名+日期。
- 验收：六主题 × 五版式抽 8 组目测。

## Phase 4 — 比较算法增强
1. compareDimensions 新增：Kendall τ（含并列）、Top-K Jaccard（K=5/10）、年代偏好相似（年份分布差）、综合共识评分（0-100 加权 + 等级文案）。
2. CompareView 指标区重排：主指标大数字 + 次指标折叠明细 + 每指标 ? 悬浮解释。
3. 单测全覆盖新指标（并列/空集/单元素边界）；「相同画像=100%」回归不破。

## Phase 5 — 文档全量重建
1. 新增 docs/FEATURES.md 功能总文档（以本次阅读产出的功能入口全表为骨架，覆盖排序/手动调整/编辑作品/批注/广场全套/导入体系/扫码/Cookie/消歧/管理看板/分享有效期/主题…），作为回归基线。
2. 修订 README（删"不支持豆瓣连接"错误陈述、补 /api/douban/*、/api/netease/cookie、/api/import/douban-list）、API.md（/api/share 整节、edits、visibility、admin 全表、content_source 加 douban、year/creator 参数）、ARCHITECTURE.md（views/、6 新模块、Schema 补 6 表、主题令牌体系）、USAGE.md（导入/扫码/广场编辑/主题用户手册）、CLOUDFLARE.md 重写、DOUBAN_API.md（消歧/subject_collection/mine/扫码）、OPTIMIZATION.md 状态刷新。
3. 端点与代码逐条 grep 核对，杜绝漂移。

## Phase 6 — 组件精益求精（滚动清单）
按各阶段产出清单逐条修，已知候选：PlazaPostView 629 行拆分、CompareView 超长行格式化、styles.css 4 组重复定义清理、clearAllData 与登出清理集合不一致修正、Poster 缓存键加 kind、弹窗焦点陷阱推广、aria-live、OrbScene 移动端降级、长列表虚拟化。

## 风险与护栏
- 压缩块解包回归：按分区小步走，每步截图对比 modern 不变。
- 字体本地化：woff2 入 public/fonts，font-src 'self' 已允许。
- 百度百科无 SLA：失败静默降级为"仅标题"。
- API 向后兼容；迁移只增不改；每 Phase 独立部署可回滚。