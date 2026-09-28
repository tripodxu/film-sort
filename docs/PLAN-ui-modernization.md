# PLAN-ui-modernization — 前端 UI 现代化方案（v3 组件级差异版）

> 状态：**待评审 v3**（2026-09-28）。
> v2 → v3 关键变更（用户拍板）：**不是简单换色——每个新主题在组件形态与视觉上必须「一眼可辨地不同」**。
> 本计划遵守 `docs/agents/CONVENTIONS.md` §6 视觉改动流程：token 化、截图基线、五道门禁、线上验证。

---

## 0. 总原则（已定，逐版累积）

1. **只增不改**：modern 默认 + 旧 6 内置主题零像素改动；新主题全部增量落地。
2. **三方向全做**：`editorial` / `editorial-dark`、`aurora`、`gallery` 四组新内置主题。
3. **组件级差异是验收标准（v3 新增）**：每个新主题必须改造 ≥6 个核心组件的**形态/布局/结构**，换色不计入。验收时用截图肉眼比对 + §2 差异矩阵逐格核对，「说不出哪里不一样」即不通过。

---

## 1. 差异化机制：三层能力

`THEME-PACKS.md` §8 已声明：变量包只能换色。组件级差异需要内置主题的三层机制（paper/retro 已有前两层先例，第三层是本次新增）：

| 层 | 机制 | 能做什么 | 先例 |
|----|------|---------|------|
| L1 变量 | `[data-theme=x]{ --var }` | 色板/字体/圆角/时长 | 全部旧主题 |
| L2 结构覆写 | `[data-theme=x] .component { ... }` | 改布局、增删装饰、换控件形态（方↔圆、玻璃↔哑光、列表↔卡片） | paper 关玻璃、retro 改圆角字距 |
| L3 条件渲染（新增） | `useTheme()` hook → TSX 分支 | **改 DOM 结构**：海报堆叠、Bento 网格、回合水印、卡片翻转 | 本次新增，~20 行 |

```ts
// src/lib/useTheme.ts（新增）：订阅既有 art-rank:theme-changed 事件
export function useTheme(): string {
  const [t, setT] = useState(readTheme);
  useEffect(() => {
    const on = () => setT(readTheme());
    window.addEventListener("art-rank:theme-changed", on);
    return () => window.removeEventListener("art-rank:theme-changed", on);
  }, []);
  return t;
}
```

**铁律**：L3 分支的默认路径必须是现有 DOM——旧主题渲染结果一字节不变，用旧主题 zero-diff 截图兜底。

---

## 2. 组件级差异矩阵（验收基准）

> 每格是该主题下组件的**形态定义**。「—」= 沿用通用样式（仅变量不同）。核心组件共 12 个，每主题须 ≥6 格非「—」。

### 2.1 `editorial` / `editorial-dark` · 刊物画廊（差异组件 9 个）

| 组件 | 形态定义 |
|------|---------|
| 首页 hero | **DOM 重构（L3）**：左文右图杂志封面式；3–5 张收藏海报错落堆叠（绝对定位 ±6° 旋转，空态色块），悬停展开；eyebrow 改「ISSUE 01 —」期号；**orb 隐藏** |
| 标题体系 | h1/h2 衬线（Georgia→Songti SC 链）+ 字重 600；巨型序号（80px 衬线数字）作区块装饰 |
| topbar | 去下划线导航，active 项改「序号前缀」样式（01 排序 / 02 画像）；底部通栏细线 |
| 按钮 | 全圆角 pill；primary 实色深底浅字（editorial）/ 亮底深字（dark），无玻璃无描边 |
| duel 卡（排序页） | 去卡片化：海报直接铺底 + 底部衬线标题排印；落败卡透明度沉降；**「第 N 回合」巨型衬线水印**（L3 注入，z-index 垫底） |
| 进度 | `.progress-track` 视觉改为「页码 12 / 48」+ 细线刻度（保留原 DOM 与无障碍语义，L2 覆写） |
| 榜单（ranking-list） | 行式排印：巨型衬线排名 + 标题 + 细线分隔，去卡片边框与阴影 |
| 画像维度条 | 「坐标纸」质感：细网格背景 + 针脚刻度线，数值用衬线 |
| 弹窗 | 直角（--r-* 全 0）、2px 实线边框、无玻璃 backdrop，像杂志跨页 |

### 2.2 `aurora` · 极光质感（差异组件 7 个）

| 组件 | 形态定义 |
|------|---------|
| 首页 orb | **新特效「极光绸带」**（orb 注册表接入）：多层贝塞尔绸带 + 柔光粒子，plasma/halo 之外第三选择；aurora 主题默认启用 |
| 表面体系 | 玻璃 2.0：surface 三层改为「底 + 1px 内高光 + 外柔光晕」三层叠加（L2，box-shadow 多层 token 化） |
| topbar | 悬浮胶囊导航：脱离子页面顶线，圆角胶囊浮于内容上，滚动时半透明加深 |
| duel 卡 | 胜出瞬间辉光脉冲（accent 色 box-shadow 呼吸，reduced-motion 下跳过）；卡角加大到 --r-lg |
| 按钮 | 渐变描边（conic 描边动画，hover 流转）+ 内发光；primary 带柔光投影 |
| 弹窗/菜单 | 更深景深：scrim 加重 + 弹窗浮起高度分级（--ev-1/2 重写） |
| 进度/维度条 | 流光填充：渐变条 + 微光头部（reduced-motion 退化为纯色） |

### 2.3 `gallery` · 数据画廊（差异组件 8 个）

| 组件 | 形态定义 |
|------|---------|
| 画像页布局 | **DOM 重构（L3）**：Bento 网格——Top1 大卡（2×2）+ 维度雷达 + 年代分布 + 口味坐标 + 榜单入口，grid-area 编排，移动端单列堆叠 |
| 维度可视化 | **雷达图**（手写 SVG 多边形，数据取现有 profile 结构，零数据层改动） |
| 年代/来源分布 | 横向堆叠条 + 刻度，挂维度色 |
| 榜单 | **卡片墙（L3）**：海报正面 / 短评背面，hover 或点击 3D 翻转（reduced-motion 平铺展开） |
| 分享卡片 | 重设计（L3）：Bento 缩略版导出图，二维码融入网格而非贴角 |
| 广场 sticker | 拍立得形态：白边 + 底部手写体标题区 + 微旋转，hover 立起 |
| topbar | 居中 Logo + 两侧导航的对称报刊亭式（L2） |
| 弹窗 | 圆角加大（--r-lg=24）+ 无边框纯阴影，与 editorial 直角两极 |

---

## 3. 分阶段计划

### P0 · 基线与共享基建（0.5 天）

- [ ] `scripts/ui-shot.mjs` 全量截图，确认 `docs/ui-baseline.json` 可信（**推迟到 P1 开工前**——P0 无视觉变化，新代币无人引用，旧主题渲染必然一致）
- [x] `src/lib/useTheme.ts`（L3 能力）+ 单测（`themeFamily` 分类 ×4 例；hook 本体走浏览器 smoke，同 themeRegistry 测试边界约定）
- [x] 动效代币 `--ease-settle:cubic-bezier(.2,.9,.3,1.2)` / `--dur-stagger:60ms`（:root 定义，旧主题不引用）。
  ⚠️ **命名修正**：不得使用 `cubic-bezier(.34,1.56,.64,1)`——2026-09-22 UI 焕新已将其定为「玩具感」元凶并设绊线测试（`src/ui-fixes.test.ts`），settle 是更收敛的 1.2 过冲，仅用于入场编排，禁用于 poster hover
- [x] `src/lib/auraColor.ts` 海报取色 → `--aura`（像素数学纯函数 ×7 例单测；CORS/跨域在浏览器 smoke 验收，失败降级维度色）

**验收**：五道门禁绿；旧主题 zero-diff；无视觉变化。

### P1 · editorial / editorial-dark（2 天）—— 本地完成 ⏸，线上验证留 P4

按 §2.1 矩阵落地 9 个差异组件。L3 分支：HomeView hero、duel 水印；其余 L2 覆写 + 变量块。

- [x] 变量块 ×2（21 必需 + 对比度底线）；`theme.ts` 注册；玻璃关闭（paper 先例）
- [x] 移动端：海报堆叠 → 单张轮播（scroll-snap 零 JS）；水印字号降级
- [x] `ui-diff`：旧 7 主题 zero-diff（14/14 张 tol=0）；editorial 双主题进 `scripts/ui-shots-themes.json` 归档
- [x]~ 衬线回退链：Windows 实测通过（Georgia→SimSun 段生效）；**macOS 段（Songti SC/STSong）无设备未测**——留 P4 线上验证

**执行偏差（相对 §2.1 矩阵，均已截图确认）**：

1. **弹窗直角未走 `--r-*` 全 0**：矩阵写「直角（--r-* 全 0）」，实际为弹窗/菜单/toast 显式 `border-radius:0` + 2px 实线框，`--r-*` 保留 2/3/4/6px 小圆角给其余组件——`--r-*` 归零会让海报卡、dim-chip 等全部剃刀化，超出「杂志跨页」的意图范围。
2. **两处特异性陷阱（实测踩到并修复，均有 ui-diff 证据 + 绊线测试）**：
   - 桌面 `.ed-stack-item:nth-child(N)` 定位（0,2,0）压过移动端同名类覆写（0,1,0）——媒体查询不加特异性。修复：`.ed-hero-inner .ed-stack-item:nth-child(n)` 抬到 (0,3,0)（hover 扩散 (0,4,0) 同分后来者胜）。修复前实测泄漏：rotate(-6deg) 倾斜、left:108px 推右成 127px 巨间隙、top:26px 错位；修复后顶边斜率 0.05°、三卡直立。
   - 基座 `.orb-hero-inner` 的 `grid-template-columns` 在样式表 L846（移动端媒体查询**之后**），同名类后来者胜——`.ed-hero-inner` 单类单列覆写是死代码，mobile 实际跑双轨 + 48px column-gap（盒模型 dump 实测轮播容器 438 = 486−48）。修复：双类 `.ed-hero-inner.ed-hero-inner` 抬到 (0,2,0)；修复后容器 486 满宽，card3 可见宽度 84→132px。
3. **移动端轮播差异说明**：home-540 双主题截图相对修复前基线变化 ~2.4% 像素，全部位于轮播容器右缘 48px 条带（card3 右半 newly visible）+ 标题细线端点随标题轨宽 438→475 外延；标题文字、桌面 6 图、移动端 sorting 均 0 diff。

**验证状态**：五道门禁绿 ｜ 旧 7 主题 14 张 zero-diff ｜ editorial 8 张截图肉眼 + 盒模型 dump 签收 ｜ **线上 ⬜（P4）**。
> 测试数波动说明：本环境 vitest 偶发漏收集 `worker/ai.test.ts`（44 例）与 `src/content-intro.test.ts`（9 例，live-API 门控默认跳过）——单独跑均通过，判定为 WorkBuddy fs 代理的 glob 竞态，非代码回归。

### P2 · aurora（1.5 天）—— 本地完成 ⏸，线上验证留 P4

按 §2.2 矩阵落地 7 个差异组件。

- [x] 变量块 + 玻璃 2.0 三层表面（阴影 token 化，不落裸值）
- [x] `src/lib/orbEffects/ribbon.ts` 极光绸带（遵守 ORB-EFFECTS §4 契约 + §6 验收清单全过）
- [x] 胶囊导航注意 PITFALLS 4.7（overflow 裁切）与 4.8（nth-child）
- [x] aurora 主题默认 orb = ribbon（注册表支持按主题推荐默认，不动既有持久化逻辑）

**落地明细**（对应 §2.2 七组件）：① 首页 orb = ribbon（柔光基座 + 4 绸带 + 600 粒子，`RECOMMENDED_BY_THEME={aurora:"ribbon"}`，持久化优先逻辑不变）；② 玻璃 2.0 三层（ev 投影 + accent-2 内高光 + accent 外柔光）；③ topbar 悬浮胶囊（sticky + 滚动加深 + active 胶囊底，≤540px 降级纯文字链接）；④ duel 胜出辉光脉冲（`:active` 触发 `au-win-pulse`，reduced-motion 全局禁令兜底）+ 卡角 `--r-lg`；⑤ 按钮 conic 渐变描边（`@property --au-angle` 注册后 keyframes 可动画）+ primary 柔光投影；⑥ 弹窗/菜单 `--ev-*` 重写 + scrim blur(14px)；⑦ 进度/维度条流光填充（`au-flow` 扫光，reduced-motion 退化纯色）。

**执行偏差记录**：
1. **`--ev-1/2/3` 全局缺失**：三 token 自 `7fb1d5c`（P1b-3）起被 ~20 处引用但从未在任何地方定义（全部解析为 `box-shadow:none`；P1 zero-diff 基线即在此状态产出）。全局补定义会点亮全部旧主题阴影、破坏 zero-diff，故**只在 aurora 块内补定义**（本主题正需更深景深），并用绊线 `--ev-2:` 全文仅 1 处定义看守。旧主题补齐须另立基线，留 P4。
2. **`.medium-item` 不入玻璃 2.0**：P0.7 起它是透明扁平目录行，加投影会变成悬浮矩形板、与设计意图相悖，故玻璃 2.0 只覆写 identity/home-actions/segmented。
3. **移动端胶囊降级**：≤540px 时 nav 去底板仅留文字链接（PITFALLS 4.7 overflow 裁切规避），桌面 999px 胶囊不受影响。

**验证状态**：五道门禁绿（check/lint/format:check/test 456 passed·9 skipped/build）｜ 旧 7 主题 14 张 + editorial 系 4 张 **zero-diff**（stash 基线法，tol=0）｜ aurora 截图肉眼签收（首页桌面/移动、duel 双卡 + 进度流光、辉光脉冲按住中段实锤）｜ **§6 验收六项全过**（CDP 探针脚本化：切换 4 轮 canvases 恒 1 无 contextlost；retro/minimal/paper  palette 色相跟随；reduced-motion 双截图逐字节一致且画面不消失；跨 700px 断点桌面右偏 0.68/移动居中；localStorage 持久化；移动 0.88 缩放）｜ ui-contrast aurora 全对 ≥4.5（最差 7.8:1）｜ **线上 ⬜（P4）**。
> 头无 WebGL 说明：`ui-shot.mjs` 显式 `--disable-webgl`，工具链截图无 orb 是环境限制（modern 基线同样无）；ribbon 实渲染由 CDP 探针（SwiftShader 软渲 WebGL）+ 截图双重确认。

### P3 · gallery（2 天）

按 §2.3 矩阵落地 8 个差异组件，重点是画像页 Bento 重构。

- [ ] `ProfileView` L3 分支：Bento 网格 + 雷达图 SVG + 分布条
- [ ] 榜单卡片墙翻转（transform-style: preserve-3d；注意 4.11 通用选择器误伤 poster）
- [ ] 分享卡片/导出图重设计（ShareView 分支，二维码入网格）
- [ ] 广场 sticker 拍立得化（L2 即可）
- [ ] Bento 网格必须显式 `display:grid`（PITFALLS 4.12）

### P4 · 收尾与回归（0.5 天）

- [ ] 全主题（7 旧 + 4 新）× 全路由截图回归；**差异矩阵逐格核对**（本计划 §2）
- [ ] `ui-contrast.mjs` 过；主题菜单分组（经典 / 新系列）
- [ ] 文档同步：README / FEATURES / USAGE / CHANGELOG / THEME-PACKS（7 → 11）
- [ ] **sort.logicc.top 线上实机验证后才标 ✅**

---

## 4. 硬约束自查表（每个 P 都要过）

| 约束 | 来源 |
|------|------|
| 新色必须 token 化，禁裸 hex | CONVENTIONS §6 |
| 改前后跑 `ui-shot` + `ui-diff`，构建期间禁止截图 | PITFALLS 4.1 |
| 旧主题 zero-diff（L3 默认路径 = 现有 DOM） | 本计划 §0/§1 |
| **新主题 ≥6 组件形态差异，截图肉眼可辨** | 本计划 §0.3（v3） |
| reduced-motion：辉光/翻转/堆叠展开全部有降级 | PITFALLS 4.16 |
| WCAG AA：text ≥ 7:1 / accent-ink ≥ 4.5:1 | THEME-PACKS §5 |
| overflow / nth-child / grid 显式声明 / poster 误伤 | PITFALLS 4.7/4.8/4.11/4.12 |
| 海报 URL 不进 items；aura 只读代理后图像 | AGENTS.md 硬规则 4 |
| 不引 webfont / 图表库 / 动效库（CSP + SW 离线） | 部署约束 |

## 5. 明确不做

- 不改旧 7 主题任何像素；不扩自定义主题包变量白名单（新主题全内置）
- 不动 Worker / 数据层 / 排序算法；雷达图数据只用现有 profile 字段
- 不引新依赖（雷达手写 SVG、翻转 transform 3d、弹簧 cubic-bezier 近似）

## 6. 风险

| 风险 | 缓解 |
|------|------|
| L3 条件渲染引入回归 | 默认路径 = 现有 DOM；旧主题 zero-diff 截图兜底；useTheme 单测 |
| canvas 取色跨域失败 | 降级维度色，aura 缺失不阻塞 |
| 衬线中文观感差 | 仅标题/序号衬线；双平台实测 |
| 主题 7 → 11 菜单拥挤 | 菜单分组：经典 / 新系列 |
| Bento 在小屏挤压 | grid-area 移动端单列堆叠，800/540 断点逐个过 |

## 7. 变更记录

- **v3.2（2026-09-28，P1 执行完毕）**：落地 editorial/editorial-dark 双主题（§2.1 九差异组件全做）；实测踩到两处 CSS 特异性陷阱并修复（移动端 ed-stack 桌面定位泄漏、单列网格覆写被基座后来者胜），各配绊线测试；旧 7 主题 14 张截图 zero-diff 实证 L3 默认路径零回归；记录三处执行偏差（弹窗直角走显式 radius:0 而非 `--r-*` 归零、macOS 衬线段未测、移动端轮播差异范围）。线上验证按计划留 P4。
- **v3.1（2026-09-28，P0 执行中修正）**：`--ease-spring` 改名 `--ease-settle`（1.2 过冲）——`cubic-bezier(.34,1.56,.64,1)` 是 2026-09-22 焕新定死的「玩具感元凶」，有绊线测试看守（`src/ui-fixes.test.ts`）；auraColor 增加「胜出桶须甩开第二名 1.5×」margin 守卫，避免双色海报掷硬币。
- **v3（2026-09-28）**：用户拍板「不是简单换色，要组件级可感知差异」→ 新增三层差异化机制（L3 useTheme 条件渲染）、§2 组件级差异矩阵（12 组件 × 4 主题，每主题 ≥6 差异组件）、「肉眼可辨」纳入验收。
- **v2（2026-09-28）**：三方向全做、增量多主题、不改老 UI。
- **v1（2026-09-28）**：初版。
