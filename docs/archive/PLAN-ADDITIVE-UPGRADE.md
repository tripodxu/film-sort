# PLAN-ADDITIVE-UPGRADE · 纯增量升级计划（前端 UI 重构设计 + 1v1 排名算法 + 榜单比较算法）

> 类型：**计划（本次只出方案，不动代码）**
> 目标：在不删任何功能、不改任何旧渲染结果的前提下，交付 ① 一套「美观 / 优雅 / 简易」的前端 UI 设计；
> ② 1v1 取舍出排名的算法升级；③ 榜单（画像）比较算法的升级。
> 硬约束（用户 m00031 逐字）：「**我的需求是不能有减法，只能做增量，可以有新的界面，这个可以做到吗**」
> ⇒ **只增不改**：旧视图旧 DOM 旧主题旧接口一字节不变；所有新能力以「新文件 + 新分支 + 新界面」落地。
> 先例：`docs/archive/PLAN-ui-modernization.md` §0 已确立同一原则（新主题全部增量落地、旧主题 zero-diff），本计划沿用并推广到算法层。

---

## 0. 一句话

把「重排 / 重画 / 换算法」翻译成「**并排新增**」：新增 3 个纯算法模块（不接入即零影响）、
1 个第四排序模式 `adaptive`、1 个新界面 `/depth` 深度比较页、1 套新主题 `atlas` + 一份独立命名空间的增量样式表；
旧三模式（quick/classic/precise）、旧比较页 `/encounter`、旧 11 套主题、旧排序状态快照**全部保持逐字不变**，
并以「旧主题截图 zero-diff + 旧快照反序列化通过 + 测试数单调不减」三道不变量看守。

---

## 1. 事实表（全部实测于 HEAD 6ae9562，分支 main）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 排序模式只有三种：quick / classic / precise，判定集中在 `RANKING_MODES.includes(mode) ? mode : "classic"` | `src/lib/ranking.ts:11`；`src/lib/useSorting.ts` |
| F2 | 状态机入口三处可挂前置分支：`startVerification`(`src/lib/ranking.ts:473`)、`scheduleNextCandidate`(`src/lib/ranking.ts:512`)、`choosePreferred`(`src/lib/ranking.ts:676`) | 读源码 |
| F3 | 反序列化对未知 mode 宽容（回退 "classic"），对缺失的 `activeInsertion.stage` 补 "bisect"；旧 v1 快照有 `migrateLegacyState` | `src/lib/ranking.ts:1086` `isRankingState` + `deserializeRankingState` |
| F4 | `RankingMode` 无独立守卫，靠 `RANKING_MODES.includes` 做唯一校验；追加模式不需要改校验逻辑 | `src/lib/ranking.ts:11` |
| F5 | 手势/撤销/草稿等旧逻辑与模式判定解耦：`scheduleNextCandidate` 之后的所有函数对模式无感知 | 读 `src/lib/ranking.ts` |
| F6 | 比较算法全部集中在 `src/lib/profile.ts`，输出为扁平对象 `DimensionComparison`（含 `kendallTau`/`orderAgreement`/`spearmanLikeAgreement`/`consensusScore` 等） | `src/lib/profile.ts:396-822` |
| F7 | 同一件事被算两遍：一致率的 O(n²) 双循环（剔除并列）与 Kendall τ-b 的 O(n²) 双循环重复同一遍历 | `src/lib/profile.ts` 的 `compareDimensions` |
| F8 | `consensusScore` 为固定经验权重（order 30% + overlap 20% + weightedTopAgreement 20% + (100-rankDistance) 15% + era 15%，era 缺失取 70），**无样本量收缩** | `src/lib/profile.ts` |
| F9 | `mergeDimensionRankings` 支持 `best` / `median` 两种合并策略（`best` 默认） | `src/lib/profile.ts` |
| F10 | `compareProfiles` 对每个媒介重复调用 `mergeDimensionRankings`，**无缓存** | `src/lib/profile.ts` |
| F11 | 排名撤销靠 `replayDecision` + `undoLastAction` 从头重放整个 `decisionLog`，连续撤销 O(k²) | `src/lib/ranking.ts` |
| F12 | `recordPreference` 每次都对全量 `preferenceEdges` 跑 BFS（`findPath`，`queue.shift()`）检测 ≥3 长环，O(E·V) | `src/lib/ranking.ts` |
| F13 | `pairEvidence`/`decisionLog`/`preferenceEdges`/`cycleEvents` **无上界增长**，整份 `RankingState` 会被序列化进草稿与云端同步 | `src/lib/ranking.ts` |
| F14 | 主题共 11 套：modern（默认，无 `data-theme`）/retro/minimal/simple/classic/cyber/paper/editorial/editorial-dark/aurora/gallery | `src/lib/theme.ts:9` |
| F15 | 布局与主题正交，3 套：archive（默认）/journey/bento | `src/lib/layout.ts` |
| F16 | `src/styles.css` 实测 **1828 行 / 178 KB / 49 个 @media / 39 处 !important / :root 545 个变量**（token 化已完成） | 行数与关键词计数 |
| F17 | 视图联合与路由表集中在 `src/lib/useRouter.ts`：`View`(:3)、`VIEW_PATH`(:6)、`VIEW_TITLE`(:18)、`pathToView`(:29)；`compare` 映射到 `/encounter`(:12) | 读源码 + grep |
| F18 | `Record<View, X>` 在全仓**只出现在 `src/lib/useRouter.ts` 两处**（:6 与 :18），故 View 扩容的编译期报错面极小 | grep -rn "Record<View" src/ |
| F19 | `src/App.tsx` 视图分发是 **else if 链**（sorting :1303 / profile :1319 / compare :1374），content 已被 `Suspense` 包住，五个千行大视图已 `React.lazy` | 读源码 |
| F20 | `src/styles/` 目录**不存在**，`src/main.tsx:7` 只有一条 `import "./styles.css"` | 目录枚举 |
| F21 | 本计划的全部新增目标文件目前**均不存在**（`src/lib/preferenceModel.ts`、`src/lib/adaptiveQueue.ts`、`src/lib/compareMetrics.ts`、`src/lib/rankingSnapshot.ts`、`src/views/DepthCompareView.tsx`、`src/components/RankIntervalBar.tsx`、`src/components/MetricExplainer.tsx`、`src/styles/atlas.css`、本文档） | 逐项 Test-Path |
| F22 | 视觉验证链齐备：`scripts/ui-shot.mjs` / `scripts/ui-diff.mjs` / `docs/ui-baseline.json` / `docs/ui-contrast.json` 均在 | Test-Path |
| F23 | 绊线测试 `src/rankmode.test.ts` 锁死三行旧判定（`startRanking(mode: RankingMode)`、`RANKING_MODES.includes(mode) ? mode : "classic"`、`useSorting` 不含 `art-rank:rank-mode`）——追加第四模式不会动这三行，**保持绿** | 读测试 |
| F24 | 门禁基线（本计划撰写当日实测）：vitest **Test Files 54 passed / 1 skipped (55)；Tests 751 passed / 9 skipped (760)**，Duration 39.38s | npm test -- --run |

---

## 2. 现状与根因

### 2.1 UI 层

- **不是不好看，是「一套壳服务 11 种人格」**：`src/styles.css` 1828 行里 545 个变量 + 39 处 `!important` + 49 个媒体查询互相叠加，
  任何「整体美化」都必然触碰既有规则 ⇒ 在「不能有减法」的约束下，*调整旧样式* 这条路是关闭的。
- 三个待兑现的设计词（美观 / 优雅 / 简易）在旧界面上的实现方式只能是**局部重排**，而局部重排 = 改旧 DOM ⇒ 同样关闭。
- 结论：**设计力必须投放到「新增面」**——新主题（全局观感）+ 新界面（交互范式），旧界面冻结。这与 `PLAN-ui-modernization` 已验证的路线完全一致。
- 已知遗留（`docs/ROADMAP.md` §二 P2 待办）里有相当一部分是**纯追加即可修**的：缺 `aria-label`、缺 `role=tablist` 父级、缺 `Escape` 处理、触控目标 <40px、内联 `borderRadius` 绕过 `--r-*`。
  这些「加属性 / 加 token 引用」不是减法，可单列一批（见 §4 V5），但**必须逐项证明 270 张截图 zero-diff**，否则打回。

### 2.2 算法层（1v1 出排名）

- 现行 `classic`/`precise` 是**二分插入 + 门卫 + 环验证**：结果正确，但
  ① 无法给出「第 4–7 名」这种**不确定性表达**；② 对手选择是「相邻导向」，不追求信息量；
  ③ 撤销是决策重放（O(k²)），大清单下昂贵；④ `preferenceEdges` 的无界 BFS 随取舍数增长。
- 这些都不是 bug，而是**范式空缺**：缺一个「全局能力值 + 不确定度」的估计层。
  在「不能有减法」下，正解是**并排新增一个第四模式**，而不是替换二分逻辑。

### 2.3 算法层（榜单比较）

- `compareDimensions` 把同一遍历算了两遍（F7）；`consensusScore` 是固定权重且不看样本量（F8）；
  `mergeDimensionRankings` 只有 `best`/`median`，没有「按证据强度加权」的合并（F9）；
  `compareProfiles` 重复计算无缓存（F10）。
- 同样地：**旧字段一个不删**，新指标以「新增字段 + 新界面展示」落地，避免同页出现两套互相矛盾的口径。

---

## 3. 设计原则（本计划的四条铁律）

| # | 铁律 | 说明 |
|---|---|---|
| R1 | **只增不改** | 旧文件允许的改动类型只有两种：① 追加新行；② 新增可选字段/可选入参。任何删除、重命名、改变既有行为都不允许。 |
| R2 | **默认路径不变** | 新能力必须以「前置早退分支」或「新文件」承载；旧模式执行路径逐字不变（`PLAN-ui-modernization` L3 铁律同款）。 |
| R3 | **并排可选** | 新模式、新界面、新主题、新指标全部是**可选入口**，用户不主动进入则完全无感。 |
| R4 | **可验证** | 每个阶段都必须能给出「旧的不变量仍成立」的机器证据（截图 zero-diff / 反序列化夹具 / 测试数不减）。 |

---

## 4. 方案

### V —— 前端 UI 重构设计（美观 / 优雅 / 简易）

> 设计理念：**旧界面是「已验证的稳定态」，新界面是「设计实验场」。**
> 三个设计词分别由三样新增物兑现，互不干扰。

| 设计词 | 兑现载体 | 具体手法 |
|---|---|---|
| **美观** | 新主题 `atlas`（`src/styles/atlas.css`，第 12 套） | 全套变量以 `[data-theme=atlas]` 前缀新增：冷灰纸感底色 + 单一强调色 + 两级阴影 + 8px 节奏；**不覆盖任何旧变量名**，只重定义 |
| **优雅** | 增量样式命名空间 `.depth-*` + 新动效 token | 新增 `--dep-dur-1/2/3`、`--dep-ease-settle` 等**新命名**（不复用旧 token 名），进入 180–240ms ease-out、离开 120ms，`prefers-reduced-motion` 一律直落；数字用 `font-variant-numeric: tabular-nums` 防跳动 |
| **简易** | 新界面 `/depth` | 一屏一主行动（single primary action）；先给「一句话结论」，细节折叠在 `MetricExplainer`；旧界面控件数不变（不做减法） |

**V1 · 设计令牌补全（追加块）**
- 在 `src/styles.css` **文件末尾**追加一段带醒目注释的 `/* ===== ATLAS/DEPTH TOKENS (additive) ===== */`，只**新增**变量名：
  `--dep-gap-*`、`--dep-r-*`、`--dep-ev-1/2`、`--dep-dur-*`、`--dep-ink-1/2/3`、`--dep-accent-*`。
- **禁止**重定义任何既有名（`--sp-*`/`--r-*`/`--t-*`/`--surface*`/`--ev-*` 等）。理由：PITFALLS 4.20 —— 「被引用的 token 从未定义」会静默变 `none`；反过来说，**改动既有 token 的值等于给全部 11 套主题改观感**，zero-diff 必破。
- 绊线：新增断言，锁死「`:root` 中原有 545 个变量名集合在改动后仍是子集」——只许变多、不许改值。

**V2 · 新组件（新文件，不接入即零影响）**

| 文件 | 作用 | 关键设计 |
|---|---|---|
| `src/components/RankIntervalBar.tsx` | 名次区间条（「第 4–7 名」可视化） | 横向轨道 + 区间胶囊 + 置信度透明度；用 SVG 而非 canvas（可测、可截图、可读屏 `role="img"` + `aria-label`） |
| `src/components/MetricExplainer.tsx` | 指标解释卡 | 「这个分数怎么来的」：公式人话化 + 样本量提示；默认折叠 |
| `src/components/ConfidenceBadge.tsx` | 置信度徽章 | 三档（高/中/低）语义色，全部走新 token；文本永远带数字（「高 · 92%」） |
| `src/components/TrendDelta.tsx`（可选） | 与上一次比较的差值 | 只在新界面用；无历史时渲染占位而非 0 |

**V3 · 新视图 `/depth` 深度比较页**
- 新文件 `src/views/DepthCompareView.tsx`，以 `React.lazy` 接入（`src/App.tsx` 追加一个 `else if`）。
- 层级（自上而下，一屏一主行动）：
  1. **结论条**：一句话结论 + 共识徽章（带样本量）；
  2. **名次区间并列**：两条 `RankIntervalBar`（我 / 对方），重叠区高亮＝真正共识区；
  3. **指标矩阵**：头部加权 τ、位置折扣一致度、覆盖率、世代亲和，每项配 `MetricExplainer` 折叠；
  4. **分歧清单**：Top N 分歧作品（沿用现有 `disagreements` 数据，只读）；
  5. **次级行动**：切换媒介 / 维度（次要按钮，弱化）。
- 旧 `/encounter`（`src/views/CompareView.tsx`）**一行不改**，两页并存；新指标**只在新页展示**，避免新旧口径同屏打架。

**V4 · 新主题 `atlas`**
- `src/lib/theme.ts:9` 的 `THEMES` **追加一项**（数组末位）；新建 `src/styles/atlas.css`（新目录，F20/F21）；
  `src/main.tsx:7` 的 `import "./styles.css"` **之后**追加 `import "./styles/atlas.css"`（与旧样式同为「未分层」，靠源码顺序取胜）。
- **绝对禁止用 @layer**：分层规则会被未分层的旧 CSS 整体压过，新主题会表现为完全失效。
- 特异性陷阱（PITFALLS 4.19）：`[data-theme=atlas]` 前缀本身只给到 (0,1,0)+，遇到 `.ranking-list.reorder-list > li`（`display:flex`，0,2,1）这类仍会被末位基座压过；
  规避方式：**新主题只写前缀规则，不覆写 `.ranking-list` 系列**，需要形态差异时由新类 `.depth-*` 承担。
- `src/lib/themeRegistry.ts` 的 `KNOWN_VARS`/`REQUIRED_VARS` **不动**（自定义主题导入协议零影响）。

**V5 · 无障碍与触控的「纯追加修补」（单列，风险最高，最后做）**
- 允许的操作仅限：给现有元素**追加** `aria-label` / `role` / 给一组 `role=tab` 追加 `role="tablist"` 父容器、给输入**追加** `<label class="sr-only">`、给菜单**追加** `Escape` 监听。
- 每次只做一项，且必须跑 270 张截图 zero-diff（tol=0）；任一项不达标立即回退该项。
- `docs/ROADMAP.md` §二 P2 的 A（可访问性）与 B（触控目标）属于本类；**C（token 化内联样式）与 D（CompareView 结构）不在本计划内**——它们必然改旧 DOM。

---

### A —— 1v1 出排名算法升级（并排新增第四模式 adaptive）

**A1 · 新增 `src/lib/preferenceModel.ts`（纯新增，不接入即零影响）**
- 在线 Bradley–Terry / Elo 混合估计：每件作品一个能力值 θ_i 与不确定度 σ_i。
- 单次取舍的一步 Newton（Fisher scoring）更新：
  `p = 1/(1+exp(-(θ_i-θ_j)))`；`θ_i += K·σ_i²·(1-p)`；`θ_j -= K·σ_j²·p`；`σ² ← 1/(1/σ² + p(1-p))`（含 L2 收缩 λ 防爆）。
- 输出：`rankInterval(i)`（θ_i ± z·σ_i 映射回名次区间，如「第 4–7 名」）+ `confidence(i)`。
- 纯函数、无 React、无 IO；配 `src/lib/preferenceModel.test.ts`（含「全对 / 全错 / 循环偏好」三类夹具）。

**A2 · 新增 `src/lib/adaptiveQueue.ts`（纯新增）**
- 选下一对的目标：**最大信息量**，而非「相邻」。
- 收益估计：`gain(i,j) ∝ p(1-p)·(σ_i²+σ_j²)`，其中 p 由 θ 差给出；叠加两项约束：
  ① 覆盖率项——每个 item 至少连入一次（防「孤岛」不可比）；
  ② 冷却项——现有 `PAIR_COOLDOWN=3` / `WORK_COOLDOWN=4` **作为入参传入**，常量本身不改。
- 纯函数，输入 `RankingState` 的相关切片，返回候选对；配 `src/lib/adaptiveQueue.test.ts`（含「冷却期不得重排」「全覆盖」断言）。

**A3 · 新增 `src/lib/rankingSnapshot.ts`（可选，纯新增）**
- 快照栈撤销：push/pop 结构快照（上限 50，与现有 T-04 撤销深度口径一致），仅 `adaptive` 使用；
- 旧三模式继续走 `replayDecision`（**一行不改**）。
- 收益：新模式撤销 O(1) 深拷贝 vs 旧 O(k²) 重放；同时为 A5 的性能争议提供对照基线。

**A4 · 接入第四模式（四处纯追加）**
1. `src/lib/ranking.ts:11` 的 `RANKING_MODES` **末位追加** `"adaptive"`；
2. `RankingState` **追加可选字段** `bt?: BtState` / `snapshotStack?: Snapshot[]`，`isRankingState` 校验写成 `state.bt === undefined || isBt(state.bt)`（旧草稿/云快照照样通过）；
3. `scheduleNextCandidate`(:512) 与 `choosePreferred`(:676) **最前面**加 `if (state.mode === "adaptive") return adaptiveXxx(...)` 早退分支；
4. `src/views/SetupView.tsx:7` 的 `RANK_MODES` 追加第四项（该数组值类型字面量放宽为 `RankingMode`，一行），UI 为现有 segmented 控件的**第四个按钮**。
- `src/views/SortingView.tsx` 只**追加**两处：`RankIntervalBar` 区间条与信息量指示器；现有 DOM 一个节点不删不改。
- 绊线兼容：F23 的三条断言不受影响（它们锁的是那三行本身）。

**A5 · 已知规模风险的观察项（本计划不动手，只登记）**
- `pairEvidence`/`decisionLog`/`preferenceEdges`/`cycleEvents` 无上界（F13）与 D1 单行 512 KB（PITFALLS 3.2）是**同一风险的两个面**；
- 本计划只在 `adaptive` 侧提供**新函数** `capAdaptiveEvidence()`（对 `bt` 侧证据裁剪），旧数组不动；
- 若后续要动旧数组，必须先做「一条状态要不要进快照」的二选一重构，另立计划。

---

### C —— 榜单比较算法优化（并排新增指标，旧字段一个不删）

**C1 · 新增 `src/lib/compareMetrics.ts`（纯新增）**
- 输入现有 `MatchedItem[]`（`compareProfiles` 的产物），输出新字段：
  ① **头部加权 τ**：权重 `w_k ∝ 1/k`（或指数衰减），解决「冠军权重被长尾稀释」；
  ② **位置折扣一致度**：`Σ d^(k-1)·consistent(k)`，d≈0.85，头部变动更敏感；
  ③ **bootstrap 置信区间**：对共享作品对有放回重采样 B=1000，复用现有 `createSeededRandom`（`src/lib/ranking.ts`）保证可复现；
  ④ **样本量收缩后的共识分**：`consensus' = (n·raw + m·prior)/(n+m)`，`n = sharedCount`——修 F8「无收缩」的统计缺陷，`prior` 取 50。
- **旧字段 `kendallTau` / `orderAgreement` / `spearmanLikeAgreement` / `consensusScore` 全部保留原值原义**；新字段命名为 `weightedTau` / `decayedAgreement` / `tauCI` / `consensusShrunk`，类型上标为可选。

**C2 · 新合并策略 `strategy: "bt"`（纯新增分支）**
- `mergeDimensionRankings` **追加**第三分支（`best`/`median` 两分支逐字不动）：用 A1 的 `preferenceModel` 对同一作品在多榜单中的名次做能力值聚合；
- 入参 `strategy` 联合类型**追加** `"bt"`，默认值仍是 `best`（R2 默认路径不变）。

**C3 · 缓存（纯新增包装，不改旧函数体）**
- 新增 `memoizedCompareProfiles()`（Map + 输入指纹，指纹复用 `hashString`）供新界面使用；旧 `compareProfiles` 保持无缓存原样。

**C4 · 双遍历合并（仅新增函数，不动旧路径）**
- 新增 `agreementAndTau(pairs)` 单遍历同时产出「一致率 + τ-b」两套量（修 F7 的重复计算），
  仅 `compareMetrics` 内部使用；旧 `compareDimensions` 保持原样（它输出的旧字段仍来自旧实现，从而保证旧 `/encounter` 数字逐字不变）。

---

## 5. 三个特有坑（动手前必须写进每个阶段的验收）

1. **禁止 @layer**：未分层的旧 CSS 会整体压过分层规则 ⇒ 新主题表现为「完全失效」。新样式与旧样式一样不分层，只靠 `[data-theme=atlas]` / `.depth-*` 前缀与源码顺序取胜。
2. **文件末尾追加主题块仍有特异性陷阱**（PITFALLS 4.19）：新主题块碰到 `.ranking-list`、`.orb-hero-inner` 这类已有「同特异性后置修复」的类时需要更高特异性把修复一并要回。**规避**：新主题不覆写这些基座类，形态差异一律由新类 `.depth-*` / 新组件承担。该坑只影响新主题自身，不破坏旧 11 套主题 zero-diff。
3. **`View` 联合扩容会引发一次编译期「所有 `Record<View, X>` 缺键」报错清单**。本项目只有 `src/lib/useRouter.ts:6` 与 `:18` 两处（F18），好补；动手前先 `grep -rn "Record<View" src/` 复核无遗漏。

---

## 6. 不变量与验证（每阶段必跑）

| 不变量 | 手段 | 通过标准 |
|---|---|---|
| 旧 11 套主题渲染不变 | `node scripts/ui-shot.mjs` → `node scripts/ui-diff.mjs` 对比 `docs/ui-baseline.json` | **tol=0 zero-diff**（构建期间禁止截图，PITFALLS 4.1/4.2） |
| 旧快照仍可读 | 新增 `src/rankingCompat.test.ts`：v1 与 v2 历史 JSON 夹具跑 `deserializeRankingState` | 两版均通过且字段语义不变 |
| 旧比较页输出不变 | 新增断言：`src/views/CompareView.tsx` 内容哈希不变（证明新页确实是独立文件） | 哈希相等 |
| 旧模式行为不变 | `src/rankmode.test.ts` 既有三条断言 + **追加**「`RANKING_MODES` 前三项顺序不变」 | 全绿 |
| 测试数单调不减 | `npm test -- --run` | Tests ≥ 751 passed、Test Files ≥ 54 passed（基线见 F24） |
| 五道门禁 | `npm run check && npm run lint && npm run format:check && npm test -- --run && npm run build` | 全绿 |
| 线上可用 | https://sort.logicc.top 实机走查 | 通过才标 ✅（CONVENTIONS §8） |

---

## 7. 阶段划分与提交边界

| 阶段 | 内容 | 触及文件（**全部为新增或纯追加**） | 风险 | 上线验证点 |
|---|---|---|---|---|
| **S1** | 算法三模块 + 单测（不接入） | 新增 `src/lib/preferenceModel.ts`、`src/lib/adaptiveQueue.ts`、`src/lib/compareMetrics.ts` + 三个 .test.ts | 零（无引用即无影响） | 门禁 + 测试数上升；线上包哈希**不应变化** |
| **S2** | 接入 `adaptive` 第四模式 | 追加 `src/lib/ranking.ts`（:11 / 可选字段 / :512 / :676 分支）、`src/views/SetupView.tsx:7`、`src/views/SortingView.tsx`（追加 UI） | 中：触碰状态机，靠「前置早退」保证旧路径逐字不变 | 线上实机跑一次完整 adaptive 排序 + 旧三模式各跑一次 + 截图 zero-diff |
| **S3** | 新界面 `/depth` + 三个新组件 | 新增 `src/views/DepthCompareView.tsx`、`src/components/RankIntervalBar.tsx`、`src/components/MetricExplainer.tsx`（+`ConfidenceBadge.tsx`）；追加 `src/lib/useRouter.ts`（:3/:6/:18/:29）、`src/App.tsx`（一个 else if）、`src/styles.css` 追加块（V1 tokens） | 中：View 扩容 + styles.css 追加块 | 线上打开 `/depth`（SPA fallback 需 `Accept: text/html`，PITFALLS 4.35）+ 旧页 `/encounter` 数字一致 |
| **S4** | 新主题 `atlas` | 新增 `src/styles/atlas.css`（新目录）；追加 `src/lib/theme.ts:9`、`src/main.tsx:7` | 低–中：CSS 特异性 | 线上切换 12 套主题逐套截图；旧 11 套 zero-diff |
| **S5（可缓）** | V5 无障碍纯追加修补（ROADMAP P2 的 A/B 项） | 仅追加属性/label/监听 | 高（改旧 DOM 属性） | **逐项**截图 zero-diff，不达标即回退该项 |

每个阶段：独立提交（Conventional Commits + 中文描述）→ 推送 → 等 Cloudflare 自动部署 → 到 `sort.logicc.top` 实机验证 → 更新 `docs/agents/TASK-LEDGER.md` 状态。

---

## 8. 已明确撤回的「减法项」（本计划内不得出现）

以下方案在与「只能做增量」冲突后已被**明确排除**，后续任何接手者不得以「优化」为名重新引入：

- 主题收敛 11 → 2（删 9 套）
- 删除 L3 条件渲染分支 / 合并 `editorial` 系列
- 删除 39 处 `!important`
- 用 `@layer` 重组样式层叠
- 下线 `spearmanLikeAgreement` 等重复指标
- 用 BT 模型**替换**二分插入（正确做法是并排新增第四模式）
- 重写 `/encounter` 比较页结构（正确做法是新增 `/depth`）

---

## 9. 未决问题（留给人类裁决 / 后续阶段）

1. `adaptive` 的 K、λ、z（区间置信系数）取值需要线上真实取舍数据回放定标；S1 先给保守默认值并写进常量注释。
2. `RankingState` 全量序列化进云端（F13）的天花板尚未实测；建议 S2 上线一周后按真实 `decisionLog` 长度取分位数，再决定是否另立裁剪计划。
3. V5 的「纯追加修补」是否纳入本轮，取决于对「旧 DOM 属性可变」的接受度——**当前按可缓处理**。
4. `atlas` 是否需要配套的新 `data-layout` 尚未决定；默认复用现有三套布局（零新增）。
5. **adaptive 大清单质量与提前停止（2026-10-24 批三实验，代码已回退不发布）**：
   - 实验 A「边际区间分离」判据（每件 90% 区间整段在界内/界外 + 恰好 topN 件在界内）：修掉零信息平凡解（同宽区间整体落界外）后，n=12/20/30/50/100 全场景在预算耗尽前**都不触发**——边界条目的点估计天然骑在 N/N+1 上，任何对称区间必然跨界。
   - 实验 B「成对胜率」判据（界内成员对界外成员的 min θ-胜率 ≥0.8/0.85/0.9）：全不触发——shrinkage 0.05 下 θ 饱和约 0.62，θ-胜率到不了阈值。
   - **更根本的发现：n≥30 时跑满 4n 预算 + 全一致回答也会排错 Top N**（n=30/top10、n=50/top10、n=100/top20 实测全错；n≤20 全对；该现象在批二复测回流之前同样存在，非回归）。根因假设：`expectedInformation` 的 σ² 项在从未比较的序对上 ≈ 2/0.05 = 40，远大于已比较对 ≈ 1–2 ⇒ 调度器事实上的覆盖优先，4n 预算在大 n 下花在边界序对上的信息不足。
   - 建议：提前停止与调度器改进合并为一个「大清单标定」课题，与未决 1 一起用线上真实 decisionLog 回放定标（shrinkage / 覆盖率权重 / 预算斜率 / σ 上限一起调），不在离线拍阈值。UI 侧护栏**已落地**（T-20261024-05 批五）：`ADAPTIVE_RELIABLE_ITEM_LIMIT = 20`（按上表实测边界定的下限），SetupView 在 adaptive + 已选件数超限时提示改用 quick/classic，绊线见 `src/rankmode.test.ts`。

---

## 10. 本计划自身的交付状态

- 本文档：**新增**（`docs/archive/PLAN-ADDITIVE-UPGRADE.md`），不改任何代码。
- 代码：**未修改任何文件**（本计划只做计划）。
- 台账：在 `docs/agents/TASK-LEDGER.md` 顶部追加对应条目（见该文件）。

### S1 执行记录（2026-10-17）

- 交付（全部新增，零引用）：`src/lib/preferenceModel.ts`（在线 BT / 一步 Newton，维护 theta 与方差并输出 `rankEstimate` + 名次区间）、`src/lib/adaptiveQueue.ts`（`gain ∝ p(1-p)(σ_i²+σ_j²)` + 对手覆盖度，冷却常量作入参不改 `PAIR_COOLDOWN`/`WORK_COOLDOWN`）、`src/lib/compareMetrics.ts`（头部加权 τ、位置折扣一致度、bootstrap 置信区间、样本量收缩共识分，旧字段一个不删）；配套 `src/lib/preferenceModel.test.ts`(14) / `src/lib/adaptiveQueue.test.ts`(10) / `src/lib/compareMetrics.test.ts`(12) / `src/lib/additiveModules.test.ts`(8，源码扫描绊线，剥注释后断言)。
- 零引用证据：全仓检索三个模块名，除自身与其测试外 0 命中；`npm run build` 后扫 `dist/assets/*.js` 的 10 个新标识符（`consensusShrunk`/`selectAdaptivePair`/`getRankIntervals`/`rankEstimate`/`coverageDeficit`/`bootstrapTau`/`ADAPTIVE_PAIR_COOLDOWN`/`decayedAgreement`/`shrinkConsensus`/`expectedInformation`）全部 0 命中 ⇒ 产物零影响。
- 门禁：`check` ✅ ｜ `lint` ✅ 0 problems ｜ `format:check` ✅ ｜ `npm test -- --run` ✅ Test Files 58 passed / 1 skipped (59)、Tests **795 passed / 9 skipped (804)**（基线 55 文件 / 760 测试，单调上升 +4 文件 +44 测试）｜ `build` ✅。
- 执行偏差（记录在案，S2 定标必读）：
  1. 首版 `recordObservation` 只把 L2 先验的曲率写进 Hessian、漏了梯度项 `-shrinkage*theta`，败者随连败无界漂移（实测 12 轮 theta=-9、40 轮 -21）；补齐后 12 轮 theta=(0.858,-2.187,-6.401)。**后续任何先验/收缩改动都必须曲率与梯度成对出现。**
  2. 分离情形（同一对反复一边倒）下 MAP 解由先验定界 |theta| ≲ 1/shrinkage（默认 20），名次区间会收敛成确定名次；已写进模块头注释并判定为「有意行为」，要被更保守的表达就调大 `shrinkage` 或给 `RankIntervalOptions.inflation` 加系数。
  3. 单对反复比较时胜者 theta 先升后回落（单对实测第 7 轮见顶 0.62 后缓慢回 0），名次差始终单调拉大 ⇒ 排名结论不受影响；已写成测试断言与注释。
- 线上验证（提交 `8686468`）：线上首页引用 `assets/index-_oHYYUO0.js`，其 SHA256 与本地构建产物**逐字节一致**（`20667B5A…FD7F2`），包内新标识符 0 命中；`/api/health` 200 ⇒ 本轮对生产产物**零影响**，符合「不接入即零影响」的设计预期。
- 未做（按阶段边界留给 S2）：`RANKING_MODES` 追加 `adaptive`、`RankingState` 可选字段与宽容校验、状态机前置早退分支、`SetupView` 第四项、`SortingView` 名次区间条。

### S2 执行记录（2026-10-17）

- 交付（全部为「新增模块 + 前置早退分支 + 追加 DOM/CSS」，**无删除**）：
  - 新增 `src/lib/adaptiveRanking.ts`：**不往 `RankingState` 增加任何持久化字段**，能力模型与名次区间全部由 `decisionLog` 重推（O(决策数)）⇒ 旧草稿/云快照零迁移、撤销=重放自动成立。导出 `adaptiveComparisonBudget`（= clamp(n×4, n−1, n(n−1)/2)）、`adaptivePairKey`、`adaptivePoolIds`、`adaptiveObservations`、`buildAdaptiveModel`、`adaptiveOpponentCounts`、`syncAdaptiveRanking`（`rankedIds`=模型序 topN、`pendingIds`=接触对手数 < 2 者）、`scheduleAdaptiveCandidate`、`removeAdaptiveWork`、`getAdaptivePairInsight`、`getAdaptiveOrder`，常量 `ADAPTIVE_COMPARISONS_PER_ITEM=4` / `ADAPTIVE_MIN_OPPONENTS=2` / `ADAPTIVE_INTERVAL_LEVEL=0.9`。
  - 追加 `src/lib/preferenceModel.ts`：新增 `fitPreferenceModel`（见下「模型精度」）。
  - 追加 `src/lib/ranking.ts`：模式联合与 `RANKING_MODES` 末位 +adaptive（前三项顺序与字面量不动）；`ActiveInsertion` 追加**可选** `opponentId?`；`estimateTotalComparisons` 首行早退到 `adaptiveComparisonBudget`；`getCurrentComparison` 在既有守卫之后插入 `opponentId !== undefined` 早退块；`scheduleNextCandidate` / `choosePreferred` / `skipWork` / `deferWork` 各在函数体前段插入 `if (state.mode === adaptive)` 分支后 return —— **既有分支一行未改**。
  - 追加 `src/views/SetupView.tsx:7`：第四项「自适应 / Adaptive」；前三项文案与顺序未动。
  - 新增 `src/components/RankIntervalBar.tsx`（纯展示、aria-hidden）；追加 `src/views/SortingView.tsx`（`useMemo` 算 `adaptiveInsight` + eyebrow「· 自适应」+ `.progress-meta` 之后的条件 `.adaptive-strip` 块）；追加 `src/styles.css` 末尾 14 行 `.adaptive-*` / `.rank-interval-bar` 新类（git diff --numstat = 14 insertions / **0 deletions**，全部使用既有 token、无裸 hex）。
  - 新增 `src/lib/adaptiveRanking.test.ts`（17 项，含旧三模式 golden 回归、预算公式、序列化键集合与 classic 相同=零新增持久化字段、skip/defer、batch fit）。
- **模型精度：逐条一步 Newton → 批量坐标上升 MAP**
  - 病灶（实测）：12 件清单用 adaptive 比较 50 次只命中 top-5 **3/5**，而 classic 用 26 次就 5/5。根因是 `recordObservation` 逐条一步 Newton 把方差逐条乘性收窄，早期「零证据相邻对决」把顺序锁死，后续观测几乎拉不动（路径依赖 + 区间虚假收窄）。
  - 修法：新增 `fitPreferenceModel` —— 逐坐标一维牛顿（gradient = −prior·(theta_i − initialRating) + Σ(胜 + (1−p) / 负 − p)，curvature = prior + Σp(1−p)，delta = learningRate·gradient/curvature），默认 6 轮、单轮最大 |delta| < 1e-4 提前停；方差取对角 Laplace 1/curvature 后 clamp。O(轮数·决策数)，**与观测顺序无关**，区间宽度反映总证据量。原 `recordObservation` / `recordObservations` 原样保留（既有测试与在线语义不动），仅 `buildAdaptiveModel` 改用它。
  - 修后实测（IDS=[a..l]、TRUE_ORDER=[d,a,k,c,h,b,e,j,f,i,l,g]、seed golden-1、topN 5、规则=总选真实名次更高者）：`rankedIds` = [d,a,k,c,h]（=真值）、**全序等于 TRUE_ORDER**、`comparisonCount` 50、roundTrip true、deterministic true；旧三模式逐字不变（`rankedIds` 均 [d,a,k,c,h]，比较次数 24/26/28）。
  - 预算-精度曲线（比较次数 → top-5 命中 / 全序 Spearman）：8→3/5, 0.671；12→4/5, 0.825；16→4/5, 0.846；20→4/5, 0.909；24→5/5, 0.965；30→4/5, 0.972；36→5/5, 0.993；**42→5/5, 1.0（全序精确）**；48/50→1.0。topN=12 时 24 次→12/12 命中、48 次全序精确 ⇒ **4n 预算成立**（12 件 = 48 次，42 次已精确）。
  - 性能（300 件、400 次比较）：整轮平均每次 `getCurrentComparison+choosePreferred` ≈ **14.14 ms**（5655 ms / 400 决策），单次 `buildAdaptiveModel` ≈ 2 ms。
- **视觉验证：旧三模式在本页像素级零差异（tol=0）**
  - 方法学：一次性 Playwright 脚本（`.tmp/`，已 gitignore、不入库）走真实流程（首页 → 影片合集诺兰 12 件 → /setup 选模式 → 开始相遇 → /sorting 连点左侧 6 回合 → 截图）；确定性三件套 = 预置 `art-rank:guide-dismissed` + 固定种子 PRNG 覆写 `Math.random` + 阻断跨域海报/字体请求 + 禁过渡动画。**控制实验**：未加这三件时**同一构建**两次截图相差 0.7526%（bbox 覆盖卡片区）⇒ 那种前后对比完全不可信；加上后同一构建两次 diffPixels = 0。
  - 零差异：HEAD 构建（`.tmp/before`）与 S2 构建（`.tmp/after`）的 `sorting-classic-1300x900.png` / `sorting-classic-540x960.png` 经 `node scripts/ui-diff.mjs --tol 0` ⇒ **diffPixels 0 / pct 0 / maxDelta 0**；两次 classic 的 6 回合对手序列与 `.progress-meta` 文本逐字相同。旁证：before 构建的 /setup 只列 3 个模式（证明确实跑在 HEAD 包上）。
  - 新增 UI 实测：adaptive 收尾 `.adaptive-strip` 文本「名次区间 · 90% 置信 / 还可比较 42 次 / 第 4–9 名 奥本海默 / 第 5–10 名 记忆碎片 / 这一对仍能区分名次，先问它。」，桌面与移动端各截图人工确认无溢出、无遮挡、移动端单列正常。
- 门禁：check ✅ ｜ lint ✅ 0 problems ｜ format:check ✅ ｜ test ✅ Test Files 59 passed / 1 skipped (60)、Tests **812 passed / 9 skipped (821)**（S1 基线 58/1、795/9 ⇒ +1 文件 +17 测试，单调上升）｜ build ✅ 3.34 s（`dist/assets/index-62AQJal8.js` **426816 B** / gzip 142719 B；S1 基线 415520 B ⇒ +11296 B，来自 `ranking.ts` 引入三个模块）。
- 线上验证（提交 `d971a50`）：Cloudflare 部署完成后 `https://sort.logicc.top/` 引用 `assets/index-62AQJal8.js`，SHA256 `BCF2AC3F161C93453192572B5AD49484926C730919547569D2BF310E85DFF052`（426816 B / gzip 142719 B）与本地 `dist/assets/index-62AQJal8.js` **完全一致**；真实浏览器线上走查：/setup 已列出第 4 个模式「自适应」，线上跑 3 回合 adaptive 正常且 `.adaptive-strip` 与 `.progress-meta` 数字一致（「还可比较 45 次」=「3 / 12 预计剩余 45」），旧模式 classic 线上跑 2 回合正常（对手序列与本地逐字相同：蝙蝠侠：侠影之谜 vs 信条 → 信条 vs 星际穿越）；`/api/health` 200（D1 ok）。本次部署传播约 1 分钟即生效（S1 时曾出现 1–3 分钟 asset 短暂 404，属已知传播延迟）。
- 执行偏差（记录在案）：
  1. 原计划 S2 只做「接入」，实测发现**接入会暴露 S1 模型的路径依赖缺陷**（见上「模型精度」），故追加 `fitPreferenceModel`。二者语义并存：在线逐条 vs 批量拟合，`recordObservation` 不删。
  2. 计划外的一致性修补：`src/views/SortingView.tsx` 的 `.progress-meta` 在 adaptive 下改取 `adaptiveInsight.remaining`（否则同屏出现「预计剩余 14」与「还可比较 42 次」两个互相矛盾的数字）；旧三模式取原表达式，已用 tol=0 zero-diff 证明渲染不变。
  3. **首版对照基线无效**：只 stash 已跟踪文件、未挪走未跟踪的 S2 模块，导致 HEAD 的 `ranking.ts` 与新版 `adaptiveRanking.ts` 混编译，`tsc -b` 失败（`src/lib/adaptiveRanking.ts(199,9): error TS2353: ... opponentId does not exist in type ActiveInsertion`）、`vite build` 未执行、dist 仍是改动包却照样截图。**跑对照基线必须先断言基线包的可见特征。**
  4. 工具事故：PowerShell 多路径 `Move-Item` 把整个 `src/lib` 移到仓库根（教训：**批量移动文件一律用 Node fs 逐文件操作**）；事后用 `git hash-object` 与 HEAD blob 逐一对齐确认无残留。
  5. `tools.read` 大文件后回写会截断（曾把 `src/styles.css` 1827 行写成 439 行）；**对生成型大文件永远追加写，不要 read→write 回写**。
- 未做（留 S3 及以后）：/depth 新界面与 `MetricExplainer` / `ConfidenceBadge` 组件、atlas 主题、V5 无障碍修补；`scripts/ui-shot.mjs` 目前只支持单次 click，无法把 /sorting 流程纳入在库 270 张截图清单 ⇒ 「给 `ui-shot.mjs` 加多步 steps 数组」登记为后续可选增量（未做，避免动共享验证工具）。

### S3 执行记录（2026-10-17）

- 交付（新增 4 个文件 + 4 个既有文件纯追加，**零删除**）：
  - 新增 `src/views/DepthCompareView.tsx`（约 15.8 KB）：只读页，`useMemo` 调 `compareProfiles(profile, peer)` 与 `computeCompareMetrics(entry.result.shared, { rawConsensus: entry.result.consensusScore })`；渲染 `.depth-hero`（收缩共识分 + `ConfidenceBadge`）、`.depth-metrics` 四格（头部加权 τ / 位置折扣一致 / τ 置信区间 / 序对账本）、三个 `MetricExplainer`、`.depth-rows` 分歧作品（最多 5 条，含我方/对方名次点阵条）、`dl.depth-legacy` 13 行旧指标、`.depth-cross`。**不含 localStorage / fetch / 任何写接口**（有源码绊线看守）。
  - 新增 `src/components/ConfidenceBadge.tsx`（阈值 80/50，类名 `confidence-badge is-{high,medium,low}`）与 `src/components/MetricExplainer.tsx`（`aria-expanded` + 默认收起）。
  - 追加 `src/lib/useRouter.ts`（`View` 联合 + `"depth"`、`VIEW_PATH.depth = "/depth"`、`VIEW_TITLE.depth = "深度比较 · ART/RANK"`；`pathToView` 未改，`/depth` 靠末尾 `Object.entries(VIEW_PATH)` 兜底命中）、追加 `src/App.tsx`（`const DepthCompareView = lazy(...)`、顶栏第 4 个按钮「深度 / Depth」、视图分发链 `else if (view === "depth")`）、追加 `src/views/types.ts`（`DepthCompareViewProps`，只收 profile/peer/t/navigateTo 四个 prop）、追加 `src/styles.css` 末尾 **53 行**（`.depth-*` / `.confidence-badge` / `.metric-explainer`，1842 → 1895 行）。
  - 新增 `src/depth.test.ts`（16 项源码绊线：路由只增不改 / 旧 `CompareView.tsx` 不含任何 S3 新符号 / 新页无写接口 / 追加块无裸 hex、无 `!important` 且引用的每个 `var(--x)` 都已有定义 / 两个新组件契约）。
- 执行偏差（记录在案）：
  1. 计划 S3 行里列了 `RankIntervalBar.tsx`，但它在 S2 已新增且输入是 adaptive 专用的 `RankInterval`，比较页没有对应数据 ⇒ `/depth` **不复用**该组件，改用自己的 `.depth-rank-bar` 点阵条；绊线断言新页不含 `RankIntervalBar` 以防误接。
  2. 计划 S3 行写「追加 `--dep-*` 新 token」，实际**未引入任何新令牌**：新规则全部直接引用既有令牌，没有新增设计常量需要间接层（颜色零裸 hex）。绊线因此改为断言「追加块引用的 `var(--x)` 全部有定义」（PITFALLS 4.20 型守卫）。
- 门禁：check ✅ ｜ lint ✅ 0 problems ｜ format:check ✅ ｜ test ✅ Test Files **60 passed / 1 skipped (61)**、Tests **828 passed / 9 skipped (837)**（S2 基线 59/1、812/9 ⇒ +1 文件 +16 测试，单调上升）｜ build ✅ 3.46 s（`dist/assets/index-BcAQwz7W.js` **427.15 kB** / gzip 142.82 kB；新页面独立分包 `DepthCompareView-yBbb2zbw.js` 14.76 kB / gzip 5.96 kB ⇒ 懒加载成立，主包只增加路由与导航的少量字节）。
- 视觉验证（一次性 Playwright 脚本，`.tmp/` 已 gitignore 不入库；夹具 = `scripts/ui-fixtures.json` 的 `demo-profile` 作我方 + 程序化错位同源画像作对方；桌面 1300×900 与移动 540×960，dsf 2）：
  - `/depth` 真实数据渲染正常：收缩共识分 **73.4**（原始 89、共同作品 9）、徽章「中等」、四格新指标「头部加权 τ 89 / 位置折扣一致 91 / τ 置信区间 80.6–100（bootstrap 200 轮 · 90% 水平）/ 序对账本 36 / 36」、分歧作品 5 行、旧指标 13 行齐全。
  - **与相遇页同源一致（跨页核对）**：新页旧指标表 一致率 92% · 加权头部一致 78% · 重合度 90% · 共识分（旧）89 · 跨媒介一致 77%，与 `/encounter` 实测 顺序一致率 92% · 加权偏好一致 78% · 作品重合度 90% · 综合共识评分 89 · 跨媒介共识 77% 逐项相同。
  - 无横向溢出：两页在 1300 与 540 宽度下 `document.documentElement.scrollWidth === window.innerWidth`；顶栏桌面显示 清单/相遇/深度/广场/我的文化索引，移动端显示 4 项且**含「深度」**，active 为「深度」。
  - 旧页像素证据（stash 基线法 + `scripts/ui-diff.mjs --tol 0`）：HEAD 与 S3 两版构建各截 `/encounter` 三张（桌面/移动 viewport）⇒ 差异**全部落在顶栏带**（桌面 bbox y 38–51 CSS px、diffPixels 4901 / pct 0.1047%；移动 bbox y 28–37、diffPixels 1441 / pct 0.0695%）；同一次对照中另一张桌面截图额外多 88 个差异像素（`.segmented` 的「自动合并」按钮焦点环），同一构建第二次截图不复现 ⇒ 判定为截图时序造成的瞬时焦点态，非代码差异。基线包可见特征已断言：HEAD 包内 `深度比较` **0 命中**、S3 包 **3 命中**，两版均含 `自适应` 2 命中。
  - 结论口径：S3 对旧页的可见变化**仅在顶栏**（新增第 4 个导航项，属用户已批准的增量），顶栏以下内容逐像素不变；因此本阶段的验收标准是「旧页数字与内容一致」而非整页 tol=0。

- 线上验证（提交 `2c21f62`，已 push `63c0604..2c21f62`）—— 本次传播极快，约 45 秒即生效（轮询第 3 次已切换）：
  - 首页引用 `assets/index-BcAQwz7W.js`，SHA256 `5D9330C87CD51EA90FBBD56EB83B14237C47BE675EFA1B31F2AC0B0A22974E6B`（427152 B）与本地 `dist/assets/index-BcAQwz7W.js` **逐字节一致**。
  - 新页独立分包 `assets/DepthCompareView-yBbb2zbw.js` 线上 200、14760 B、SHA256 `D10159F167B6834455573B3E5C8A8B39029251CAA7BD5A09B2F0A365A9BAC035` 与本地一致 ⇒ 懒加载 chunk 确实上线并可被按需取回。
  - `/depth` 与 `/encounter` 带 `Accept: text/html` 均 **200**（1435 B SPA 外壳、引用主包）⇒ SPA fallback 正常（PITFALLS 4.35 的 header 要求已满足）。
  - 真实浏览器线上走查（同一套夹具）：`/depth` 渲染出 收缩共识分 **73.4** / 徽章「中等」/ 四格新指标 **89 · 91 · 80.6–100 · 36–36** / 分歧作品 5 行 / 跨媒介条「共同作品 16 · 媒介覆盖 100% · 跨媒介一致 77% · 总重合度 47%」，旧指标 13 行与本地逐字相同；顶栏 清单/相遇/**深度**/广场/我的文化索引，`深度` 为 active；`scrollWidth === innerWidth === 1300`（无横向溢出）。`/encounter` 线上 作品重合度 90% · 顺序一致率 92% · 加权偏好一致 78% · 综合共识 89 · 跨媒介共识 77% 与新页旧指标表一致。
  - `/api/health` **200**：`{"ok":true,"version":"2.0.0","checks":{"storage":"d1","database":"ok"}}`。
- 未做（下一步）：~~提交 → 推送 → 线上验证~~ 已完成（见上）⇒ **S3 全部完成**，下一阶段为 S4（新主题 `atlas`）；`scripts/ui-shots.json`（在库 270 张）里既没有 `/sorting` 也没有 `/depth` 条目 ⇒ 基线不因本页变化，「给 `ui-shot.mjs` 加多步 steps 数组」仍登记为后续可选增量（未做，避免动共享验证工具）。

### S4 执行记录（2026-10-17）

- 交付（新增 2 个文件 + 追加 4 处 + 更新 1 条既有绊线）：
  - 新增 `src/styles/atlas.css`（新目录 `src/styles/`，1539 B）：`[data-theme=atlas]{...}` 令牌块（21 个必需变量全覆盖）+ 2 条保守 L2 形态规则（`.button` 收角到 `--r-sm`、`.topbar` 细线加深）+ `.theme-dot.theme-atlas` 菜单色点。
  - 追加 `src/lib/theme.ts` 的 `THEMES` **末位**一项 `{ id: "atlas", zh: "图册", en: "Atlas" }`（旧 11 套 id 与顺序一字未动）；追加 `src/main.tsx` 一行 `import "./styles/atlas.css";`（紧跟 `./styles.css` 之后，同层未分层靠源码顺序取胜）；追加 `src/components/ThemeSwitcher.tsx` 的 `NEW_SERIES` 集合 `"atlas"`（归入「新系列」组）；追加 `scripts/ui-shots-themes.json` 两格（`th-atlas-home` / `th-atlas-profile`，22 → 24 格）。
  - 新增 `src/theme-atlas.test.ts`（13 项源码绊线）；**更新 1 条既有绊线**：`src/ui-fixes.test.ts:361` 的「内置主题共 11 套」断言 11 → 12，并加注释说明「S4 有意新增第 12 套；数量变化必须显式确认」（旧 11 套的 id 与顺序改由 `src/theme-atlas.test.ts` 逐项断言）。
- 令牌口径澄清（对 S4 施工单的修正）：主题**必须**通过 `[data-theme=atlas]{...}` **作用域覆写同名令牌**——这正是既有 11 套的做法，不改 `:root` 的全局取值即可。被禁止的是：改 `styles.css` 里 `:root`/既有主题块的任何内容、新造令牌名、引入 `@layer`。本阶段的绊线把这三条都钉死了：atlas.css 每条选择器都以 `[data-theme=atlas]` 或 `.theme-dot.theme-atlas` 开头（结构上不可能影响其它主题）；每个 `--x:` 定义都能在 `styles.css` 找到同名定义（零新造令牌）；`styles.css` 里不含 `atlas` 字样。
- 配色与形态：`--bg:#EFF2F4` · `--text:#14202A` · `--accent:#1D6B66`（青灰绿，单一强调色）· `--accent-ink:#F3F9F8` · `--line:#C7D2DA` · `--border-2:#AEBBC5` · `--surface:#E7ECF0` · `--surface-2:#DFE6EB` · `--surface-3:#F6F8FA` · `--shadow-tint:#22303C`（冷调投影）· 圆角 2/4/6/10px（比基线 3/6/12/18 更紧）· `--reader-poster-opacity:.18`。明暗与色温上都与既有 11 套（暖纸 editorial/classic/paper、黑白 minimal、蓝灰 simple、深色 modern/cyber/aurora、gallery）区分得开。
- 视觉验证：**旧 11 套 22 张截图 tol=0 全零差异**——`node scripts/ui-shot.mjs --shots scripts/ui-shots-themes.json --out .tmp/theme-before --dsf 2 --profile theme-before`（22 shots，0 failed）→ 实现 S4 → 构建 → 同参数截到 `.tmp/theme-after`（24 shots，0 failed）→ `node scripts/ui-diff.mjs .tmp/theme-before .tmp/theme-after --tol 0` ⇒ `{"pairs":22,"zeroDiff":22,"changed":0,"mismatches":0}`（新增的两格 atlas 不在配对集合内）。atlas 首页与我的文化索引截图人工签收：冷灰纸感底、青灰绿单一强调色、更紧圆角、序号块与按钮形态清晰可辨。另外把一次性脚本的夹具注入加上 `--theme atlas`，在 atlas（浅色）下走了一遍 `/depth` 与 `/encounter`：名次点阵条、四格指标卡、置信徽章、13 行旧指标栅格都清晰可读，数字与深色主题下逐项一致（73.4 / 89 / 91 / 80.6–100 / 36–36）。
- 门禁：check ✅ ｜ lint ✅ 0 problems ｜ format:check ✅ ｜ test ✅ Test Files **61 passed / 1 skipped (62)**、Tests **841 passed / 9 skipped (850)**、Duration 36.75 s（S3 基线 60/1、828/9 ⇒ +1 文件 +13 测试）｜ build ✅ 2.78 s（`dist/assets/index-CMFDQVpa.js` **427.20 kB** / gzip 142.83 kB；`index-D5u72a2J.css` **156.46 kB** / gzip 28.21 kB；`DepthCompareView-_vRkykLI.js` 14.76 kB）。
- 线上验证（提交 `2d4570c`，已 push `d99fad5..2d4570c`；传播约 1 分钟，第 4 次轮询切换）：
  - 首页引用 `assets/index-CMFDQVpa.js`（427196 B，SHA256 `5F15422C65A2A9F67DD597479DBA02DF4296A45893316FF99E2EA7ED72B575CD`）与本地**逐字节一致**；`assets/index-D5u72a2J.css`（156456 B，SHA256 `32E6666EF4DAC9D84468BE6380AD948894698E3CBBF4CFBAE254665E105B6711`）一致，且**线上 CSS 内确实含 `[data-theme=atlas]` 与 `.theme-dot.theme-atlas`**；懒加载分包 `assets/DepthCompareView-_vRkykLI.js`（14760 B，SHA256 `E6B09F97C1A8695195A36BFAE86F178B2970653E077972EA65F5659909615D3A`）一致。
  - `/depth` 与 `/encounter` 带 `Accept: text/html` 均 200（SPA 外壳）；`/api/health` 200（D1 ok）。
  - 真实浏览器线上抽检：把主题注入设为 `atlas` 后打开线上 `/depth` 与 `/encounter`，浅色主题渲染正常（青灰绿强调色、名次点阵条、四格指标卡、13 行旧指标栅格均清晰），且**线上截图的 SHA256 与本地同款截图逐字节相同**（`.tmp/live-atlas/depth-desktop-1300x900.png` = `7cdc2f7c6921c31b2fd7b27d0ccdd55a6f6dfc14306d611920266e393d0222e9`）⇒ 线上主题与本地一致。
- ⇒ **S4 全部完成**；本计划只剩 **S5（可缓）无障碍纯追加修补**与一条工具增量（`ui-shot.mjs` 多步 steps）。

### S5 执行记录（2026-10-18）

> 本阶段只做「纯追加」：给现有元素**追加** `aria-label` / `role` / 键盘监听，不删节点、不改布局、不改文案。每一项都必须配 `ui-diff --tol 0` 的零差异证据，不达标即回退该项。

**第 2 批（S5-2，2026-10-24 `388d10a`，已完成）：ProfileView / PlazaPostView / FocusTrap 五项 + 死代码清理**

- rename 输入 `aria-label`、WorkEditor 两表单 `htmlFor/id`、rank 菜单 Escape、点赞 `aria-pressed`+在途防连点、FocusTrap 卸载焦点归还（三处弹窗受益）；顺带清掉 `.theme-menu-sep` / `.identity` 媒体段死规则 / `plaza-search` 死类，`theme-simple` 色点对齐实际 accent。41 张关闭态截图 tol=0 全零差异（一批合验——五项均为属性/行为级，DOM 结构零变化；此为对「一次一项」协议的记录在案的执行偏差）。**S5 纯追加类至此全部完成**，仅剩触控目标类（改视觉，按台账 T-20261017-01 下一步第 1 条的手法优先级单独评估）。

**第 1 项（已完成并线上验证）：比较页 / 广场页的 ARIA 语义补全**

- 改动（全部为属性级追加；`.tmp/a11y-shots.json` 临时截图清单覆盖 `/encounter`、`/plaza` × 桌面 1300×900 / 移动 540×960，夹具 = `demo-profile` + 程序化错位同源对方画像写入 `art-rank:peer:v2`）：
  1. `src/views/CompareView.tsx`：比较模式、比较深度两个 `.segmented` 容器补 `role="tablist"` 与组名 `aria-label`（原先只有子按钮带 `role="tab"`，缺父级 tablist，与同文件另一处 `.segmented`（比较维度）已有 tablist 的写法不一致）。
  2. `src/views/CompareView.tsx`：手动模式下「我的索引 / 对方索引」两处清单 checkbox 补 `aria-label`（维度 · 清单名），此前它们没有任何可访问名称。
  3. `src/views/PlazaView.tsx`：维度筛选补 `role="tablist"` + 组名；排序组因为同一容器里还放着搜索框，改用一层 `role="tablist"` + `display:contents` 的包装层（结构上补父级、布局上不参与，实测像素零差异）。
  4. 新增 `src/a11y.test.ts`（6 项源码绊线：tablist 数量与组名、两个 checkbox 都有名称、tab 数量不少于 tablist（无孤儿 tab）、包装层 `display:contents` 且搜索框在其后、搜索框自身名称未被改动）。
- 零差异证据：`node scripts/ui-shot.mjs --shots .tmp/a11y-shots.json --out .tmp/a11y-before/--after --dsf 2`（各 4 张、0 failed）→ `node scripts/ui-diff.mjs .tmp/a11y-before .tmp/a11y-after --tol 0` ⇒ **pairs 4 / zeroDiff 4 / changed 0 / mismatches 0**（含两处桌面与两处移动，`diffPixels 0 / maxDelta 0`）⇒ 这一批改动不可见。
- 门禁：`check` ✅ ｜ `lint` ✅ 0 problems ｜ `format:check` ✅ ｜ `test` ✅ Test Files **62 passed / 1 skipped (63)**、Tests **847 passed / 9 skipped (856)**（S4 基线 61/1、841/9 ⇒ +1 文件 +6 测试）｜ `build` ✅ 3.11 s。
- 线上验证（提交 `79a84ff`，已 push `e184c3d..79a84ff`；本次传播极快，首次轮询即为新包）：首页引用 `assets/index-Cq219VaK.js`（427196 B，SHA256 `CD50A597795FAFF678EBD0672390F09F7CF039CA8C2335FD29257CE2581FC395`）与本地**逐字节一致**；`/encounter`、`/plaza`、`/depth` 带 `Accept: text/html` 均 **200**；`/api/health` 200（D1 ok）。

**复核结论：ROADMAP §二 P2 的 A/B 清单里有一批条目已经过期（先前批次已修），开工前必须先核**（PITFALLS 4.31）：
- 已过期（无需再做）：`ArtworkDetail` 的 Escape / 焦点陷阱与归还（已由 `FocusTrap` 承担，`onEscape` 已接）、`<audio>` 已有 `aria-label`、`ranking-card-poster` 类点击目标已有 `role="button" + tabIndex + Enter/Space` 处理、全局 `IconButton` 早已带 `aria-label`。
- **仍待办（后续逐项做，均须过零差异闸门）**：`ProfileView` 的 rename 输入缺可访问名称、WorkEditor 的 `<label>` 与输入未用 `htmlFor/id` 关联、rank 菜单缺 Escape 关闭；`PlazaView` 整卡 `role="button"` 内嵌真实 `<button>`（嵌套交互）；`PlazaPostView` 点赞按钮缺 `aria-pressed` 与 busy 防连点；`CompareView` 对端导入输入 38px 与 busy 只显示「…」、`.comparison-row` 内嵌可点击 `span` 的嵌套交互；触控目标（`ProfileView` 28px 按钮、`PlazaPostView` 回复框 33px、`AiInsightCard` 徽章与复制按钮）——**其中「恢复 44px / 放大命中区」会改变视觉，必须单独评估：若 `ui-diff --tol 0` 不为零则该项回退或改用透明命中区扩大的纯追加手法**。
- 计划里的 C（token 化内联样式）与 D（CompareView 结构重排）**不在 S5 范围**（必然改旧 DOM）。

### 性能优化记录（2026-10-18，S5 之后）

- 背景：S2 的实测已显示自适应模式在 300 件清单下每次取舍约 20 ms。细粒度基准把耗时拆开后定位到 **`selectAdaptivePair` 单次 17.21 ms（占一次取舍的 85%）**：原实现为「每一对都 `push` 一个候选对象 → 整体 `sort`」，300 件 ≈ 4.5 万个对象 + O(N²log N) 排序；`buildAdaptiveModel`（0.57 ms）与池/观测构造（0.01 ms）都不是瓶颈。
- 改法（`src/lib/adaptiveQueue.ts`，**行为不变的纯实现优化**）：一遍扫描 + 只为三级（无冷却 / 放宽作品冷却 / 放宽序对冷却）各保留当前最优；模型与对手计数只读一次（`Float64Array`），内层循环零分配；比较判据与并列顺序（score ↓ → information ↓ → coverage ↓ → leftId|rightId ↑）与冷却放宽阶梯逐字不变；顺带删掉优化后不再使用的私有 helper（`thetaOf` / `compareCandidates`）。
- 等价性证据（**golden 指纹逐字相同**，优化前后各跑一次同一脚本）：N=12/60 步 `b3c89829af197937b2b4e4b8c663366b`、N=40/120 步 `c2a4e5b8f0a7955f04f7310bbdb734eb`、N=120/200 步 `421da68365f5668520c62b81a369f011`、N=300/200 步 `3efe70ce3a922ebbe378ce251426c971`；既有单测（`adaptiveQueue.test.ts` 10 + `adaptiveRanking.test.ts` 17 + `additiveModules.test.ts` 8）保持全绿。
- 收益（300 件，同机同脚本）：**一次取舍 20.26 ms → 9.74 ms（2.08×）**；`selectAdaptivePair` 17.21 → 5.22 ms（3.30×）；`scheduleAdaptiveCandidate` 20.21 → 9.27 ms（2.18×）。UI 渲染代码一行未动（选择结果不变 ⇒ 界面上出现的对子与优化前完全一致）。
- 门禁：`check` ✅ ｜ `lint` ✅ 0 problems ｜ `format:check` ✅ ｜ `test` ✅ Test Files **62 passed / 1 skipped (63)**、Tests **847 passed / 9 skipped (856)** ｜ `build` ✅ 2.80 s。
- 线上验证（提交 `d47bd98`）：首页引用 `assets/index-CH_gZlVY.js`（427360 B，SHA256 `1BAABCE4E938D07B919E321615DFDB238C40567822FFE71DDC08A457341EF4A9`）与本地**逐字节一致**；`/encounter`、`/plaza`、`/depth`、`/catalog/sorting` 带 `Accept: text/html` 均 200；`/api/health` 200（D1 ok）。
- 未做的进一步优化（诚实登记）：`selectAdaptivePair` 仍是 O(N²) 全量扫描（5.22 ms @300 件），可用「上界剪枝」压到 O(N·k)，但任何剪枝都可能改变选中的对子 ⇒ 需先证明剪枝是精确的（不改变结果）再做；`getRankIntervals` 的 O(N²) 区间计算（≈1.9 ms/次）同属此类。
