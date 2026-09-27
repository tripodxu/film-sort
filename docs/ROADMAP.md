# ROADMAP — 后续计划与待办

本文档汇总两块工作:**Jev(TypeSafe AI)集成路线图**与**前端打磨 P2 待办**(2026-09-27 全量审查报告中尚未处理的建议)。已完成的主线见 `CHANGELOG.md` 与 git log;本文只记录未来工作。

> 注:文中 `file:line` 为 2026-09-27 前后的行号,实施时以符号/类名为准。

---

## 一、Jev 集成路线图

### 0. 背景与集成原则

Jev 是 TypeSafe AI 的「System One」决策模型(2026-09-15 发布):输入 state,输出**带校准概率的类型化决策**(Choice / Score / Noul 三种原语,单次调用可混用、并行评估、互不污染),不生成文本、不会幻觉。REST 调用:`POST https://api.typesafe.ai/v1/systemone`,Bearer 认证;输出 token 免费,输入 $0.042/MTok,响应 70–500ms。

集成四原则:

1. **key 不内置**——与 AI 点评的配置模式一致:用户在网页端自行填 TypeSafe API key,存浏览器 localStorage,请求时透传给 worker,worker 不落盘任何 key;
2. **决策而非生成**——只把项目里「本质是判断」的环节交给 Jev;文本生成类(AI 点评)继续走现有 OpenAI 兼容通道;
3. **降级可用**——每个接入点都必须在未配置 key / 请求失败时回落到现有逻辑或明确提示,主链路永不依赖 Jev;
4. **非关键路径先行**——早期访问阶段的新服务,先接消歧、护栏、预测预填,不动关键数据链路。

### Phase 1:AI 快排(已批准,进行中)

把清单变成榜单的第三种方式:除 1v1 自行排序、仅保存不排序之外,调用 Jev 依据用户历史取舍**预测完整顺序**,跳过逐对比较。

**前端**

- `src/lib/typesafe.ts`(新):配置读写(localStorage `art-rank:typesafe-config`,只存 apiKey)+ `requestJevRanking()` 调 worker 端点,错误映射与 `aiInsight.ts` 同风格;
- `AiConfigDialog` 增加「Jev(TypeSafe)」小节:key 输入框 + 测试按钮,与现有 AI 配置并列;
- `SetupView` 第三个动作按钮「AI 快排」(Sparkles 图标):未配 key 时提示去设置;成功后按预测顺序直接成榜(`toRankedItems` → `mergeRanking` → `persist`,与 `saveWithoutSortingFn` 同路径)并跳画像页;notice 明示「AI 预测排序,可在榜单页手动微调」。

**Worker**

- `worker/typesafe.ts`(新):REST 客户端、入参校验、30s 超时、错误映射(401→key 无效、429→限流、超时→unavailable);
- `POST /api/ai/jev-rank`:入参 `{kind, works[], topN?, tasteContext?, config:{apiKey}}`;payloadGuard 校验 + 复用 `rateWindow` 限流。

**排序逻辑**

- state = 用户历史取舍摘要(已有榜单的媒介/名次序列,紧凑文本,设截断预算)+ 当前清单上下文(清单标题);
- questions = 每件作品一个 Score(0–100,「这位用户会把这件排多高」)——Jev questions 并行评估,30 件作品单次调用;
- 排序 = score 降序,同分按 confidence、再按清单原序稳定;
- works > 255 拒绝(Jev Choice 基数上限;提示改用简易模式);无历史画像时 state 只含清单上下文,文案如实说明「依据作品口碑 + 你的历史取舍(如有)」;
- 成本量级:千件作品 ≈ $0.002。

**测试**:worker/typesafe.test.ts(请求构造 / 响应解析 / 错误映射,mock fetch,比照 `ai.test.ts`);线上验证无 key 降级路径;真实排序效果待用户配置 key 后端到端自测。

### Phase 2:维基消歧 Choice

`worker/media.ts`(及「其他」媒介路径)的维基候选消歧,从手写打分(限定标题 / 类型声明 / 年份守卫)换成一条 Choice 问题:「哪个候选是《X》(Y 年)的作品?」——候选列表 ≤255 天然匹配 Choice 基数;概率与 confidence 替代整套启发式。现有规则保留为降级路径(未配 key / 调用失败时)。改动面较大,独立一批提交。

### Phase 3:广场内容护栏(Noul)

发布帖子前同步检查(70ms 延迟可承受):

- Noul:「这份描述是否包含不当内容?」
- Choice:「这是有效榜单还是灌水/垃圾内容?」

命中时走现有的发布拦截 UI。当前广场无任何内容审核层,这是 Jev 在社交面上最直接的落点。

### Phase 4:回环「真实张力」Score 校准

偏好回环(A→B→C→A)现按「多次一致才保留」的计数规则标记为真实张力。可换成 Score:state 塞完整冲突链与用户相关历史,打「这组矛盾反映真实品味 vs 噪声」的分,低置信度时安排更多复测。小改进,收益是标记更可信。

### 明确不做

- **AI 点评**:文本生成,System 2 任务,Jev 无法承担,继续走现有通道;
- **图片输入**:Jev 目前只吃文本/JSON,任何基于海报画面的判断暂不可行(官方路线图有图像支持,届时再评估)。

---

## 二、前端打磨 P2 待办(2026-09-27 审查遗留)

来源:全量代码审查报告。P0/P1 大部已在前四批提交修复,以下为尚未处理的项,按主题分组,建议按批次消化。

### A. 可访问性与键盘

| 位置 | 问题 | 修法 |
|---|---|---|
| `ProfileView.tsx` rename 输入(~275) | 无 accessible label;`minHeight:'auto'` 与 44px 输入基线冲突 | 补 `aria-label`;min-height ≥36 |
| `ProfileView.tsx` WorkEditor(~1167,1194) | `<label>` 无 htmlFor/id 关联,搜索框与手动文本域无标签 | 补 htmlFor/id 对 |
| `ProfileView.tsx` rank 菜单(~418) | 菜单无 Escape 关闭 | backdrop onKeyDown Escape |
| `CompareView.tsx`(~196,217) | mode/depth segmented 用 `role="tab"` 却无 tablist 父级 | 补 tablist 或改 aria-pressed |
| `PlazaView.tsx` abilities/sort(~172,191) | 同上,tab 语义不完整 | 同上 |
| `CompareView.tsx`(~268,388) | 手动模式 checkbox 无可访问名称 | `aria-label={collectionTitle}` |
| `CompareView.tsx`(~500) | 对端导入输入 38px、busy 态只显示「…」 | 恢复 44px;显示「导入中…」 |
| `CompareView.tsx`(~332,452) | `ranking-card-poster` 点击目标缺 role/tabIndex/键盘(与 ProfileView 不一致) | 补齐同款处理 |
| `CompareView.tsx`(~1012) | `.comparison-row` `<button>` 内嵌 `.rank-clickable` 可点击 span——嵌套交互,键盘不可达 | 行改 div + 单元格各自按钮 |
| `PlazaView.tsx`(~289) | 整卡 `role="button"` 内嵌真实 `<button>`(管理/排序)——嵌套交互 | 动作区移出 role 容器或 overlay link 模式 |
| `PlazaPostView.tsx`(~863) | 点赞按钮无 `aria-pressed`、无 busy 防连点 | 补 aria-pressed + in-flight 禁用 |
| `ArtworkDetail.tsx`(~108) | 弹窗仅点背景可关,无 Escape、无焦点陷阱/归还 | useEffect Escape + 焦点管理 |
| `ArtworkDetail.tsx`(~153) | `<audio controls>` 无 accessible label | 补 `aria-label` |
| 全局 | 图标按钮普遍只靠 `title` 提供名称(title 在触屏与部分 AT 上不可见) | 逐一补 `aria-label` |

### B. 触控目标(<40px)

| 位置 | 现状 | 目标 |
|---|---|---|
| `ProfileView.tsx`(~319,664,956,965,1143) | 28px 批注/移动/删除按钮 | 视觉不动、命中区扩至 ≥36–40(参考 HomeView 圆点按钮做法) |
| `PlazaPostView.tsx`(~1073) | 回复输入 ~33px | ≥36px |
| `AiInsightCard.tsx`(~191,201) | 10/11px 徽章与复制按钮 | ≥11px 字号下限 + 命中区 ≥32px |

### C. 主题一致性(token 化)

| 位置 | 问题 | 修法 |
|---|---|---|
| `ProfileView.tsx`(~573,1163,1231) | 内联 `borderRadius:10/12/8` 绕过 `--r-xs/--r-sm/--r-md`(主题改圆角时掉队,如 retro=2px) | 换 token 或既有卡片类 |
| `ShareView.tsx`(~81,163) | 内联 `borderRadius:8/14` 同上 | 同上 |
| `PlazaPostView.tsx`(~533,585,620,758,942) | 手搓着色横幅 + 内联圆角,与 `.rank-delete-bar` 模式重复 | 抽 `.notice-banner` 工具类(`--r-sm`/`--r-md`) |
| `PlazaPostView.tsx`(~525) | 隐藏帖横幅 12px 纯 `var(--yellow)`,浅色主题可读性差 | 用 warn 配对墨色 token 或 `--text-2` |
| `AiInsightCard.tsx`(~244,275) | `sync-dot` 无基础定位 CSS,各处内联重造圆点几何 | `.sync-dot` 位置/尺寸收进 CSS |
| `RankingDetail.tsx`(~117) | 高亮行内联 background/borderLeft/paddingLeft | 抽 `.ranking-hit` 类(accent color-mix) |

### D. 结构与交互模式

| 位置 | 问题 | 修法 |
|---|---|---|
| `CompareView.tsx`(~914) | 共识分解行全内联 grid(`110px 1fr 64px`),英文标签折行;`--metric-pct` 从未按指标传入,设计的强调下划线从不渲染 | 抽 `.consensus-factor` 类;`auto 1fr 64px`;逐格传 `--metric-pct` 或删装饰 |
| `CompareView.tsx`(~187) | flex 容器内的 X 图标内联 verticalAlign/marginRight 是死代码 | 删除 |
| `CompareView.tsx` / `AiInsightCard.tsx` | 多处内联 `marginBottom:0` 覆盖 `.segmented` | 加 `.segmented.inline` 修饰类 |
| `ProfileView.tsx`(~943,1131) / `PlazaPostView.tsx`(~707) | 重排/编辑行裸 `<Poster>` 缺 `.ranking-card-poster` 包裹,与只读行尺寸/边距不一致(52×76 vs 50×72) | 统一包裹 |
| `PlazaPostView.tsx`(~1023) | 嵌套回复每层 `marginLeft:24` 无上限,深楼挤爆移动端 | 深度 ≥3 拍平或封顶缩进 |
| `PlazaView.tsx`(~305) | `.plaza-search` 类无任何 CSS 规则(死类);搜索框下划线式样与广场卡片语言不符 | 定义 `.plaza-search` 或删类 |
| `PlazaView.tsx`(~383) | 「加载更多」内联 `borderRadius:999` 绕过 token | 用 `--r-pill` |
| `src/lib/profile.ts` 入口 | index chunk 1.07MB(qrcode/lucide/全应用),构建警告持续存在 | qrcode 仅分享页用 → `import()` 动态引入;评估 manualChunks |
| `src/components/Poster.tsx`(~298) | cover-fallback(图标 + 9px 标题)在网格里观感弱 | 兜底卡视觉重设计(维持档案语言) |

### E. i18n

| 位置 | 问题 | 修法 |
|---|---|---|
| `ArtworkDetail.tsx`(~204) | `<dl>` 直接打印 API 键名作 `<dt>`(director/actors…),英文界面下中英混杂 | 已知键走 t() 字典,未知键保底 |

---

## 三、已快速回顾:四批已完成的打磨(2026-09-27)

- `5ae91cb` 移动端 Hero 抢救(identity 挤压 / 书脊重叠 / 光球衬纸)+ 图标 token 纪律(Trash2/Check/StickyNote/Rows3/Columns3)+ 来源页徽章换行 + focus 形变;
- `b5d984f` 审查 P0/P1:重排行 flex、比较页移动端单列、广场工具栏换行、RankingDetail 补 t()、publish 弹窗宽度、分享复制反馈等;
- `a1dc142` 名次墨块竖排(线上发现):36px 定宽遗留与 P0.7 padding 冲突;
- `6f3aa8a` 重排 flex 规则被后段同特异性 grid 压住,升级 (0,2,1) 特异性置于文末。
