# Changelog

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
