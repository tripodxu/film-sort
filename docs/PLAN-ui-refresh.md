# UI 视觉焕新计划：零功能变化 · 零行为风险 · 去 AI 感

> 前提三条红线（本计划所有内容受其约束）：
> 1. **不引入 bug** —— 只做视觉层改动，行为、数据、逻辑零变化；
> 2. **不改变现有功能** —— 不改任何 TS 逻辑、props 契约、路由、API、存储格式、DOM 语义结构（唯一例外：用户决策新增的**可选布局模式 §5** + journey 装饰包裹 div，纯增量呈现层；`archive` 布局行为不变，像素容差见 §2.1、基线三分 B0/B1/模式对比见 §5.4）；
> 3. **无"AI 设计感"** —— 不用 Inter/Roboto/Space Grotesk 独挑大梁、不用紫蓝渐变、不用模板化圆角卡片海、不用 emoji 当图标、不堆无意义玻璃拟态。
>
> 范围：全前端覆盖 —— 9 个视图（Home / Source / Setup / Sorting / Profile / Compare / Share / Plaza / PlazaPost）、App 壳层、11 个弹层、全部共享组件、6 套主题人格（§7，不止换色）、响应式与无障碍、导出 PNG（可选项）、3 种可选布局模式（archive / journey / bento，§5）。

---

## 0. 安全边界：允许改什么、禁止改什么

| 类别 | 允许 | 禁止 |
|---|---|---|
| CSS | `src/styles.css` 全部视觉规则、新增 token；**结构性规则（display/position/flex/overflow 等）仅限三类白名单**：(a) `[data-layout="journey|bento"]` 作用域内（§5）、(b) ≤600px 弹层抽屉化（§3.4）、(c) §4 逐条标注的视图级例外 | 白名单之外的结构性规则改动 |
| JSX | `className` 字符串、纯装饰性 `<div>/<span>`（aria-hidden）、文案措辞（t() 既有键值内）；**新增 t() 键仅限布局切换 UI 的三个标签**（archive/journey/bento 中英名，§5）；**列表容器内新增一层纯装饰包裹 div**（透明、aria-hidden、无语义类名；journey 轨道 mask/chevron 的唯一承载层，2026-09 审查 #二.3） | 组件签名、props、state、事件处理、hooks、条件渲染逻辑、表单 label/for/aria 关系 |
| 资源 | 自托管字体/噪点纹理（放 `public/`） | 任何第三方 CDN 资源（**CSP `font-src 'self' data:` 会直接拦截外链字体**，style-src 同理） |
| 依赖/新模块 | 仅 `src/lib/layout.ts`（≤30 行，复刻 theme.ts）+ 布局切换 UI（§5，用户决策的唯一新增） | 不新增**运行时**依赖（three/lucide/fflate 够用）；开发工具类 devDependency（如 Playwright 截图脚本）允许但不进产物；不新增其他运行时模块 |
| 测试 | 为纯视觉工具函数补单测 | 改现有测试语义 |

**风险控制手段**：
- 全部改动集中在 CSS + className → git revert 即回滚，单阶段可独立部署；
- 每阶段收尾跑四门禁（`tsc -b` / `vitest` 277 / `eslint` 0e / `format:check`）+ 视觉回归清单（§8）；
- JSX 改动逐文件 diff 评审：只允许出现 `className=`、`aria-hidden` 装饰节点、布局切换 UI 新增节点（含三个新 t() 键）、列表容器装饰包裹 div、**奖牌 emoji → mono 数字 01/02/03 等价文本替换** 五类变更，外加两类定点豁免（四轮 #六）：**第六类** P2 顶栏移动既有 help 节点（位置移动 + 44px 命中区补齐，不新增功能）；**第七类** P3a 对战卡误触防护（内滚区一处事件守卫 `stopPropagation` + `overscroll-behavior:contain`，点击面积收窄至海报区/标题区——防护性收窄，选择逻辑本身不变）。**奖牌替换两条硬规**：实测**四处**（CompareView:318,439 / PlazaView:306 / ProfileView:633-636 / **RankingDetail.tsx:129**，四轮复测补漏）；替换后**必须同步去掉 `aria-hidden`**——新文本（01/02/03）是名次信息而非装饰，保留 aria-hidden 会把"视觉有标识、读屏无标识"变成"两边都无标识"。

---

## 1. 设计方向：「夜间档案馆 / Nocturne Archive」

现有底子（近黑 `#080a0a` × 酸性柠檬绿 `#d8f86a` × 玻璃胶囊 × mono 小标签）本身有个性，问题不在方向而在**完成度**：目前是"能用的深色 dashboard"，要推到"独立电影资料馆 / 唱片店印刷品"的质感。

**四条材质语言（贯穿所有界面）**：

1. **印刷品排版**：编辑级字号阶梯（display 80/52/29、标题 20、正文 15-16、meta 11-12 mono）；**区块标题采用「档案标头语言」**（四轮 #P3 改写——原"mono 大写 eyebrow 推广到全部区块标题"以拉丁排印为主语是方向性错误）：**mono + 中性色 + 前置 16px hairline 短线 + 11px 字号**，对中英都生效；`.note-reader-eyebrow` 的大写 + 宽字距只作**叠加增强**，不作核心手法（`uppercase` 对 CJK 是死代码，`letter-spacing` 的观感是"散"不是"精致"）；
2. **纸感噪点 + 玻璃两级制**：全局极细噪点纹理（SVG feTurbulence data-URI，2-3% 不透明度，纯 CSS `background-image`，无请求）；**玻璃两级**（四轮 #二.2 采纳 (b)——21 处 blur 全撤会让界面从"深色玻璃 dashboard"变成"哑光黑"，减一层材质必须补一层，且首页仅存的两处个性资产（玻璃胶囊 + Orb）不得无替代削减）：**贵级** `blur(16px)+saturate(1.2)` 给 identity 胶囊 + 弹层面板，**普级** `blur(8px)` 无饱和给 topbar + medium-item（首页胶囊记忆点由此保住）；其余 17 类表面退哑光 surface + hairline。**打印材质候选**（P0.7 在两屏上实测取舍，四轮 (a) 项）：半调网点（`radial-gradient` 3-4px 周期，hero/section 头部极浅底纹）、压凹/压凸（inset 双 hairline，推广 `.poster` 雏形）、墨色叠印（`mix-blend-mode:multiply` 限 poster 与 badge）——比玻璃更贴"印刷品"定位；
3. **hairline 体系**：1px `color-mix` 边框 + 分隔线构成网格秩序（现有 `--line` 体系深化），阴影降权（只在浮层用两级 elevation）；
4. **海报优先**：`Poster` 组件是产品的情绪核心——加大展示尺寸、去圆角化（改 2-4px 微圆角）、胶片式编号/年份 mono 标注，让海报自己说话。

**反 AI 感清单（评审时逐条对照）**：
- ❌ 紫→蓝渐变、任意 `linear-gradient` 大面积铺底（渐变只允许出现在 Orb 光球与 progress 指示）；
- ❌ 同款圆角卡片网格墙。例外：用户主动开启的 bento 布局（§5.3）本质是卡片墙，但按「档案格」规格执行——非均匀跨度、hairline 无阴影、mono 编号 + eyebrow、海报格/数据格混排，靠差异去 AI 感；默认 archive 布局仍禁同质卡片海；
- ❌ emoji 图标（现有 lucide 体系保持，统一 1.5px stroke）；
- ❌ 无功能的悬浮动画/视差堆砌（动效预算见 §2.4）；
- ❌ "AI 起名式"文案腔（焕新不动文案，仅允许 t() 既有键值内的微调）；
- ❌ 全局大圆角 + 重度 blur（blur 按 §1 材质语言第 2 条的**两级制**管理）。**现状实测 blur 21 个 distinct selector、半径 13 种**（三轮 #一.2，四轮精化：segmented / medium-item / artwork-main / 几乎全部弹层 / toast / rank-pill / dim-chip / rank-menu / plaza-header / scroll-top / guide / note-reader / custom-suggestion…）——玻璃是"重要性材料"，到处都是等于哪里都不重要，且每层 blur 都是移动端合成层成本；**收敛为两级而非单纯删除（四轮 #二.2：减一层材质必须有另一层补上）**，仍是 P1b 工作量最大的单项之一。retro/minimal/simple/classic 的 `backdrop-filter:none` 覆写串（styles.css L530/547/557/572）本身就是滥用后的补丁证据，收缩完成后一并删除。

---

## 1.5 北极星屏（P0.7，四轮 #二.1：流程倒置的纠偏——规则先行 → 样板先行）

> 原流程把 token/圆角/间距放最前、主题推到 P5——执行者只能按约束反推，结果是"每个阶段都合规，合起来是控制得很好的旧界面"。**美术上的第一个问题是"新的样子长什么样"**，而这个仓库里已有答案：`.note-reader`（color-mix 半透明底 + hairline + 大字距 mono eyebrow）就是"夜间档案馆"**已经实现过一次的证据**，拿它当质感基准。

**P0.7 只做两屏的真实 CSS**（成本 1d）：
1. **Home**（hero + 四媒介入口 + collection 行）与 **Profile 榜单页**——在真实内容上把圆角/字阶/噪点/hairline/玻璃两级/打印材质**试出来**；
2. **用两屏反推 token 档位**——§2.1 的数值降级为候选初值，定案以此为准；
3. 两屏成为**全计划验收基准**：后续每阶段的"是否更好看了"都对着它比（它同时进入 B 序列快照）；
4. 含两个当场定夺项：medium-grid 胶囊 vs 索引条目对比稿（0.2d，§4.1）、玻璃/打印材质取舍（§1）。

---

## 2. Token 化改造（P1 阶段，风险最低、收益最大）

现状：`styles.css` 里颜色有 token（6 主题变量块），但**间距/圆角/字号/阴影全是裸数值**（`padding:18px 20px`、`border-radius:18px`、`font-size:13.5px` 到处散落）。这是"细节不精致"的根源。

### 2.1 新增设计 token（`:root` 声明，各主题覆写完整风格套件）

> 数值已由 P0.7 两屏**定案**（2026-09-22，§10.7 执行记录）：玻璃两级（贵级 `blur(16px)+saturate(1.2)` / 普级 `blur(8px)`）、噪点 4.5%、`--ls-wide:.22em`、半调网点 4px 周期、卡片 `--r-sm`、海报 `--r-xs`、`--ease-out:cubic-bezier(.22,.61,.36,1)`。

```css
/* 间距：4/8 节奏（4px 档仅限图标-文字微距，组件间 ≥8px） */
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px; --sp-7:48px; --sp-8:64px;
/* 圆角：5 档（2026-09 审查 #二.5：4 档与 --r-pill/现状 9 种值自相矛盾） */
--r-xs:3px; --r-sm:6px; --r-md:12px; --r-lg:18px; --r-pill:999px;
/* 字号阶梯（现有值归一） */
--t-display:80px; --t-h1:29px; --t-h2:20px; --t-h3:17px; --t-body:15px; --t-small:13px; --t-meta:11px;
/* elevation 只留两级 */
--ev-1:0 1px 0 color-mix(in srgb,var(--text) 6%,transparent);
--ev-2:0 16px 45px rgba(0,0,0,.28);
/* 动效统一 */
--ease-out:cubic-bezier(.22,.61,.36,1); --dur-1:150ms; --dur-2:220ms; --dur-3:320ms;
```

全部裸数值按最近档位归一替换（例：`13.5px`→`--t-small`(13px，-0.5px)、padding `18px`→`--sp-4`(16px，-2px)）；不在档位附近的值**不硬归一**——如 `border-radius:18px` 应新增 `--r-lg:18px` 档位，或经视觉确认后归 `--r-md`(12px) 并如实记录 6px 位移。**容差如实声明：间距/圆角归一允许最大 6px 几何位移，字号 ±1px**（2026-09 审查意见 #3：原「±2px」与示例自相矛盾，已更正）；P1 快照判据据此定：diff 仅出现在 padding/radius 边缘几何、文本不换行、元素不错位不溢出 → 可接受；出现文本折行变化、元素重叠、横向溢出 → 判失败必须修。

**结构性例外清单（禁止跨断点统一归一，2026-09 审查 #二.2）**：`medium-grid`（桌面 grid ↔ ≤540px flex 胶囊**双渲染**）、`.medium-item` 行高组（33/40/30/36px，仅桌面 grid 生效）、`profile-dimensions`（≤540px 已是 `overflow-x:auto` 横向滚动 flex）、`plaza-grid`（`--plaza-cols` 驱动 + 800px `!important` 单列）——四处只做内部排版归一，容器形态与断点行为原样保留。

**硬编码色值边界（2026-09 审查 #二.1）**：§5.1「不得出现硬编码色值」限定为**规则层**；token 定义层（`--bg:#hex` 等 L1 锚点）必须是字面值，是唯一合法硬编码位置。实测散落 hex（token 定义之外）**17 处**（全文件 140 = 定义层 123 + 散落 17）——**P1a 显式任务「散落 hex 归零」**：逐条改 `color-mix` 或补语义 token 并记 diff，列为 P1a 验收项。

**三轮美术审查落地（#一.1/3/5/6）**：
- **圆角收敛先于间距归一**（三轮 #一.1：圆角混乱是肉眼最先感知的不精致）：现状语法去重 **21 个值**（四轮复测；扣 50%/!important/复合值 ≈17 个纯档位，口径 P0 脚本钉死）且**同屏不一致**（hero 胶囊 999px vs 同页按钮 4px；弹层 4 种：6px×5、14px×8、16px×2、20px×1）——按五档映射收敛，**弹层统一单档 `--r-md`**；
- **阴影收敛两级**（三轮 #一.3）：现状 **36 个 distinct `box-shadow`**（四轮复测：rgba 黑 **14 种** + 彩色 accent glow 8 种 + inset hairline 若干）——元素级用 1px inset hairline（推广 `.poster` 现有 inset 处理）、浮层用 `--ev-2` 单档深阴影，所有"卡片浮起"共用；
- **字号两档制 + 白名单**（三轮 #一.5，四轮 #三.1 修正为可执行规则——原"10px 仅限拉丁 mono"会立刻卡住实测的 19 处）：现状 8px×2、9px×2、**10px×19**、11px×44、12px×44；`--t-meta:11px` 为中文 meta 下限，新增 `--t-micro:10px` **仅限 tabular-nums 数字/时间戳/计数/编号**（白名单 8-12 条，如 `.publish-desc-label span` 数字计数器），白名单外一律升 11px；8/9px 一律清零（中文笔画密度下 10px 不可读）；
- **色彩语义统一（三轮 #一.6，计划外新发现）**：`.kind-film/book/music/other` 媒介徽章现用 `--ok/--indigo/--pink/--warn`（styles.css L170-173），与全站媒介四色 `--film/--book/--music/--other` **同义不同色**（同一个"电影"广场是绿、首页是青柠）——改引媒介四色 token，小时级修复、直接提升系统感，落地点 §4.8。**媒介色职责表（四轮 #二.3：统一引用之后还要统一含义）**：媒介色**只出现在三种位置**——(1) 媒介图标/小色块（唯一强着色）、(2) poster 兜底底纹 ≤16%（**六主题恒定**，作为档案分类的恒定语言）、(3) 该媒介区块 3px 顶部短标；**其余一律中性色**。现存越界使用（dimension 网格下边框等着色）按表回收（P0.9/P1a）；kind 徽章改色以此为依据，不是"顺手统一"。

**Token 分层（换色 → 换风格的机制升级，2026-09 决策）**：L1 色彩 token（现状，各主题已覆写）+ **L2 风格 token**（新增：`--r-*` 圆角 / `--t-*` 字阶 / `--ls-*` 字距 / `--grain` 纹理浓度 / `--ev-*` 阴影 / `--dur-*` 动效）——**各主题两层都可覆写**（**档位数值也允许人格覆写**，如 simple 把 `--r-sm` 调到 8px——档位语义固定、数值随人格，2026-09 审查 #二.5），切主题 = 整套审美切换（各主题人格规格见 §7）。

**styles.css 段落排序约定（九阶段增量提交互不踩）**：`:root token → base/reset → 壳层 → 视图（Home→Source→Setup→Sorting→Profile→Compare→Share→Plaza→PlazaPost）→ 表单控件 → 布局模式块（[data-layout]）→ 主题人格块（[data-theme]）→ @media 收尾`；每阶段只在自己的段落内追加/修改，禁止跨段插入。

**主题块内部格式（2026-09 审查 #三.2）**：每条声明独立一行、按 `L1 色彩 → L2 风格 → 字体` 分组注释——现状紧凑单行 3-4 规则的写法禁止继续加长（人格块每主题约 20-30 条声明，不拆行则 diff 无法评审）；`@media` 新增一律无空格 `@media(...)`（现状 2 处带空格系存量，不强改）。

**reduced-motion 优先级（2026-09 审查 #三.3）**：现 L34 豁免块位置不动、既有规则不改，其 `*{transition:none!important}` 天然压过主题块 `--dur-*` 覆写；新增 reduced-motion 细则并入该块，禁止在主题块写对抗性 `!important`。与「@media 收尾」排序不冲突：收尾约束的是**新增**规则，L34 存量块是冻结例外。

### 2.2 字体栈精修（零加载风险）

现栈 `Bahnschrift/Segoe UI`（Windows 独占气质，其他平台回落系统体）。**默认方案不加字体文件**：
- display：`Bahnschrift,"Avenir Next Condensed","Helvetica Neue Condensed",-apple-system,sans-serif`（窄体大写 + `letter-spacing:.02em`，标题更有"节目单"味）；
- 正文保持 `-apple-system, "Segoe UI", "Microsoft YaHei"` 兜底（中英混排最稳）；
- mono（元数据/编号）保持 `Consolas,"Cascadia Mono"` 栈，可加 `ui-monospace` 前置；
- 所有栈只动 `--font-*` 四个变量，一处生效。

**改栈影响面（2026-09 审查 #三.4）**：`var(--font-serif)` 现有 **2 处**使用点——`.cover-fallback span`（无海报兜底大字）、`.note-reader-body`（批注阅读器）；retro/classic 换 CJK 衬线栈会同时改变这两处观感，列入对应阶段验收截图。注意现状 `Georgia,"Microsoft YaHei",serif` 的中文兜底是**无衬线**雅黑——「serif 主导」在中文下目前并不成立，改栈才成立。

**移出本计划（独立立项，2026-09 审查 #五）**：自托管一款可变窄体（woff2 子集化 ≤40KB，`font-display:swap`，放 `public/fonts/`）。注意 CSP `font-src 'self' data:` 已允许自托管，**绝不可用 Google Fonts 外链**。**收益范围如实声明：仅拉丁标题（ART/RANK、eyebrow、英文名）受益，中文标题不受益**——不引入 CJK 字体文件（子集化也上百 KB），中文标题质感只靠字重/字距/衬线栈调整。

### 2.3 噪点纹理（纯 CSS，零请求）

```css
body{background-color:var(--bg);
  background-image:url("data:image/svg+xml,...feTurbulence baseFrequency=.9...");
  /* 融合进现有背景层，无需独立合成层 */}
```
实施修正（2026-09 审查 #三.8）：**不加 `position:fixed` 伪元素层**——全屏 fixed 合成层会与 topbar（z-index:5）、orb-hero（isolation:isolate）、三处 `backdrop-filter` 叠加成本；噪点作为 `background-image` 融进 body/.app-shell 自身。六主题共用（cyber 主题关闭），`prefers-reduced-motion` 无关（静态纹理）。P1b 验收含**移动端滚动帧率不下降**手测项。

### 2.4 动效预算（克制 = 高级）

| 场景 | 允许 | 参数 |
|---|---|---|
| 首页 hero 文案 | 一次性 staggered fade-up | 3 个元素，`--dur-3`，delay 60ms 递进 |
| 按压反馈 | 保留现有 `scale(.95)` | `@media(hover:none)` 已有，归一到 `--dur-1` |
| 弹层开合 | backdrop fade + 面板 `scale(.98)→1` | `--dur-2`，exit 用 `--dur-1`（出比进快） |
| 列表项进场 | 仅首页 medium-grid 首屏 6 项 stagger | 30ms 递进，禁用列表滚动加载动画 |
| 其余 | 全部 `transition: color/border/background --dur-1` | 禁止新动画 |

既有动画时长（`.4s`/`.3s`/`.18s`，含 spring 曲线 `cubic-bezier(.34,1.56,.64,1)`）归一到 `--dur-*` 属**可见节奏变更**（2026-09 审查 #三.6）：单独截图/录屏验收，不得混在 P1b 静默通过；§8.2 已列对应验收项。

统一包裹 `@media(prefers-reduced-motion:reduce)` 全局豁免（现有规则保留，优先级约定见 §2.1）。

**动效语言收敛（三轮 #一.4）**：
- **删全局 jellyBounce + poster hover 三重收敛一重**（四轮 #P2）：L50 定义、**L66 `.poster:hover` 挂载（杀伤点）**——50 张海报的网格页上移动鼠标会连续触发果冻弹跳，是"玩具感"最大来源；现状 poster hover 实为**三重反馈**（L65 `.4s cubic-bezier(.34,1.56,.64,1)` 弹簧过渡 + L66 jelly 动画 + L68 `img scale(1.03)`），三删二，只留**单一反馈**：`img scale(1.03)` + hairline 变 accent，`--dur-2` 普通 ease；如要保留俏皮气质，只留 Plaza 贴纸区（本就是俏皮人格保留区）；
- **浮起分级规则**：`translateY(-2/-3px)+阴影` 现用于 6+ 种组件（medium-item / collection-row / dim-chip / plaza-sticker / profile-dimension / custom-suggestion）——一切以同一方式浮起即无主次。定规矩：**卡片级元素才许浮起，行级条目只用背景色 + hairline 变化**；
- **曲线统一**：弹性 `cubic-bezier(.34,1.56,.64,1)` 与普通 ease 混用现状收敛到两档——`--ease-out` 通用、`--ease-spring` 仅限 Plaza 贴纸与按压反馈（新增该 token 记录之）。

### 2.5 CSS 去重（P0.9 前置项，三轮 #一.9：append-only 打补丁痕迹——不先去重，token 归一命中哪条全看运气）

实测重复定义 5 组：toast 动画两遍（L132 `.25s` vs L300 `.3s` 弹簧）、guide-modal 两遍（L36/237）、rank-detail-dialog 三遍（L117/221）、plaza-grid 的 media 两遍（L135/136）、ranking-card-top3 两遍（L81/264）；另有空注释块（"Improved Contrast" 下空无一物、Note Modal 空 8 行）。

**去重纪律（守零 diff）**：只删除**被同选择器后规则完全覆盖的死规则**（删除本就不生效的规则 = 像素级零 diff，可证）；选择器/媒体条件不同的"重复"是活规则——归档标注、**不动**，其统一归 P1b 可见变更结算。空注释块直接删。此步完成是 P1a 的前置校验项。

---

## 3. 全局壳层（App.tsx 对应的视觉部分）

### 3.1 topbar
- 玻璃保留（`backdrop-filter` 两处场景之一），但边界改 hairline + 滚动时加底色渐显（纯 CSS `:has()` 或保持现状背景）；
- 导航按钮：active 态除下划线外加"档案标签"感——mono 小字号 + accent 色，下划线改 2px 短线（宽度 60%，居中），更像印刷页码线；
- wordmark `ART/RANK` 保留，`/` 改 accent 色（现已是 span，只调样式）；
- help 入口并进 topbar icon-button 组——**提前至 P2**（四轮 #三.5：20px 且游离于角落 = 发现性问题而非尺寸问题，用户找不到；一次解决触控欠账 / toast 遮挡 / 新用户引导发现性三件事）；节点移动列 §0 **第六类 JSX 豁免**（移动既有节点，不新增功能）。§3.3 的 toast 避让保留为 P0.9→P2 期间的过渡措施，help 迁走后 toast 位置由 P0.7 北极星屏定夺。

### 3.2 footer
- hairline 上边距加大，mono 小字（现 slogan 混排），信息降噪。

### 3.3 toast（刚重构的队列，行为不动）
- 视觉对齐"档案条"：左侧 accent 竖线 + 纸感底色，去现有亮黄底（`--toast-*` 六主题各调）；
- 宽度 `min(420px, …)`，圆角 `--r-sm`，与 §2.4 弹层动效一致的进场；
- **位置避让（三轮 #二.1，真实碰撞）**：toast 现 `right:20 bottom:20` z-60 直接压住 `bottom:28 right:28` z-50 的 help 按钮——用户正要点帮助时弹通知就挡住了；改 `bottom:88px` 起（或等效上移），纯 CSS；
- **队列逻辑、≤5 上限、aria-live、4s 时长一个字不动**。

### 3.4 弹层体系（11 个弹层统一）
现存 modal-backdrop + section 模式统一为一套视觉规格（**只动 className/CSS，不动 FocusTrap 接线**）：
- scrim：`--scrim` 各主题校准到 55-65%（现在 45-78% 不齐）；
- 面板：纸感底 + hairline + `--r-md` + `--ev-2`，内边距 `--sp-5/6` 统一；
- 标题区：mono 大写 eyebrow（推广 note-reader 风格）+ 标题 + hairline 分隔；
- 移动端 ≤600px：底部抽屉化（`border-radius: --r-md --r-md 0 0`，贴底），保留现有"点击遮罩关闭"行为；（弹层 600px 与列表 540px 双轨是有意为之——弹层需更宽窗口保可读性；两档并存记入 P0 断点盘点，2026-09 审查 #三.7）；
- 各弹层清单：guide（引导）、tech（技术说明）、account（账号）、share（分享）、note reader/view（批注读写）、peer rank pick、compare rank detail、cloud conflict、AiConfigDialog、ArtworkDetail。

---

## 4. 逐视图方案（9 视图全覆盖）

### 4.1 HomeView —— 门面（最大视觉收益）
- **Orb hero**：保留 three.js 光球与 DeferredOrb 懒加载（逻辑不动）；文案区排版强化——`h1` 80px 窄体大写风格维持，`<small>`副标与 `p` 段落对齐字阶；hero 底部加 hairline 过渡到内容区；
- **identity 胶囊**：玻璃第二场景，保留位置与交互，圆角统一 `--r-pill`；
- **首页胶囊主权（三轮 #二.4）**：hero 的 `home-actions` 是首页**唯一**胶囊组——medium-grid 四个玻璃胶囊与其同材质同浮起、在门面页争夺注意力；改档案索引条目（上条）正是让位解法，美术依据记此；
- **medium-grid（四媒介入口）**【结构性例外，禁止跨断点统一归一】：实测是**两套渲染**——桌面 `display:grid` 4 列（专属行高 33/40/30/36px）、≤800px 2 列、**≤540px 整体切 `display:flex;flex-wrap:wrap` 胶囊**（`.medium-item` 变 pill、行高失效）——不是"两列/单列断点行为不变"。本计划只做条目内容排版：mono 编号（01-04）+ 媒介色小色块（`--film/--book/--music/--other` 已有）+ hover accent hairline；**grid/flex 切换、行高组、pill 形态全部原样保留**（2026-09 审查 #二.2）；
- ⚠️ **去胶囊方案重估（四轮 #二.2）**：门面页仅存两处个性资产——玻璃胶囊与 Orb 光球；改"档案索引条目"后与通用 collection-row 无异 = 记忆点被统一成通用列表项。**P0.7 出对比稿（胶囊保留 vs 索引条目，0.2d）后定夺**；默认倾向**保留胶囊**（玻璃普级 `blur(8px)`，§1 两级制），编号/色块/标头语言叠加其上；
- **profile-overview / collection 区**：列表行 hairline 化，poster 缩略图微圆角，rank 数字用 mono tabular-nums（防跳动）。

### 4.2 SourceView（73KB，最复杂的视图——分区分批改）
- 顶部分段器 `segmented`：去胶囊按钮感，改 tab 式（hairline 下划线 + mono 标签），**分段逻辑不动**；
- 内置榜单/自定义/豆瓣/网易云四个面板各自的列表、卡片、QR 倒计时（`.qr-timer`）、导入进度（`.import-progress-text`）保持布局结构，只做字号/间距/hairline 归一；
- 候选区 `candidate-scroll/grid`：海报网格微圆角 + hover hairline；
- **此视图动 DOM 风险最高，允许的 JSX 改动从严：仅 className**。

### 4.3 SetupView（小视图，快速过）
- 表单排版对齐 §6 表单规格；`setup-layout` 两栏间距归一。

### 4.4 SortingView —— 核心体验（对战屏）
- `duel-grid` 双卡：卡片改"双联画"感——poster 占主导、信息区 hairline 分隔、`choose-arrow` 改为 hover/focus 时的 accent 描边箭头（现图标换样式不换组件）；
- `kbd` 提示保留（已有 kbd 样式，很对味，推广 mono 风格）；
- 对战计数 `.comparison-count` mono tabular-nums；
- **对战卡内部滚动暗示（三轮 #二.3）**：`artwork-info` 是 98px 的 `overflow-y:auto`——卡片可点、内部又可滚但无任何暗示，滚动时还易误触"选择"；底部加 fade mask 渐隐（纯 CSS `mask-image`）提示可滚（fade mask 仅作辅助暗示——治本见下条）；
- **对战卡内滚区治本（三轮 #二.3 + 四轮 #三.3：病灶是手势冲突——滚读简介触发的是卡片选择，不是缺提示）**：① 内滚区 `pointerdown`/`click` **不冒泡**触发选择（一处事件守卫，§0 第七类）；② `overscroll-behavior:contain` 防滚底带动整页；③ 点击面积明确定义：**海报区/标题区可点，简介区只滚不选**；
- **对战卡三态/四态规格（四轮 #三.4，本计划对核心流程影响最大的一项）**：默认 / hover / focus-visible / 已选待确认——要求 **0.2s 内肉眼可辨、不依赖颜色单一维度**（WCAG `color-not-only`，此前只在 §5.3 引用而没用在对战屏）、触屏不依赖 hover（`hover:none` 按压态承载）；用户在排序屏要做几百次二元决策，每一次都要瞬间判断"指/聚焦在哪张、点了会发生什么"——列为 **P3a 必交付规格，先于 token 细节验收**；
- **键盘交互、撤销、草稿逻辑零接触**。

### 4.5 ProfileView（46KB）
- `page-heading` + `rank-pill/dim-chip` 徽章体系：胶囊改"档案标签"（`--r-xs`、hairline、mono 编号）；
- **奖牌 emoji 退场（三轮 #二.5 + 四轮复测：实为四处）**：CompareView:318,439 / PlazaView:306 / ProfileView:633-636 / **RankingDetail.tsx:129**（此前三处口径漏了 RankingDetail）→ mono 数字 **01/02/03**（比 lucide Medal/Award 更贴档案气质，且不引入新 import）——彩色 emoji 打断 lucide 单色线条体系、跨平台渲染不一致（§0 第五类 JSX 白名单）；⚠️ **RankingDetail:129 现状是 `<span aria-hidden="true">🥇</span>`**——emoji 是视觉唯一名次标识却被读屏忽略，**替换后必须同步去掉 `aria-hidden`**（新文本是信息非装饰），否则从"视觉有、读屏无"变成"两边都无"；01/02/03 在 bento 中兼任 top2/top3 的名次强调（§5.3）；
- `profile-dimensions`【结构性例外，禁止跨断点统一归一】：桌面是 `grid auto-fit`，**≤540px 实测已是 `display:flex;overflow-x:auto;scrollbar-width:thin` 横向滚动容器**（非"维度网格"）——只做格内排版（数字大号 mono tabular-nums、标签 meta），容器形态/滚动行为不动（2026-09 审查 #二.2）；
- 榜单列表 `ranking-list/collection-row`：hairline 分隔行 + 海报缩略图 + 年份 mono（`.rank-date` 保留）；
- 导出工具 `export-tools`：按钮分级（主按钮实心 accent、次级 hairline）；
- 批注入口按钮保持（ExpandableNote 展开行为不动）。

### 4.6 CompareView（46KB，信息密度最高）
- `comparison-summary/signal` 数据带：数字 mono tabular-nums、hairline 上下分隔（已是这个思路，归一 token）；
- `metrics/metrics-wide/metrics-more-grid` 指标墙：数字统一 mono、说明小字，tooltip（`.metric-help`）保留逻辑只调浮层视觉；
- `consensus-dial` 共识表盘：保留 SVG，描边与配色接主题 token；
- `comparison-row` 列表行：hairline、hover accent；
- 音乐面板（`music-preview/lyric/ai-insight`）：歌词区纸感面板，试听条保留原生 audio 样式微调；
- **AI 点评卡（AiInsightCard）**：等宽边框 + music 色点缀已有雏形，强化 eyebrow 标题，去多余底色渐变。

### 4.7 ShareView（分享落地页）
- 他人画像的只读展示：与 ProfileView 共用同一套视觉规格（组件本就复用），peer 青色标识保留；
- 批注只读展示（ExpandableNote）视觉与 4.6 一致。

### 4.8 PlazaView —— 广场
- `plaza-header`：编辑式大标题 + `plaza-abilities` 标签行（mono 小标签）；**压平现有三段 `linear-gradient` + `blur(20px)` + 20px 大圆角**（styles.css L139——全站唯一大面积渐变，与"夜间档案馆"相悖、踩 §1 渐变禁令）→ surface 底 + hairline + eyebrow；
- **kind 徽章改引媒介四色**（三轮 #一.6）：`.kind-film/book/music/other` 现用 `--ok/--indigo/--pink/--warn` → `--film/--book/--music/--other`（语义冲突见 §2.1，此处为落地点）；
- `plaza-grid` 信息流：现 `plaza-sticker` 贴纸风很有趣味——**保留贴纸个性**，仅归一圆角/边框/投影到 token；列数变量 `--plaza-cols` 不动；
- 空态/加载态补视觉规格（若现无 skeleton，加**纯 CSS shimmer 占位**，不动数据逻辑）。

### 4.9 PlazaPostView（40KB）
- 帖子详情：标题区同 4.6 数据带；`items` 榜单列表同 4.5 行规格；
- 评论区：hairline 分隔 + mono 时间戳；编辑历史、点赞按钮保持交互，只调按钮分级；
- 发布弹窗 `publish-modal` 并入 §3.4 弹层规格（含 `publish-desc-label` 的 mono 计数字样，已有好底子）。

---

## 5. 可选布局模式（用户自由选择，2026-09 决策新增）

数据库推荐的 Horizontal Scroll Journey 与 Bento Grid 不再一刀切拒绝，改为**用户可自由开关的布局模式**。默认 `archive` = 现状逐像素不变；journey / bento 是纯增量呈现层——这是"不改功能"红线下的唯一功能新增（§0 已列例外）。

### 5.1 机制（与主题系统同构，最小 JS 面）
- `data-layout="archive|journey|bento"` 挂 `<html>`，与 `data-theme` **正交**：主题管视觉风格（色彩/字体/质感/圆角/动效，§7），布局管结构版式（滚动方向/网格跨度），18 种组合（6 主题 × 3 布局）在**规则层**均不得出现硬编码色值（token 定义层字面锚点除外，见 §2.1 硬编码边界）；
- 新增 `src/lib/layout.ts`（≤30 行，1:1 复刻 `theme.ts` 的 readLayout/applyLayout + localStorage `art-rank:layout` 持久化）；切换 UI 并入 ThemeSwitcher / SettingsMenu（同款 menu-item 样式，mono 方格缩略图标）；
- 布局差异全部由 `[data-layout="…"] .container-class` CSS 选择器承载；`data-layout` 挂载**照抄 theme 的双点位模式**（实测 `main.tsx:7-13`：React mount 前挂 `data-theme` 防首帧闪烁）——`main.tsx` mount 前读 layout 挂属性 + App 内 effect 兜底/响应切换；`applyLayout("archive")` **移除属性**（同 `applyTheme("modern")` 的处理），「缺省即 archive、archive 零 diff」由机制保证而非口头承诺（2026-09 审查意见 #8）。
- JSX 面澄清：**data-layout 机制本身零改动既有 JSX**；新增 JSX **三类**（2026-09 审查 #二.3 更正"仅两类"）——ThemeSwitcher/SettingsMenu 布局菜单组、`main.tsx` 挂属性 3-5 行、**列表容器内纯装饰包裹 div**（journey 轨道 mask/chevron 的承载层；直接挂既有容器会与 `profile-dimensions` 的 `overflow-x:auto`、`plaza-grid` 的 `!important` 单列规则互踩，故必须有独立一层）。

### 5.2 journey（横向卷轴）——「胶片盘」规格
- 适用容器：列表/网格类（medium-grid、collection / ranking / candidate 列表、plaza-grid）；**不进入** Sorting 对战屏、表单、弹层（§5.4）；
- 外观：`scroll-snap-type: x mandatory` 横向轨道，卡片如胶片帧——mono 帧编号（01/02…）、帧间 hairline、轨道两端 `mask-image` 渐隐（纯 CSS）；对齐数据库骨架 Intro→Journey→Detail→Footer（Home 映射：hero 不变 → 四媒介卷盘 → profile-overview → footer 不变）；
- 交互安全（对冲 ui-ux-pro-max `horizontal-scroll` / `gesture-conflicts` 风险）：
  - 可见 affordance：轨道两端 44px chevron 按钮（`gesture-alternative`），首屏露出第二帧约 15% 提示可滑（`swipe-clarity`）；
  - 键盘：原生 overflow 滚动天然支持 Tab/方向键，焦点环不得移除（`keyboard-nav` / `focus-states`）；
  - `scroll-behavior: smooth` 仅按钮触发，`prefers-reduced-motion` 下回 `auto`（`reduced-motion`）；
  - 嵌套横向滚动仅此一层，页面主滚动保持纵向（`scroll-behavior` 规则）；
  - 触屏手势降级：≤540px `scroll-snap-type` 从 `x mandatory` 降为 `x proximity`（mandatory 会抢占嵌套纵向滑动手势，触屏经典坑——审查意见 #5）；**真机触控**（iOS Safari + Android Chrome 实机）列发布前人工验收（§8.1），阶段门禁只跑可脚本化项；
  - 承载结构：mask 渐隐与 chevron 叠层挂在**新增装饰包裹 div**（§0/§5.1 第三类 JSX）上，既有容器保持原滚动语义不被复用。

### 5.3 bento（卡片墙）——「档案格」规格（去 AI 感的关键）
同质圆角卡片墙是 AI 感重灾区，bento 模式用三板斧规避（frontend-design：差异即个性）：
1. **非均匀跨度**：主格海报格 + 1×1 mono 数据格 + 文字格混排——**逐容器 span 映射表（四轮 #三.2 重写：弃用 mod-3 条件扩格）**：

   | 宿主容器 | 子项数 | span 排布 | 差异手段 |
   |---|---|---|---|
   | `medium-grid` | 恒 4 | **仅首项（主推）2c×1r** + 3×1×1 | 竖幅/色块/编号密度 |
   | `collection-list`/`ranking-list`（`display:grid!important` 存量） | 动态 n | **仅首项（榜单 top1）2c×1r**，其余 1×1 | top2/top3 靠 **01/02/03 数字 + 边框强调**（不扩格——名次语义，非装饰） |
   | `plaza-grid`（`--plaza-cols` 驱动 + 800px `!important` 单列存量） | 动态 n | 仅首项 2c×1r；`[data-layout="bento"] .plaza-grid{--plaza-cols:3}` **覆写列数变量**（archive/journey 不受影响；800px `!important` 单列在 bento 作用域内沿用不破） | 海报格/数据格/文字格高度密度 |
   | `profile-dimensions` | 恒 4-6 | 不扩格（已是横滚 flex），只加边框/编号 | — |

   **零空洞的构造性保证**：全表只有**首项一处扩格** + 顺序流式填充 → 中空永不可能（末行残缺属正常网格收尾）；差异靠**高度/内容密度**（海报格 vs 数据格 vs 文字格）而非跨度数量。
   **弃用方案留档（四轮 #三.2 反例）**：mod-3 条件扩格在 n=8 时——第 8 项同时匹配 `:last-child` 与 `:nth-child(8)`（=3k+2, k=2），继承首项 2 列跨度 → 总格 10 → 末行 2 空洞；n=14、20 同理。**根因：CSS 选择器只知道"第几个"、无法知道"总几个"**，`:last-child:nth-child(B)` 只等价"总数恰好 = B"，表达不了"总数 ≡ 2 (mod 3)"。`grid-auto-flow:dense` 同样弃用——回填改变视觉顺序，对榜单是错的（第 8 名可能排到第 9 名前面）；
2. **hairline 无阴影**：`--r-sm` 小圆角、无渐变、无玻璃拟态；
3. **编号 + eyebrow**：每格左上 mono 索引号 + 大写 eyebrow，海报格/数据格节奏交替，拒绝同质卡片海。

- hover 仅 hairline 变 accent + 200ms（`state-clarity`），禁 tilt/3D（反清单既有禁令不变）；
- 适用：Home、ProfileView 维度/指标区、Plaza posts、SourceView 面板内网格；≤540px 回落单列（既有断点行为不变）；
- 无障碍：格内交互全是既有 button/a，hover 才显示的信息在 DOM 文本中已存在（`hover-vs-tap` / `color-not-only`），触控目标 ≥44px（`touch-target-size`）。

### 5.4 模式边界（不越界）
- 不进入 Sorting 对战屏、Setup 表单、任何弹层、批注阅读器——收益/风险比不匹配；
- 不改信息架构：导航项、路径、按钮文案、数据流一律不变；
- **三条基线显式区分（2026-09 审查 #二.6，「逐像素」承诺的准确边界）**：
  - **B0** = P0.9 速赢批**完成后**的快照（三轮时序微调：速赢批自身的可见变化由其局部矩阵自证，不混入 B0→B1 容差账）；
  - **B1** = P1b 归一后的 archive 新基准——P1b 的 diff 判据是「B0→B1 仅允许 §2.1 容差内的位移」；
  - **模式对比基线** = 同阶段 archive 截图——P5c 只验 archive↔journey↔bento 的**预期差异**，与 B0/B1 不共用一把尺。
  「`archive` 逐像素保持」指 archive 相对 **B1** 稳定；相对 B0 的容差位移已在 P1b 公开结算，两把尺不得混用。

---

## 6. 表单与控件规格（横切所有界面）

- **输入框**：现 44px 触控高度保留；hairline 边框 + focus accent 描边（`outline-offset` 已有）；placeholder 用 `--t-small`；label 永远可见（现有结构已满足，不改 DOM）；
- **按钮三级**：primary（accent 实心，`--accent-ink` 文字）/ secondary（hairline 描边）/ quiet（文字按钮）——对应现有 `.button/.button.quiet/.text-button/.file-button`，统一样式收敛；
- **分段器 `segmented`**：tab 式 hairline，active 加 accent 短线；
- **禁用态**：`opacity:.4` 统一（已有）+ `cursor:not-allowed`（已有）；
- **校验错误**：文案就近显示（现结构如是则只调色 `--danger` + 小图标，**不改错误逻辑**）；
- **触控目标**：全部 ≥44px（现有 input/icon-button 已满足，逐个核对小尺寸按钮如 `plaza-sticker-btn` 28px→保留视觉尺寸但加 `hitSlop` 式 padding 扩大命中区，仅 CSS）；**补漏（三轮 #二.6）**：`scroll-top`（40px）补 44px 命中区；`help-dot`（20px）随 help 迁 topbar 一并解决（P2，四轮 #三.5——它是**发现性问题**不是尺寸问题，游离 20px 的角落按钮说明用户根本找不到）。

---

## 7. 六主题人格专项（主题 ≠ 换色，2026-09 决策升级）

布局模式与主题正交（§5.1）：**布局管结构版式（滚动方向/网格跨度），主题管视觉风格（色彩/字体/质感/圆角/边框/动效）**，18 种组合在规则层均不得出现硬编码色值（token 定义层除外，§2.1）。

> **现状问题**：当前 6 主题只是 `:root` 色彩变量覆写 + 少量字体覆写，切主题"只是换了颜色"，辨识度不足。升级目标：**每个主题是一套完整审美人格（persona）**——字体、排印、质感、圆角、边框风格、动效气质连同色彩一起换，切主题 = 换一种审美世界（frontend-design：different fonts, different aesthetics）。

**实现约束（守三条红线）**：人格差异全部用 `html[data-theme="…"]` CSS 选择器 + L2 风格 token 覆写（§2.1）承载，**纯 CSS**；`theme.ts` 逻辑零改动（仅顶部注释更新，注释级）；纹理/装饰一律 CSS 生成（data-URI SVG / repeating-gradient / 伪元素角标），零新文件零请求；装饰符号禁用字符型（✦ 等），用 inline SVG。

**六主题人格规格**：

| 主题 | 人格定位 | 字体与排印 | 质感/边框/圆角 | 动效气质 | 独有辨识特征 |
|---|---|---|---|---|---|
| modern（默认） | 夜间档案馆（基准） | Bahnschrift 窄体大写 display + mono eyebrow | 噪点 .03 + 玻璃仅 topbar/identity；hairline 实线；`--r-sm` 6px | 基准预算（§2.4） | 霓虹绿短线 active 指示、mono 大写 eyebrow |
| retro | 旧式印刷所 | **serif 全面主导**（CJK 栈见硬标准，正文 ≥15px），small-caps 标题（**仅拉丁**；中文标题用衬线加粗 + .06em 字距替代）、.04em 字距；eyebrow 改衬线斜体（仅拉丁）；**正文栏宽收窄 62ch + 首行缩进 2em**（印刷所核心结构特征——真正可见的结构差异，与文字系统无关，四轮 #二.4） | 纸纹噪点 .05-.06 + 极淡信纸横线纹；**0px 直角**（原 `--r-xs` 3px 在 2× DPR = 1.5 物理像素，与 minimal 几乎不可辨——四轮 #二.4，旧式印刷所本来就是直角）；区块分隔用 **3px double 双线**；油墨压痕 inset 浅阴影；玻璃全关 | 翻纸感（--dur-2 为主，慢半拍） | 双线书眉、纸纹、**正文栏宽 62ch + 首行缩进**（均与文字系统无关 ✓） |
| minimal | 瑞士网格 | 窄体 + **超大字阶反差**（display/meta 拉满）；标签 .08em 字距（全大写仅拉丁） | **零噪点、零阴影、零模糊**；**0px 全直角**；1px 纯 hairline 线框围合一切区块 | 最快最短（--dur-1 封顶） | 直角线框网格、纯黑白 |
| simple | 亲和蓝 | 系统圆润无衬线（PingFang/-apple-system），字重 400/500 轻量 | 无噪点；**柔和投影两级用足**（卡片浮起感）；**`--r-md` 12px 大圆角**、按钮全 pill；分隔靠阴影不靠线 | 柔和弹入（scale .98→1） | 大圆角 + 柔和投影 + pill 按钮 |
| classic | 文学博物馆 | serif 主导（CJK 栈见硬标准，正文 ≥15px）、标题居中倾向 + 小型大写（仅拉丁）；批注阅读器标题加衬线装饰线 | 纸纹 .04 + **画框式双框**（弹层/海报卡：外 border + 内 outline offset 4px）；2px 微圆；1.5px 实线 | 稳重淡入（--dur-3，无弹跳） | 画框双框、酒红花饰分隔（inline SVG）、居中衬线标题 |
| cyber | 终端 HUD | **mono 全面主导（含正文标题）**；全大写 .12em 宽字距 | **扫描线**（3px 周期 repeating-gradient，≤4%）替代噪点；0px 直角 + **卡片四角 L 形角标括号**（伪元素）；1px 霓虹 hairline | glow 脉冲仅 active 一处（--dur-3），其余同预算 | 角标括号、扫描线、描边 glow |

**装饰特征 × 布局模式组合表（P5b 专项核对，2026-09 审查意见 #6）**：装饰与布局相遇时**不叠加**——一个元素最多一种主题装饰，跨格/跨帧的装饰一律上移到容器级。

| 主题装饰 | archive | journey 帧 | bento 格 |
|---|---|---|---|
| modern 霓虹绿短线 | active 指示 | 当前帧标记沿用 | 主格标记沿用 |
| retro 双线书眉 | 分区标题下 | 同左（分区级） | 同左（**分区级**，格内不叠双线） |
| minimal 直角线框 | 全组件 | 帧间 hairline | 格间 hairline |
| simple 大圆角/pill | 全组件 | 帧卡 `--r-md` | 格 `--r-md`，gap 不变 |
| classic 画框双框 | 弹层/海报卡 | 画框套**整条轨道容器**，不套单帧 | 画框只套 2×2 主格，辅格单线 |
| cyber 四角括号 | 卡片/弹层四角 | 只标**当前可视帧**四角 | 只标主格四角，辅格省略 |

**每主题验收（非色彩差异点，逐条截图证明「不只是换色」）**：
- modern：玻璃两处 + 霓虹绿短线指示 ✓
- retro：small-caps 标题、双线分隔、纸纹肉眼可见 ✓
- minimal：全直角线框、无阴影无噪点 ✓
- simple：大圆角 + 投影层次、pill 按钮 ✓
- classic：画框双框、居中衬线标题、花饰分隔 ✓
- cyber：角标括号、扫描线、描边 glow ✓

**CJK 硬标准（主界面是中文，2026-09 审查意见 #4）**：
- 每主题辨识特征**必须在中文界面截图上肉眼可辨**，英文截图不得作为验收依据；small-caps / 全大写 / 宽字距只对拉丁文字生效——只能作补充特征，**每个主题必须另有 ≥2 个与文字系统无关的辨识特征**（双线/纸纹/直角线框/画框/角括号/扫描线/投影等，上表粗体项即此类）；
- retro/classic 的 CJK 衬线栈显式声明：`"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,serif`，且 **CJK 衬线正文最小 15px**（Windows SimSun 小字号渲染崩坏；主力开发机就是 Windows，P5a 当场验证）；
- 拉丁排印特征（small-caps 等）在人格表中已标注「仅拉丁」。

共通验收：对比度（正文 ≥4.5:1、大字 ≥3:1）、hairline 可见性、toast/弹层 scrim 前后景分离度、focus-visible 可辨识、**上述 CJK 硬标准**；**存量浅色四主题（retro/minimal/simple/classic）一并审计**（三轮 #二.7：其 surface 全靠 `color-mix(text,bg)` 推导、`--text-3`（74% 混合）承担大量 11-13px meta 文字，从未做过 4.5:1 验证）→ 纳入 P5b。改前在六主题下截图存档（§8.2）。

---

## 8. 可靠性工程

### 8.0 验证手段的诚实声明（2026-09 审查 #四）
- **vitest 对本计划零 UI 信号**：19 个测试文件全是 node 纯函数测试（无 jsdom、无 `render()`）——DOM 结构、className 误伤、弹层行为、键盘可达等本计划最大风险面的自动化覆盖率是 **0**。vitest 跑通（本会话实测 277/9）只证明纯函数层无回归；部分沙箱环境报 `spawn EPERM` 跑不起来，也**不得**当作 UI 门禁信号。四门禁中真正有效的是 tsc/eslint/format 三件 + 下方截图/人工矩阵。
- **截图工具链（不用 Playwright）**：Playwright 未安装且装浏览器需联网；改用**本机 headless Chrome** 直接出图（`chrome --headless=new --screenshot --window-size=W,H --force-device-scale-factor=2`），已于 2026-09-22 实测跑通。驱动脚本用纯 Node `child_process`（stdio 取 `ignore`/`inherit`，规避沙箱管道限制）+ 文件命名约定，不引入任何依赖。
- **P0.5 可行性验证门**（§8.1）先验证「批量出图 + 像素 diff」全链路半天内可跑；跑不通则 §8.2 整体降级为人工截图清单、工时上调。

**P0.5 实测结论（2026-09-22，✅ 通过；全链路三次迭代后收敛）**：6/6 出图、同页双轮 **`--tol 0` 严格零 diff**（逐字节确定性达成）、异页 diff 76.9% 大差异检出、构建 7.2s、四门禁全绿。**迭代中证伪并修正的三个非确定源**（差异图目视定案——品红斑块即 3 张随机封面缩略图）：
① 首访引导弹窗每轮弹出（`art-rank:guide-dismissed` 未设）→ 注入 localStorage 预置；
② `sampleByKind` 每挂载随机挑封面（UI_REVIEW #2.4 特性）→ 注入**确定性 PRNG 替换 `Math.random`**；
③ `Poster.tsx:289` 图片 `opacity:0→onLoad` 渐显过渡的时序抖动——**这才是 ≤5 LSB 噪底的真正来源**（此前误判为 `backdrop-filter` 合成噪声，被差异图证伪）→ 注入 `img{transition:none!important}` + `--virtual-time-budget` 稳定截图时机。
三项均为**工具层注入**（`ui-shot.mjs` seed 模式，默认开、`--no-seed` 关），零应用代码改动。**diff 判据定标**：seed 模式「零 diff」= `--tol 0`（严格零）；非 seed 模式/含随机内容用 `--tol 8` 噪底豁免；「真变更」= 超过对应阈值的任意像素，几何位移另按 §2.1 容差判。**两条工程教训**：`spawnSync` 阻塞事件循环 → 本地服务器与 chrome 互等死锁（截图必须异步 `spawn`）；`--virtual-time-budget` 首跑挂起的真凶是该死锁而非 flag 本身——异步 spawn 后工作正常（已保留）。**追加非确定源 #4（P0.7 发现）**：远程海报加载竞态（冷缓存跨轮重拉，海报区/兜底随机二态）→ 固定热缓存 chrome profile + **warm-pass 双跑**（先预热一轮、再采集一轮），实测 8/8 严格零 diff（§10.7）。

### 8.1 阶段划分（每阶段独立可交付、独立可回滚）

| 阶段 | 内容 | 风险 | 门禁 | 工时 |
|---|---|---|---|---|
| P0 | 清理工作区 + **本计划提交入 git**（§8.3 前置）→ 基线重锚定（行数口径脚本钉死、断点全表、!important/hex 口径统一，刷新 §10.3） | 无 | — | 0.5d |
| P0.5 | **可行性验证门**：headless Chrome 批量出图 + 像素 diff 全链路跑通？tsc/eslint/format 全绿？工作区干净？——任一失败先停 | 无 | 三项通过制 | 0.5d |
| P0.7 | **北极星屏（四轮 #二.1，全计划最高杠杆）**：Home（hero+四媒介入口+collection 行）+ Profile 榜单页**两屏真实 CSS**，以 `.note-reader` 为质感基准；真实内容上试出圆角/字阶/噪点/hairline/玻璃两级/打印材质 → **反推 token 档位**（§2.1 数值在此定案）；两屏成为全计划审美验收基准；含 medium-grid 胶囊 vs 索引对比稿（0.2d，§4.1）与玻璃/材质取舍定案 | 中（定方向） | 两屏 × 六主题快照 + 对比稿评审 | 1d（✅ 完成 2026-09-22，实耗约 0.5d，§10.7） |
| P0.9 | **速赢批**（三轮 #三：小时级、独立可交付）：kind 徽章统一媒介色（职责表回收）；toast 避让 FAB（过渡措施）；8/9px 字号清零；**poster hover 三重收敛一重**（删 jellyBounce + L65 弹簧过渡）；plaza-header 压平；CSS 死规则去重（§2.5）；**奖牌四处替换 + 同步去 `aria-hidden`**；scroll-top 触控补 44px（help-dot 随 P2 迁 topbar 解决）→ 收尾拍 **B0**（B0 定义 = 速赢后状态，见 §5.4） | 低 | 四门禁 + 局部矩阵 + 奖牌/字号逐处核对 | 0.5d |
| P1a | Token 声明（5 档圆角/间距/字阶/两档字号/L2）+ **散落 hex 归零（17 处）** + kind 徽章 token 引用核验 + 媒介色越界使用回收（前置：§2.5 去重已完成）（纯增量、**零 diff 可证**） | 极低 | 四门禁 + **零 diff 快照（seed 模式 `--tol 0` 严格零；非 seed `--tol 8`，见 §8.0）** | 0.5d |
| P1a.5 | **浅色四主题对比度扫描与 `--text-3` 定案（四轮 #三.6，纯脚本）**：retro/minimal/simple/classic 的 `color-mix` surface + `--text-3`（74% 混合，承担 44×11px + 44×12px meta）从未做过 4.5:1 验证——结果决定是否上调混合比；**若上调属 L1 token 变更，必须在 P1b 前定案**，否则 P1b/P2/P3 全部基线重拍。本计划唯一"先后顺序显著影响成本"的依赖 | 低 | 对比度报告（组合×字号矩阵）+ L1 定案记录 | 0.5d |
| P1b | 裸数值归一 + 字体栈 + 噪点（§2 余下）——**顺序：圆角收敛先行**（12 值→5 档、弹层统一单档）**再间距**（三轮 #一.1）；交付物明列 **玻璃两级制（贵级 2 类 + 普级 2 类，其余 17 类退哑光）**、阴影 36→2、动效曲线统一（含 jelly 残留清理） | 低（有容差位移） | 四门禁 + **B0→B1** 快照按 §2.1 容差判 + 动效节奏录屏 + 移动端滚动帧率手测 | 1.5d |
| P2 | 壳层：topbar/footer/toast/弹层体系（§3）+ **help 入口迁 topbar**（§0 第六类，四轮 #三.5，一次解决触控/遮挡/发现性三件事） | 低 | 四门禁 + 弹层逐个开合手测 + help 发现性手测 + toast 位置定案 | 1d |
| P3a | Home + Setup + Sorting（§4.1/4.3/4.4） | 中（Sorting 是核心流程） | 四门禁 + **完整走一遍排序→保存→导出** + **对战卡三态规格验收**（0.2s 可辨 / 非单色 / 触屏无 hover，§4.4）+ 内滚区误触回归（滚简介不触发选择） | 2d |
| P3b | Profile + Compare + Share（§4.5-4.7） | **中偏高（collection-row 特异性脆弱区，见 §9）** | 四门禁 + 分享链接生成→打开→比较全链路 + collection-row 六主题抽查 | 1d |
| P3c | Source + Plaza + PlazaPost（§4.2/4.8/4.9） | 中 | 四门禁 + 豆瓣/网易云导入、广场发帖/评论/编辑各一遍 | 2d |
| P4 | 表单控件规格统一（§6） | 低 | 四门禁 + 注册/登录/批注/发布表单手测 | 0.5d |
| P5a | 主题人格化·机制与 **retro/cyber 先行**（三轮 #一.8：retro display 现回落 Segoe UI（L525）、cyber 正文同——字体换血收益最大）+ minimal（§7）；retro 取 **0px 直角 + 正文栏宽 62ch + 首行缩进 2em**（四轮 #二.4） | 中 | 四门禁 + 三主题 12 界面快照 + **非色彩差异点逐条验收（中文界面）** | 1.5d |
| P5b | 主题人格化·simple/classic + modern 基准校准 + 对比度审计（**含四浅色主题存量审计**，三轮 #二.7）（§7） | 中 | 对比度工具扫描 + 三主题 12 界面快照 + **装饰 × 布局组合表核对（§7）** | 1.5d |
| P5c | 布局模式系统（§5，原 P4.5 **后移**——主题人格是纯 CSS 覆写先做，布局是唯一新增 JS+DOM 后做，2026-09 审查 #五）：`layout.ts` + 切换 UI + journey/bento CSS + 装饰包裹 div | 中偏高（唯一新增 JS + 唯一新增 DOM） | 四门禁 + 18 组合抽样（脚本化）+ 键盘/reduced-motion 专项 + **模式对比基线**核对 | 2.5d |
| 发布前 | **真机触控人工验收**（iOS Safari + Android Chrome 实机：journey 手势、滚动帧率；不进阶段门禁——单人/本机环境下此项估不出 2d） | — | 人工清单 | （发布窗口内） |

（工时为单人净估、不含评审等待；合计约 **19-20 人日**（四轮重估：+P0.7 北极星屏 1d、+P1a.5 对比度定案 0.5d、P3a 扩 0.5d（三态规格）；真机另计发布窗口）；自托管字体已移出本计划（§9）。）

**顺序刚性约束（四轮 #三.6）**：**P0.7 先于 P1a**（token 由样板反推，不是先定档再套）、**P1a.5 先于 P1b**（`--text-3` 若上调属 L1 变更，晚于 P1b 会重拍全矩阵）——本计划仅有的两处"先后顺序显著影响成本"的依赖。

### 8.2 视觉回归（分级矩阵，2026-09 审查意见 #7：全矩阵逐阶段跑 ≈360 张 × 9 不可行）

**分级策略**：

| 级别 | 适用阶段 | 截图范围 |
|---|---|---|
| 全矩阵 | P0（B0） / P1b（B1） / P5b / P5c 后 | 六主题 × 12 界面 × 5 视口 + 横屏（脚本化 ≈360 张/轮） |
| 局部矩阵 | P2 / P3a-c / P4 / P5a | **仅受影响视图** × {modern, 相关主题} × 2 视口（540/800） |

- 视口取 375 / 540 / 600 / 800 / 1300（代表实测断点 540/600/720/800/850/min-1300 两侧）+ 横屏；720 断点在 600/800 之间遇疑再补测；
- 截图与像素 diff **脚本化（headless Chrome，不引依赖）**：`chrome --headless=new --screenshot …` 逐条出图 + 纯 Node 驱动（§8.0，已实测跑通）；diff 超过 §2.1 容差阈值才转人工复核，人工只看超阈值项与下方清单；
- **动效时长归一单独验收**（§2.4）：录屏对照既有 `.4s/.3s/.18s` 节奏变化，不混入 P1b 静默通过；
- 布局抽样（§5）：archive × 6 主题全量（= 既有基线）；modern × {journey, bento} 全界面；其余组合抽查 2 组；journey 额外手测键盘 Tab/方向键、chevron 按钮、reduced-motion 下无平滑滚动；
- 六主题 × 12 界面（9 视图 + 引导弹窗 + 批注阅读器 + 账号弹窗）截图与 P0 基线对照；
- 主题人格化差异点（§7 验收表 + CJK 硬标准）逐条截图核对：**一律用中文界面截图**，字形/圆角/质感/边框/动效气质必须肉眼可辨地不同，「只是换了颜色」判不合格；
- `prefers-reduced-motion: reduce` 开启后再过一遍 Home/Sorting/弹层；
- 每步手测既有关键链路：**排序→完成→画像→导出 PNG/JSON→分享→比较；广场发帖→评论→编辑；注册→登录→云同步**；
- toast 队列连发 3 条、批注长文输入、FocusTrap 弹层内 Tab 循环——行为回归点。

### 8.3 回滚策略
- **开跑前置（2026-09 审查 #四/六.9）**：先把本计划提交入 git，再清理工作区（现状有未提交 WIP + staged `.zcode` 删除、HEAD 停 2026-09-21）——**脏树上的基线快照不作数**；每阶段从干净树起跑；
- 每阶段一个独立 commit 序列，`git revert` 单阶段即整体回滚；
- CSS 与 className 改动不混入任何逻辑 commit；
- 若某视图视觉改动引发布局塌陷，优先回退该视图的 className（CSS 同时兼容新旧类名过渡，两个阶段后再清理旧类）。

### 8.4 门禁基线（不得回退）
`tsc -b` ✅ · vitest **277 passed / 9 skipped** ✅ · ESLint 0 error ✅ · `format:check` ✅ · 产物体积口径按 **gzip**（2026-09 审查意见 #9）：单阶段 CSS 净增 ≤2KB gzip、全计划累计 ≤10KB gzip（≈+1000 行 CSS 的合理量级；P6 字体子集 ≤40KB 单独计），每阶段 build 后把 dist 体积记入阶段日志。

---

## 9. 明确不做

- 不做路由/信息架构调整（导航项、路径不变）；
- 不做组件库迁移（不引 Radix/shadcn/Tailwind/Zustand——纯 CSS 手工体系已经成立）；
- 不做浅色模式默认化（六主题既有格局保留）；
- 不重写 SourceView/CompareView 组件结构（只做视觉）；
- 布局模式不进入 Sorting 对战屏、表单、弹层、批注阅读器（§5.4）；
- 不加 WebGL 新效果、不加页面转场动画、不做暗黑/亮色自动切换；
- 不动三份语言混排文案的翻译（仅样式）；
- **已知债务登记（docs/UI_REVIEW.md）不清理**：14 处 modal backdrop 缺 role/aria-label 等语义级 a11y 债务**另立项处理**——本计划 focus-visible 验收只管「焦点可见」，与弹层 dialog 语义是两个标准，不冲突不搭车（2026-09 审查意见 #10）；
- !important / 特异性债务不重构（实测 37 处，P0 复测钉死）；**唯一注意点**：`collection-row` 特异性脆弱区——P3b 动 ranking-list/collection-row 时按**只叠加不修改**执行（新类名叠加旧规则，两阶段后再清理旧类），该点已在 §8.1 标为中偏高风险。
- **自托管字体（原 P6）移出本计划、独立立项**（2026-09 审查 #五：仅拉丁标题受益、却引入 CSP/子集化/回退三类新风险，与红线收益比不划算）；导出 PNG 版式美化保留可选、不占阶段；
- 真机触控验收不进阶段门禁（列发布前人工清单，§8.1）；
- **既有资产保护清单（三轮 #二.8，重构时不得顺手弄丢）**：`prefers-reduced-motion` 全局豁免、`hover:none` 触屏按压态、`kbd` 键盘提示、44px 按钮基线、`focus-visible` 轮廓——这些是很多成品应用都没有的底子，每阶段快照含对这五项的专项核对。
- **结构债即设计债，登记待下轮（四轮 #五）**：`medium-grid` 三套渲染（桌面 4 列 grid / ≤800px 2 列 / ≤540px flex 胶囊）与 `profile-dimensions` 两套渲染 = 同一组内容套三套互不兼容的视觉语言，跨设备用"不像同一个应用"——本计划不动（正确），**下一轮改版统一为单一语言**（推荐：保留桌面档案索引条目形态，小屏胶囊 → 紧凑索引行），责任挂此、不得永远停留在"结构性例外"。

---

## 10. 参考来源与校验记录（References & Validation）

本计划不是凭空生成，依据分三层：

### 10.1 硬规范参考（计划内所有量化指标的出处）
来自 ui-ux-pro-max 技能内建规则库（溯源至 Apple HIG / Material Design 3 / WCAG）：
- 触控目标 ≥44px、**组件间**间距 ≥8px（4px 档仅限图标-文字微间距，见 §2.1）← Apple HIG / MD touch-target-size
- 正文对比度 ≥4.5:1、大字 ≥3:1 ← WCAG color-contrast
- 动效 150-300ms、exit 快于 enter、`prefers-reduced-motion` 豁免 ← MD Motion / Apple Reduced Motion
- 弹层 scrim 45-60%、toast aria-live、focus-visible 环、表单错误就近显示 ← WCAG / HIG
- 字阶、tabular-nums、truncation 策略 ← MD type roles / HIG

### 10.2 反 AI 感禁令的出处
frontend-design 技能明文规则：禁 Inter/Roboto/Space Grotesk 独挑大梁、禁紫蓝渐变、禁模板化布局、禁 emoji 图标——§1 反清单逐条对应，非主观臆断。其「不同主题配不同字体与审美（different fonts, different aesthetics）」原则是 §7 主题人格化（不止换色）的直接依据。

### 10.3 基线事实（对本仓的完整盘点）
9 视图（views/ 11 个 .tsx = 9 视图 + IconButton + helpers）/ 11 弹层 / **13 组件**（components/ 12 + views/IconButton，口径注明于此）/ styles.css **639 行**（79 空 / 560 非空；审查方报 638 系口径差，已由脚本钉死）/ App.tsx **2444 行**（13 空 / 2431 非空；审查方报 2414 系口径差，已钉死）/ !important **37 处 occurrence**（= collection 族 32 + reduced-motion 4 + 其他 1；15 条规则含 !important；32/15/37 = occurrence/rule/总数三口径，已统一）/ hex **140 处**（token 定义层 123 + 散落 17，P1a 归零对象）/ `var(--font-serif)` 使用点 2 处（`.cover-fallback span`、`.note-reader-body`）/ 6 主题 / CSP 头（`font-src 'self' data:`，仅 worker 下发、无 `_headers`）/ 断点分布（**max-width 520/540/600/720/800/850 + min-width 1300**，另 hover:none、prefers-reduced-motion 两条能力查询；850 有带空格/无空格两种写法；**520 系 2026-09 审查补录**——`@media (max-width:520px)` 带空格写法，前两轮正则均漏，前轮"520 非断点"的结论**作废**）。

**基线时效声明**：本计划起草于 2026-09-22、对照 HEAD 2026-09-21——此前文本中"2026-09"日期戳系笔误（此处应为 2026-02；已全量更正）。审查所称"快照落后 7 个月"即由该笔误引起，实际快照差距 <2 天。但 P0 重锚定照做（口径统一的需要）。§0-§8 的方案全部锚定在这些事实上。blur/圆角/阴影/字号的精确计数以 `docs/ui-baseline.json` 与 §10.6 表为准。

### 10.4 量化设计数据库校验（2026-09 补做，ui-ux-pro-max `--design-system` + `--domain typography`）
**采纳**：
- 排印方向 editorial / classic / literary（Cormorant Garamond·Libre Baskerville 的 mood 标签）→ 与「夜间档案馆」定位互证，落到 serif 栈（Georgia/"Songti SC"，即现有 `--font-serif`）承载阅读器/长文；
- 深底 + 高对比文字的色彩结构（数据库推荐 #0F0F23 系深底）→ 与现有 #080a0a 体系同构，不改；
- 大留白（48px+ 区块间距）、hover 200-300ms → 并入 §2 间距 token 与动效预算。

**采纳为可选（2026-09 用户决策：可以存在，由用户自由选择是否使用）**：
| 数据库推荐 | 落地方式 |
|---|---|
| Horizontal Scroll Journey 横向卷轴 | → `journey` 布局模式（§5.2）：默认关闭；「胶片盘」美学化；chevron affordance + 键盘支持 + reduced-motion 豁免，对冲 `horizontal-scroll`/`gesture-conflicts` 规范风险 |
| Bento Grid 卡片墙 | → `bento` 布局模式（§5.3）：默认关闭；「档案格」规格（非均匀跨度、hairline 无阴影、mono 编号）规避「同款圆角卡片墙」反模式 |

**仍拒绝**：
| 数据库推荐 | 拒绝原因 |
|---|---|
| Google Fonts 外链（Cormorant/Playfair/**Inter**/Roboto） | CSP `font-src 'self'` 直接拦截；且 Inter/Roboto 在反 AI 感禁用清单 |
| Playfair Display + Inter（Classic Elegant 配对） | 正文 Inter 禁用；改用系统 serif 栈 + 若 P6 自托管则 Cormorant 拉丁标题子集（≤40KB woff2） |

结论：数据库校验**加固**了原方向（editorial/档案感被独立数据源印证）；两处按用户决策翻案——Horizontal Scroll Journey 与 Bento Grid 由拒绝改为**可选布局模式**（§5，默认关闭，`archive` 逐像素不变）；另将 P6 自托管字体候选锚定为 Cormorant Garamond（仅英文标题）。ui-ux-pro-max 对横向滚动/同质卡片墙的反模式警告（`horizontal-scroll`、`gesture-conflicts`、同质卡片墙）不删除，转化为 §5.2/§5.3 的强制缓解规格。

### 10.5 三轮美术/UX 实测核对记录（2026-09，对 styles.css 全文与实际视图的人工核对）

新事实（前两轮未覆盖，全部已落位到对应章节）：blur 用于 **20+ 类表面**（目标 3 处，§1/§2.4）；阴影 **8 种** rgba 黑 + 彩色 glow（§2.1）；圆角 **12 种值** 且同屏不一致、弹层 4 种（§2.1）；字号 **8/9/10px** 三档破中文可读线（§2.1）；**kind 媒介徽章色义冲突**——L170-173 用 `--ok/--indigo/--pink/--warn` 而非媒介四色（§2.1/§4.8）；**CSS 重复定义 5 组** + 空注释块（toast 动画 L132/300、guide-modal L36/237、rank-detail-dialog L117/221、plaza-grid media L135/136、ranking-card-top3 L81/264，§2.5）；**toast 与 help 按钮真实碰撞**（`right:20 bottom:20` z-60 vs `bottom:28 right:28` z-50，§3.3）；`artwork-info` 98px 内滚无暗示（§4.4）；**奖牌 emoji 三处**（Compare/Plaza/Profile，§4.5/§0）；retro display 回落 Segoe UI（L525）、cyber 正文同（§8.1 P5a）；scroll-top 40px / help-dot 20px 触控欠账（§6）；弹性曲线 `cubic-bezier(.34,1.56,.64,1)` 与 ease 混用、jellyBounce 全局海报 hover（§2.4）。

**做得好、明确保护的既有资产**（三轮 #二.8）：reduced-motion 全局豁免、hover:none 按压态、kbd 提示、44px 基线、focus-visible、媒介四色系统、note-reader 表面（全站质感基准）、`.poster` inset hairline——已录入 §9 保护清单。

### 10.6 四轮复测精化与方法修订（2026-09）

**数字精化**（10.5 的粗数以本表为准）：

| 项 | 三轮粗数 | 四轮精确值 |
|---|---|---|
| blur | 20+ 类表面 | **21 个 distinct selector**（另 4 条主题 none 覆写串）；半径 **13 种**（8/10/12/14/16/18/20/22/24/28/40px…），无规律 |
| 圆角 | 12 种值 | 语法去重 **21 个值**（扣 50%/!important/复合 ≈17 纯档位，口径 P0 钉死）；弹层 6px×5、14px×8、16px×2、20px×1 |
| 阴影 | 8 种 rgba 黑 | **36 个 distinct `box-shadow`**（rgba 黑 14 + 彩色 glow 8 + inset 若干） |
| 字号 | 8/9/10px 破线 | 8×2、9×2、**10×19**、11×44、12×44 |
| jellyBounce | L66 | L50 定义、**L66 `.poster:hover` 挂载（杀伤点）**；poster hover 实为**三重**（L65/L66/L68） |
| 奖牌 emoji | 三处 | **四处**（+RankingDetail.tsx:129，且该处 `aria-hidden="true"`——视觉唯一名次标识对读屏不可见，本就带病） |

**方法修订**（四轮 #二/三）：P0.7 北极星屏（规则先行 → 样板先行，§1.5）；玻璃两级制替代纯收缩（§1）；媒介色职责表（§2.1）；字号两档制 + `--t-micro` 白名单（§2.1）；bento 弃 mod-3 改固定首项扩格，n=8 反例留档（§5.3）；对战卡三态规格（§4.4）；内滚区治本（§4.4）；help 迁 topbar 提前 P2（§3.1）；`--text-3` 定案前置 P1b 前（§8.1 P1a.5）；retro 0px + 62ch/2em（§7）；奖牌四处 + 去 `aria-hidden`（§0/§4.5）。

**保留不动项**（四轮 #四，后续任何简化不得触碰）：§8.0 诚实声明、§5.4 基线三分、§2.5 去重纪律、§9 保护清单、§2.1 结构性例外清单——这是本计划可信度与安全性的支柱。

### 10.7 P0.7 执行记录：北极星屏（2026-09-22，✅ 完成）

**交付**：Home + Profile 两屏真实 CSS（`styles.css` 末尾「P0.7 样板」区块，P1a/P3a 按段落约定并入正式段落），**CSS-only、零 JSX 改动**。
- **设计语言落地**：档案标头（mono eyebrow + 16px 短线 + 11px，中英皆生效）、CJK 宽字距副标（.34em「我 的 艺 术 人 格」）、serif 引文、纸感噪点（feTurbulence 4.5% 融进 body 背景层）、hero 半调网点（4px 周期、渐显遮罩）、玻璃两级（贵级 identity/home-actions 胶囊 + inset 压凸高光线）、媒介色 **3px 顶标 + 小色块**（职责表三处用色之一）、hairline 分区秩序、mono tabular 编号（01-04 索引 / 01-10 名次）。
- **token 定案**（反推自两屏，§2.1 已同步）：圆角 3/6/12/18/999；字阶 80/29/20/17/15/13/11/10；`--ls-wide:.22em`、`--ls-mid:.08em`；`--ease-out:cubic-bezier(.22,.61,.36,1)` + 150/220/320ms。
- **对比稿结论（待用户终审）**：**A（4 列索引卡）胜出为 medium-grid 默认稿**——四媒介是"选择网关"而非长列表，卡片的海报优先 + 01-04 编号即目录语言；**B（档案索引条目行）保留**为 `[data-ns="index"]` 开关（≥541px 生效），行式留给 P5c 布局模式/长榜单场景。容器断点全接管：4 列 / ≤800 2 列 / ≤540 胶囊（结构性例外保留）。
- **工具链增强**：`ui-shot.mjs` per-shot 注入 `theme` / `fixture` / `ns` 变体开关 + **自证标签**（shot 名烙进像素左上角——根治多图批读的附件错位）；`scripts/ui-fixtures.json` demo 画像「夜航西飞」（2 领域 18 件作品）。⚠️ fixture 坑：`parseProfile` 要求 `version` 为**数字** 2（字符串 "2.0" 会被拒并回落守卫页）。
- **新非确定源 #3（远程海报加载竞态）**：冷缓存 chrome profile 每轮重拉远程海报，r5 有图 / r6 兜底——**固定热缓存 profile + warm-pass 双跑**解决，实测 warm vs capture **8/8 严格零 diff**（`--tol 0`，含海报区）；已并入 §8.0 判据。
- **工程教训**：CSS 特异性陷阱——旧 `.medium-item`（0-1-0）在 minified 产物中胜出新规则（渲染成旧内部网格、描述文案漂到右下角），统一 `.medium-grid>` 前缀（0-2-0）后按设计渲染；特异性问题**必须以渲染事实裁决**，产物 grep 只能证明"存在"不能证明"获胜"。

---

## 附：改动文件清单（预期）

| 文件 | 改动性质 |
|---|---|
| `src/styles.css` | 主战场（token 化 + 全量视觉规格 + 布局模式块 + 6 主题人格块），预计 +1000/-300 行 |
| `src/views/*.tsx`（9 个） | 仅 `className` 与 aria-hidden 装饰节点 |
| `src/components/*.tsx`（12 个）+ `views/IconButton.tsx` | 同上 |
| `src/App.tsx` | 仅壳层/弹层 className + `data-layout` 切换 effect（§5.1） |
| `src/main.tsx` | mount 前挂 `data-layout` 3-5 行（镜像 readTheme 防闪烁模式） |
| `src/lib/layout.ts`（新增） | ≤30 行，1:1 复刻 `theme.ts`（readLayout/applyLayout/持久化） |
| `src/lib/theme.ts` | 仅顶部注释更新（注释级改动，逻辑零变化） |
| `src/components/ThemeSwitcher.tsx` / `SettingsMenu.tsx` | 增加布局切换组（同款 menu-item，mono 方格图标预览） |
| `scripts/ui-audit.mjs` / `ui-shot.mjs` / `ui-diff.mjs` / `ui-shots.json`（新增，开发工具） | P0/P0.5 工具链：基线盘点（口径钉死）、headless Chrome 批量截图、纯 Node PNG 像素 diff；零依赖、不进产物（§8.0/§8.2） |
| `docs/ui-baseline.json`（新增） | P0 基线快照（`ui-audit.mjs` 输出存档，数字争议以此重跑为准） |
| `public/` | 噪点纹理（默认 data-URI 零文件）；自托管字体已移出本计划（§9） |
| `index.html` | 仅 meta theme-color 相关（如需） |
