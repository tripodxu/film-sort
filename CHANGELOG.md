# Changelog

## 2026-09-28 · 修复两批：「其他」维度封面/详情 + AI 点评截断

用户报障两批，均已确诊修复：

### ① 「其他」维度的作品没有封面和详情
- **封面根因**：海报管线对 other 一直不解析（`TYPE_BY_KIND.other` 映射到 movie、`mediaTypeForKind("other")` 返回 null、`computePosters` 无 other 分支）——「其他」维度作品在所有界面只有图标兜底
- **修复**：接入 wiki 取图管线——`PosterBatchRequest`/`computePosters`/`normalizePosterItem`/`mediaTypeForKind` 全部放行 type=other；`computePosters` 新增 other 分支直走 `searchWikiPoster`（**type 以 undefined 参与评分**：TYPE_WORDS 无 other 词表，带着 "other" 时 declareType 从正文推断的 movie/book/music 会把正确条目全部误杀）；维基图域本就在 allowedImage/CSP 白名单。广场 other 帖的 `resolveStoredPosterUrls` 查找随 mediaTypeForKind 放大自动生效
- **详情根因**：`openArtworkDetail` 的 other 分支 20s 超时——维基 zh→en→百科兜底链冷缓存实测可超 25s，本可成功的详情被掐成「暂时没有更多资料」。放宽到 30s
- **测试**：posterStore 语义翻转（other → "other"）+ normalizePosterItem other 合法条目，×2 更新/新增

### ② AI 点评截断（超出一定字数不显示）
- **根因**：`worker/ai.ts MAX_OUTPUT_CHARS=2000` 输出字符硬截断——deep 档 500 字 + 三段序号结构轻松超 2000 字符被拦腰斩（`maxTokens` 此前已按档位放宽，但字符顶没动）
- **修复**：`CallOptions.maxOutputChars`（默认 2000 保持其他调用方不变）；`/api/insights` 按档位放宽——字符 brief 2500 / standard 5000 / deep 9000，maxTokens 同步 brief 2000 / standard 3500 / deep 6000（推理模型 reasoning 段与正文共享预算）
- **测试**：`callAi` 默认 2000 + maxOutputChars 覆写生效，绊线 ×2

## 2026-09-28 · 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）

比较页新增「预测分歧 · JEV」卡——「对方最出乎你意料的作品」：

- **语义**：用「我的」品味档案让 Jev 预测「我」会怎么排对方的榜单，与对方真实排名求偏差——偏差最大 Top 3 即对方的意外之爱（+N，对方排得比按我品味的预测更高）与冷遇（−N，更低）
- **零 Worker 改动**：既有 `/api/ai/jev-rank` 本身就是「profileContext=谁的品味 → 预测 works 偏好序」，predict 模式即「我的档案 × 对方合并榜单」的调用语义（计划写「加 predict 模式」，实际为纯复用，无新端点、`docs/API.md` 不变）
- **新增**：`lib/jevDivergence.ts` 偏差 Top3 纯函数（×7 单测：位置换算/越界过滤/零偏差剔除/同分按对方名次）；`JevDivergenceCard`（对齐 AiInsightCard 交互：点击才请求不预取、失败按原因分类带「去配置」入口、数据签名变化即旧结果作废防张冠李戴、榜单 <4 件提示无参考价值）；CompareView 接入（对方合并榜单与比较结果同一 merge 口径，自动/指定/三档深度全兼容）
- **验证**：五道门禁绿（481 passed·9 skipped）；本地 stub smoke 实锤（倒序 stub → 偏差 +9/−9/+7 数学正确、同分排序正确、失败路径正确显示）；真实 TypeSafe key 端到端留用户日常复核（台账依赖项）
- **备注**：`npm run worker:dev` 本地起不来系历史遗留（`DASHBOARD_HTML` 字符串导出被本地 workerd 拒绝，线上部署不受影响），smoke 改走 .tmp 静态服务 + stub

## 2026-09-28 · UI 现代化 P4 · 收尾（本地部分完成，线上验证待推送）

`docs/PLAN-ui-modernization.md` P4 的本地可完成项：

- **主题菜单分组**：调色板菜单分「经典（7）/ 新系列（4）」两组（`ThemeSwitcher.tsx` + `NEW_SERIES` 集合），11 个主题平铺不再拖长菜单；自定义主题与开场特效/布局模式组不变
- **`--ev-1/2/3` 全局补齐（PITFALLS 4.20 清偿）**：`:root` 定义三级景深公式（`--shadow-tint:#000` + 1px 内高光 / 45px 卡片影 / 80px 弹层影），aurora 块内旧定义移除（只覆写 tint 色相），gallery 本就不定义——**旧主题自此长出阴影，属计划内重立基线**：`docs/ui-baseline.json`（ui-audit）已重生成；全主题 22 张截图重拍为新基线；P1-P3 各批 zero-diff 证据以各自 commit 为界；绊线改写为「:root 三级公式 + 全文唯一」语义
- **文档收口（7→11）**：README（功能清单 + 界面设计）、FEATURES §8（主题表重写 + 回归清单）、USAGE（三处主题表述 + 开场特效补极光绸带）、THEME-PACKS §8（gallery 入内置结构主题清单，P3 已做）
- **回归**：五道门禁绿（474 passed·9 skipped，绊线 +1：菜单分组/主题数）；全主题 22 张截图肉眼抽查（modern/retro 阴影柔和、无过重投影）
- **待线上**：sort.logicc.top 实机验证（P1/P2/P3 三批一起标 ✅）+ macOS 衬线段（Songti SC/STSong）实测——需推送触发 Cloudflare 自动部署

## 2026-09-28 · UI 现代化 P3 · gallery 画廊主题（本地验证完成，线上留 P4）

新增内置主题「画廊」（`docs/PLAN-ui-modernization.md` §2.3，8 个差异组件，L1 变量 + L2 结构覆写 + L3 条件渲染）：

- **画像页 Bento 网格（L3）**：`src/components/GalleryBento.tsx`——Top1 大卡（2×2，含 2-5 名跟进行）+ 手写 SVG 维度雷达（四媒介固定轴，值=各媒介作品数占比）+ 年代堆叠条（按维度分行、段色随年代由浅入深、右端跨度刻度）+ 口味坐标（作品/创作者/榜单/年代跨度）+ 榜单索引（承接维度页签切换职能）；`grid-template-areas` 编排，≤800px 单列堆叠；数据全部由 `src/lib/galleryStats.ts` 纯函数现场聚合（×9 单测），零数据层改动
- **榜单卡片墙（L3）**：`src/components/GalleryWall.tsx`——海报正面（名次徽章 + 渐变字幕）/ 批注背面（摘录 + 批注/详情入口），hover（桌面，`media(hover:hover)` 包裹防触屏粘滞）或点按（触屏）3D 翻转；CDP 探针实证 hover 时 transform=rotateY(180°)、`preserve-3d`/`perspective:1100px` 在位；reduced-motion 降级为正反面文档流平铺（探针实证 hover 后 transform 仍 none）
- **分享卡（L3）**：ShareView 在 gallery 家族渲染「Bento 缩略」分享卡（Top1+雷达+年代+坐标，无切换语义）于榜单区之上；画像页侧栏 `.share-output` 由 L2 改为「二维码与链接并排的展签格」
- **topbar 对称报刊亭（L2）**：`display:grid` 三列——Logo 居中、导航居左、工具居右（PITFALLS 4.12 显式声明纪律）
- **弹窗/菜单（L2）**：大圆角（`--r-lg=24`）+ 无边框纯阴影（`--shadow-tint` 显式 color-mix），与 editorial 直角两极
- **广场贴纸拍立得化（L2）**：白框 + 纵排 + 居中斜体衬线标题区 + 交替微旋转（±1.15°）+ hover 立起；CDP 探针实证 column/rotate/shadow；纯 CSS，DOM 不变
- **行式榜单配套 L2**：编辑器/重排/详情弹窗/分享页仍在用的 `.ranking-list` 收编为 hairline + mono 蓝名次（去 P0.7 墨块名次牌）；**重排行 flex 守卫**：gallery 的 (0,2,1) grid 声明位于文件后部，必须以 (0,3,1) 把 P6 的 flex 覆盖要回来（PITFALLS 4.19 同源纪律，有绊线）
- **铁律遵守**：`--ev-*` 不定义（PITFALLS 4.20 基线不破坏，阴影全部显式书写）；hex 只进变量块；旧 7 主题 14 张 + editorial 系 4 张 + aurora 2 张共 **20 张截图 stash 基线法 tol=0 zero-diff**
- **验证**：五道门禁绿（test 473 passed·9 skipped）；`ui-contrast` 全对 ≥4.5（gallery 最差 6.45:1），`docs/ui-contrast.json` 已重生成；gallery 截图肉眼签收（首页/画像桌面+移动/排序/广场，卡片墙翻转由探针截图实锤）+ 新增绊线 8 条（`src/ui-fixes.test.ts` P3 describe）
- **偏差记录**：① 矩阵「年代/来源分布」的「来源」无逐作品数据（Artwork 无 source 字段），落地为「年代分布（按维度分行）+ 跨度刻度」，来源分布不做；② PNG 导出未加「bento」版式（exportPng 为 canvas 绘制域，与本主题视觉域正交），「分享卡片重设计」以 ShareView Bento 缩略 + 侧栏 QR 入网格兑现；③ 广场贴纸的拍立得形态经 fetch 桩探针验证（广场需后端数据，静态截图无帖）
- **工具链**：`ui-contrast.mjs`/`ui-shots-themes.json` 加 gallery（现 22 条）；一次性探针 `.tmp/gl-flip-probe.mjs` 未入库（同 P2 先例）
- **遗留**：sort.logicc.top 线上实机验证按计划留 P4；ShareView 分享卡需真实分享链接在线上验证

## 2026-09-28 · UI 现代化 P2 · aurora 极光主题（本地验证完成，线上留 P4）

新增内置主题「极光」（`docs/PLAN-ui-modernization.md` §2.2，7 个差异组件，L1 变量 + L2 结构覆写）：

- **首页 orb 新特效「极光绸带」**（`src/lib/orbEffects/ribbon.ts`）：柔光基座（双层 additive 球）+ 4 条 CatmullRomCurve3 绸带（各挂一个维度色）+ 600 上升粒子；遵守 ORB-EFFECTS §4 契约（四成员齐全 / 粒子 ≤1200 / additive depthWrite:false / 不监听 window / reduced-motion 冻结）；注册表新增 `RECOMMENDED_BY_THEME`（aurora→ribbon，无持久化选择时生效，既有持久化逻辑不变）
- **表面体系 玻璃 2.0**：identity/home-actions/segmented 改「ev 投影 + accent-2 内高光 + accent 外柔光」三层；`.medium-item` 保持透明扁平（设计意图）
- **topbar 悬浮胶囊导航**：sticky 脱离子页面顶线 + 玻璃胶囊 + 滚动加深 + active 胶囊底；≤540px 降级纯文字链接（规避 4.7 overflow 裁切）
- **duel 卡**：胜出辉光脉冲（`:active` 触发，reduced-motion 跳过）+ 卡角加大到 `--r-lg`
- **按钮**：conic 渐变描边 hover 流转（`@property --au-angle` 注册角度后可动画）+ primary 柔光投影
- **弹窗/菜单**：`--ev-1/2` 重写 + scrim blur(14px) 更深景深
- **进度/维度条**：渐变流光填充 + 微光头部（reduced-motion 退化纯色）
- **回归实证**：旧 7 主题 14 张 + editorial 系 4 张截图 stash 基线法 tol=0 zero-diff；aurora 首页（桌面/移动）、duel 双卡 + 辉光脉冲（按住中段截图）、进度流光肉眼签收
- **§6 验收六项全过**（CDP 探针脚本化）：plasma↔ribbon 切换 4 轮 canvases 恒 1 无 contextlost；retro/minimal/paper 下 palette 色相跟随；reduced-motion 双截图逐字节一致且画面不消失；跨 700px 断点桌面右偏 0.68 / 移动居中；localStorage 持久化；移动端 0.88 缩放
- **偏差记录**：① `--ev-1/2/3` 自 `7fb1d5c` 起被引用但从未定义（旧主题阴影实际为 none，P1 基线即此状态）——只在 aurora 块内补定义守 zero-diff，全局补齐另立基线留 P4；② 工具链截图无 orb 系 `ui-shot.mjs` 显式 `--disable-webgl` 的环境限制（modern 基线同样无），ribbon 实渲染由 CDP 探针软渲 WebGL 确认
- **工具链**：`ui-contrast.mjs`/`ui-shots-themes.json` 加 aurora（现 20 条）；aurora 对比度全对 ≥4.5（最差 7.8:1）
- **遗留**：sort.logicc.top 线上实机验证按计划留 P4

## 2026-09-28 · UI 现代化 P1 · editorial / editorial-dark 双主题（本地验证完成，线上留 P4）

新增两组内置主题「刊物 / 刊物暗色」（`docs/PLAN-ui-modernization.md` §2.1，9 个差异组件，L1 变量 + L2 结构覆写 + L3 条件渲染三层机制）：

- **首页 hero（L3 DOM 重构）**：左文右图杂志封面式；3–4 张收藏海报错落堆叠（桌面绝对定位 ±6° 旋转 + hover 展开；移动端改 scroll-snap 单张轮播，零 JS）；eyebrow 改「第一期 · 你的私人文化索引」期号；orb 隐藏；空维度由 CSS 占位色块补齐（槽位↔维度一一对应）
- **标题体系**：h1 衬线（Georgia→Songti SC→SimSun 链）+ 字重 600；区块巨型序号装饰
- **topbar**：active 项序号前缀（01 排序 / 02 画像）+ 底部通栏细线；**按钮**全圆角 pill 实色；**弹窗/菜单**显式直角 + 2px 实线框、去玻璃 backdrop
- **duel 卡（排序页）**：去卡片化——海报铺底 + 衬线标题排印，「第 N 回合」巨型衬线水印（L3 注入）；**进度**改页码排印 + 发丝轨道尺规刻度；**榜单**行式排印去卡片；**画像维度条**坐标纸细网格
- **回归实证**：旧 7 主题 × home/profile 共 14 张截图 tol=0 zero-diff（P0 基线 vs P1 对比）；editorial 桌面 4 张修复前后 0 diff；移动端 home 双主题仅轮播右缘 48px 条带与标题细线端点变化（盒模型 dump 逐项核对）
- **修复两处特异性陷阱**（各配 `src/ui-fixes.test.ts` 绊线）：① 桌面 `.ed-stack-item:nth-child(N)` 定位泄漏到移动端轮播（媒体查询不加特异性，同名类 (0,1,0) 压不过 (0,2,0)）→ 后代前缀 + nth-child 抬到 (0,3,0)；② 移动端单列网格覆写被样式表后置的基座 `.orb-hero-inner` 规则后来者胜（死代码，mobile 实测双轨 + 48px column-gap）→ 双类选择器抬到 (0,2,0)
- **工具链**：`scripts/gen-editorial-shots.mjs`（一次性 manifest 生成器）、`scripts/ui-shots-themes.json` 补 paper/editorial/editorial-dark 归档、`scripts/ui-contrast.mjs` 支持 editorial
- **遗留**：macOS 衬线回退段（Songti SC/STSong）无设备未测；sort.logicc.top 线上实机验证按计划留 P4；`--r-*` 未归零（弹窗走显式 radius:0，见 PLAN §P1 偏差记录）

## 2026-09-28 · 优化冲刺 P1-P5（滑动选择 / OG 卡片 / 品味相似度 / 路由拆包 / Jev 辅助）

### P1 移动端滑动选择
- 对战页触摸滑动：往哪边甩就选哪边（与键盘 ←/A = 左同语义）；56px 阈值 + 垂直意图否决（artwork-info 内滚与页面滚动零干扰）；拖动跟随位移直接写 transform（reduced-motion 跳过）；鼠标不启用（桌面保留点击+键盘）；触屏提示语替换键盘提示；commit 时 vibrate(10)
- 纯判定逻辑 `lib/swipe.ts`（可单测）；线上合成触摸全链路验证

### P2 分享/广场 OG 卡片
- 爬虫不发 JS——worker 对 `/share/:code` 与 `/plaza/:id` 的 HTML 请求注入 og:/twitter: 元数据：share 链接出画像名+榜单/No.1；广场帖出标题+作者+件数+首位作品海报（服务端从海报侧表解析，豆瓣域走 `/api/image` 代理让爬虫可取）
- 用户可控文本全部 HTML 转义后再进 meta；任何 DB/解析异常降级为无 OG 的普通 SPA

### P3 广场品味相似度
- `lib/similarity.ts`：Jaccard 重合 + 共同作品顺序一致度（workIdentity 匹配，与落库管线同口径）
- 卡片徽章「重合 N/3」（对方前三名在我同媒介榜单中的件数）；详情页「与你的品味重合 NN%」（共同 ≥3 件才显示，低于即噪声不渲染）

### P4 路由拆包
- SourceView/ProfileView/CompareView/ShareView/PlazaPostView 改 React.lazy + Suspense（DeferredOrb 同款）；index chunk 1072→964KB（gzip 307→279）

### P5 Jev 辅助模式（AI 代判）
- 排序中每对先经 `/api/ai/jev-pick`（Choice 二选一）预测：置信 ≥0.8 自动落位并标注「上一对由 Jev 代判 · 置信 NN%」（进决策日志可撤销）；低于阈值或复测阶段交还用户
- 开关在 AI 弹窗 Jev 区，默认关；键控竞态守卫丢弃迟到响应——绝不覆盖用户真实选择；品味上下文（既有榜单摘要）随请求带上

## 2026-09-27 · UI 全量打磨 + 移动端抢救 + Jev 集成 Phase 1（AI 快排）

### UI 打磨（全部线上验证）
- 移动端 Hero 抢救：identity 胶囊退出 v2 网格流（修复 ART/RANK 断行成 RA/NK、竖排书脊压眉标）；光球衬纸渐变；≤540px 竖排书脊转横排
- 顶栏收纳：≤540px 导航收 3 项（`:nth-child(4)`，修复匿名用户「广场」被 `:last-child` 误伤）、图标 27px、双语 320px 零溢出；设置/主题下拉改锚 topbar（修复 overflow-x 隐式裁剪下拉——「点击设置什么都看不见」）；触屏 tooltip 粘滞根治（hover:none 隐藏）；hero「继续上次进度」收编为同款 chip 并与主按钮左对齐
- 名次墨块竖排修复（36px 定宽遗留 × P0.7 padding 冲突）；重排行 5 子元素 flex 覆盖（(0,2,1) 特异性压 grid）；比较页移动端单列；广场工具栏换行；`:focus-visible` 不再改 border-radius
- 图标纪律：🗑/✓/📝/≡ 全部收编 lucide（Trash2/Check/StickyNote/Rows3/Columns3 + aria-pressed）；发布粒子色改 token

### Jev 集成 Phase 1（AI 快排）
- TypeSafe Jev（System One 决策模型）接入：准备页第三种成榜方式——单次 systemone 调用（state=品味档案+清单全文，questions=每件作品一个 Noul）对 ≤255 件打 0-1 分直接成榜
- key 用户自配（浏览器 localStorage，服务端不落盘）；worker REST 客户端走 fetchBounded 精确白名单；错误映射复用 AiError 族
- 三端点：`/api/ai/jev/test`（探活）、`/api/ai/jev-rank`（快排）、`/api/ai/jev-pick`（代判）；限流桶 ai_jev_test 5 / ai_jev 10 / ai_jev_pick 60（次/10 分钟）

## 2026-09-25 · P0/P1 安全加固 + 插件系统（主题包 / 开场特效 / 清缓存）

### 安全与数据完整性（全量回归 376 tests）
- 出站请求统一策略 `worker/outbound.ts`：精确 host 白名单、manual redirect 逐跳复核、响应字节上限（SSRF 修复）
- 扫码登录事务所有权绑定（migration 0024 `qr_transactions`）——凭证只写入发起账户
- 邮件生产缺配置 fail-closed；开发兜底需显式 `ENVIRONMENT`，验证码不再写日志
- 验证码 / OAuth exchange 条件一次性消费；注册/改密先变更后消费 + 失败补偿；Google 强制 `email_verified`
- 排序 quick 估算取整（撤销/草稿不再崩）；画像 ID/重排/合并不变量
- 批注「未提供=保留 / 显式空=清空」语义；云同步水合门 + 会话代际（防旧响应覆盖）
- Plaza：请求形状校验、post_type 不可变、条件点赞计数、评论子树删除与计数重算
- migration 0024/0025（qr_transactions + 运行时索引），本地演练可重复应用，已部署

### 插件系统
- **插拔主题包**：`docs/THEME-PACKS.md` 规范 + 导入弹窗（重建式安全注入）；内置第 7 主题「纸上擂台」
- **开场光球特效**：`docs/ORB-EFFECTS.md` 接口 + 注册表——等离子球 / 极光环场 / 呼吸黑洞（±5% 呼吸、事件视界遮挡、吸积星尘内旋），特效配色随主题联动
- **分类清缓存**：海报/文字/歌曲/其他，用户端设置菜单与管理端「缓存」页签（D1 分代失效）

### 修复
- 后台看板内联脚本模板转义错误致登录失效（2992c8c3 起）；看板图表自托管摆脱 jsdelivr
- SW 导航缓存单键污染（v3 只缓存 SPA 壳）；音乐简介百度百科泛义词条防线（歌手名守卫）；Node 22 统一（CI/engines/.nvmrc）

## 2026-09-22 · UI 全站焕新（夜间档案馆 / Nocturne Archive）

设计与工程全量改造，**功能零变更**（唯一功能新增：可选布局模式，用户自由开关）。

### 视觉
- 北极星两屏（Home/Profile）三轮迭代定稿：叠印报名、竖排书脊、目录巨号行、出血海报、名次满版墨块、CJK 首字下沉
- 九视图 + 八界面 + 壳层全量收编档案语言（hairline 秩序 / mono 编号 / 双线分区 / 纸感噪点）
- **六主题人格化**（非色彩差异 ≥2/主题）：现代·夜间档案馆 / 复古·旧式印刷所 / 极简·瑞士网格 / 简约·亲和蓝 / 古典·文学博物馆 / 赛博·终端 HUD

### 工程
- Token 体系 L1/L2 落地；散落 hex 归零；`--text-3` 对比度定案 74%→78%（WCAG AA）
- 圆角 21 值→五档；间距 8px 阶梯；字阶 ±1px 归档；阴影 36→2 两级；玻璃两级制（17 类退哑光）
- hover 浮起分级治理；对战卡四态规格；误触防护（内滚区守卫）；help 入口迁顶栏
- **可选布局模式**（`data-layout`，与主题正交）：archive（默认零变化）/ journey 胶片盘 / bento 档案格
- **回归绊线 24 条**（`src/ui-fixes.test.ts`）：全部已修事实测试级锁定

### 工具链（不进产物）
`ui-audit` 基线盘点 / `ui-shot` 批量截图（确定性种子、自证标签）/ `ui-diff` 纯 Node 像素比对 / `ui-contrast` WCAG 扫描 / `ui-normalize`+`ui-shadows` 归一化 codemod；B0/B1/b1r 三级快照基线。
