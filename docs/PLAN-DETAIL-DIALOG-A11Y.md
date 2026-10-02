# PLAN-DETAIL-DIALOG-A11Y

> 迭代 11/20 · **前端类** · ROADMAP §二 P2 待办池 A13 / A12 / E1 三项合并
> 题源：`docs/ROADMAP.md:101`（`ArtworkDetail.tsx` 无 Escape / 无焦点陷阱）、`:102`（`<audio>` 无 accessible label）、`:142`（`<dl>` 直接打印 API 键名）。
> 由用户 m05616「继续，做到优化轮次停止」排到本轮（轮换位：10 优化 → 11 前端）。

## §0 题眼

台账 P1 是「浏览器 E2E 缺口」。本轮浏览器**依然不可用**（`npx playwright --version` 有，
但真正要用的 chromium 走的是 `$env:LOCALAPPDATA\ms-playwright`，本机只有
`chromium_headless_shell-1223` 的残留目录，无可执行文件）。⇒ 那件事仍留红。

但 P2 待办池里**有一组三项相邻的缺陷，全部落在作品详情弹窗**——`ArtworkDetail.tsx`。
它是全站**唯一一个**用 `role="dialog"` + `aria-modal="true"` 却没有焦点管理的弹窗，
也是唯一一个把后端 API 键名直接印给人看的界面。**同一个文件、同一处交互、同一类缺陷**，
合并成一轮，正好符合「一次执行一种」。

## §1 事实表（2026-10-02 线上实测 + 源码）

| # | 事实 | 证据 |
|---|---|---|
| F-1 | 全站已有 `FocusTrap` 组件（Escape + Tab 循环 + 首焦点），被 `App.tsx:2278`（guide）、`AiConfigDialog.tsx:166`、`ThemeImportDialog.tsx:108` 使用 | 源码 |
| F-2 | `ArtworkDetail.tsx:120-128` 的 `<section role="dialog" aria-modal="true">` **不在任何 `FocusTrap` 里** | 源码 |
| F-3 | 它的关闭方式只有两处：点背景（`:121 onClick={onClose}`）与点右上角 `IconButton`（`:136`）。**Esc 无效** | 源码 + 实测 |
| F-4 | `ArtworkDetail.tsx:179` `{playUrl && <audio controls autoPlay src={playUrl} />}` **无任何可访问名称** | 源码 |
| F-5 | `ArtworkDetail.tsx:230-251` 的 `<dl>` 直接 `Object.entries(detail.data)` 渲染，`<dt>{key}</dt>` 打印**后端键名** | 源码 |
| F-6 | **实测**：`other` 类弹窗印出 `id`（44 字符 percent-encoded 内部键 `wiki-zh-%E9%A3%8E%E4%B9%8B%E6%97%85%E4%BA%BA`）、`poster_url`（**150 字符裸 URL**）、`detail_url`（66 字符 URL） | `.tmp/dl11.mjs` |
| F-7 | **实测**：`book` 类印出 `author_intro`（**389 字符作者生平**）挤在一行 `<dt>`/`<dd>` 里，与 `作者`/`译者`/`校注` 混排 | 同上 |
| F-8 | **实测**：`movie` 类印 `year/type/country/duration/actors` —— 全是**英文键名**，英文界面下中文值配英文标签尚可，**中文界面下就是一片 `year: 2025`** | 同上 |
| F-9 | **实测**：`music` 类印 `matchedTitle` —— 这是一个纯内部字段（匹配后的标题），对人**零价值** | 同上 |
| F-10 | `.slice(0, 8)` 截断存在，但**顺序是响应 JSON 的插入序** ⇒ 用户看到的 8 行取决于后端字段顺序，不稳定 | 源码 |
| F-11 | 已知键集合**分散且不完整**：`rating`/`imgs` 等在 `SKIP` 里，但 `poster_url`/`id`/`detail_url`/`matchedTitle`/`author_intro` 都不在 | 源码 |
| F-12 | `IconButton` 只传 `title`（`:136`）⇒ F-6 §一 P2 全局项：触屏与部分 AT 上 `title` 不可见 | 源码 |

## §2 根因

**弹窗没有「它是一个模态」的自我认知。** `role="dialog"` + `aria-modal="true"`
是写给 AT 的一行**声明**，声明本身不产生任何行为：焦点仍留在打开它的那个按钮上，
Tab 会走到弹窗背后的页面元素去，读屏用户按 Esc 什么也不会发生。
`FocusTrap` 已经把该做的三件事（Esc / Tab 循环 / 首焦点）都实现了，
这个弹窗只是**没接**——`ArtworkDetail` 是全站唯一漏接的。

`<dl>` 那条是另一回事：**「后端返回了什么」被当成了「界面该显示什么」。**
API 是给程序读的，它有内部键（`id`、`matchedTitle`）、有 URL（`poster_url`、`detail_url`）、
有长文本（`author_intro`）；界面需要的是**人能读懂的几个字段**。
中间缺一层「哪些字段值得给人看、叫什么名字、长文本放哪」的翻译。
`.slice(0, 8)` 是在这层缺失上打的补丁——用一个数字掩盖「没选过」。

## §3 方案

### 3.1 焦点与键盘（接 `FocusTrap`，零新组件）

```tsx
import { FocusTrap } from "./FocusTrap";
…
<FocusTrap onEscape={onClose}>
  <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-heading" …>
```

`FocusTrap` 的首焦点选择器命中的是第一个可聚焦元素——本弹窗里是右上角的关闭按钮
（`:136`，在 `.detail-body` 之前），这正是期望行为：**Esc 能关、Tab 出不去、焦点有落点**。

⚠️ **不自己写一遍**：仓里已有实现（F-1），复制第二份会让三处行为开始漂移。

### 3.2 字段翻译层：抽成纯函数放 `src/lib/`

新建 `src/lib/detailFields.ts`（纯函数，可测）：

```ts
export interface DetailField { label: string; value: string; long?: boolean }
export function detailFields(data: Record<string, unknown> | null, t: (zh: string, en: string) => string): DetailField[]
```

规则（按优先级，不是按响应顺序）：

1. **白名单 + 中文名**，覆盖四类实测键：
   `director`/`actors`/`type`/`country`/`duration`/`press`/`author`/`date`/`artist`/`album`/`year`。
   已知键走 `t()` 字典，**未知键保底**（照原样印，不丢信息——ROADMAP E1 原文如此）。
2. **内部键永不显示**：`id` / `matchedTitle` / `poster_url` / `detail_url` /
   `pic` / `imgs` / `content_intro` / `content_source` / `rating`。
   `poster_url` 与 `detail_url` 已在别处呈现（海报本身、`other` 的「查看来源」），重复印无价值。
3. **长文本单独成段**：像 `author_intro`（389 字符）标 `long: true`，
   渲染时**不进 `<dl>`**，走详情页已有的 `.detail-synopsis` 那类块（见 3.3）。
4. **上限从 8 改成「白名单优先 + 长文本不占名额」**，所以不再是 `.slice(0, 8)` 那种
   「按响应顺序截断」的不稳定行为。

### 3.3 渲染分层

- 短字段 → `<dl>`（保持现有结构与类名，**不加 CSS**）。
- `long` 字段 → 复用 `.detail-synopsis` 的排版（`<h3>` + `<p>`），挂在 `<dl>` **之后**。
- `t()` 键数：白名单每键一对中英文，**零新增 i18n 基础设施**（沿用现有 `(zh, en)` 约定）。

### 3.4 `<audio>` 补可访问名称

```tsx
<audio controls autoPlay src={playUrl} aria-label={t("歌曲试听", "Audio preview")} />
```
一句话，但它把「一个没有名字的原生控件」变成有名字的控件（F-4）。

### 3.5 范围账（不做）

- 不改 `IconButton`（F-12 是**全局**项，影响 20+ 调用点 ⇒ 另一轮）。
- 不做焦点归还（`FocusTrap` 目前不还焦点）⇒ 那是**仓级**组件语义，改它影响 F-1 的三处已有调用点 ⇒ 另一轮，且本轮弹窗关闭后焦点回原按钮由 React 的 DOM 复用近似满足。
- 不动任何 API / 后端 / 样式表；`styles.css` **零改动**。
- 不给 `<dl>` 加 `aria-label`（F-8 的中英混杂在白名单后已自然消失）。

## §4 验收表

| # | 判据 | 状态 |
|---|---|---|
| A1 | 五道门禁全过，lint 保持 29 problems | ✅ `tsc -b` exit 0；lint **29 problems (0 errors, 29 warnings)** = 基线；format:check All matched files；vitest **701 passed \| 9 skipped (710)**（基线 674 ⇒ **+27**）；build 通过 |
| A2 | 红队 ≥3 次全红（删字面量） | ✅ **×4 全红**（R-1 摘 FocusTrap / R-2 摘 audio aria-label / R-3 表格改回 `Object.entries` / R-4 少一个内部键），逐条见 §9 |
| A3 | 线上 `/api/*/detail` 四类的 `data` 键全部被覆盖或明确排除 | ✅ 四类实测：`movie` 8 键（排除 3 / 翻译 5 / 保底 0）、`book` 20 键（排除 5 / 翻译 3 / 保底 12）、`music` 6 键（排除 4 / 翻译 2 / 保底 0）、`other` 7 键（排除 6 / 翻译 1 `year` / 保底 0）⇒ **「未翻译即未排除」的键为 0**；无键带着字面量 `null` 漏到界面 |
| A4 | 弹窗 Esc 可关、焦点不外泄 | ⚠️ **离线接线 ✅ / 浏览器行为 ❌ 留红**：`FocusTrap` 的 Esc 与 Tab 循环由 `src/components/FocusTrap.tsx:11,32` 实现且被另两处弹窗复用，但**本轮没有浏览器可验**（见 §6.1）⇒ 行为栏不标 ✅ |
| A5 | 主包字节数 ≤ +1 KB | ⚠️ **+1325 B 超出 1 KB 预算 325 B**，经复核判定**接受**：本轮新增 21 个纯函数用例 + 6 条接线绊线的主要体积在测试侧；前端净增 = 翻译层字典（11 键 × 中英）+ 内部键名单（9 键）+ 分组函数，1.3 KB 是这三者的真实成本，压到 1 KB 以内只能靠删词条，属「为数字删功能」。记录在 §8 |
| A6 | `styles.css` 与 `worker/`、`shared/` 零改动 | ✅ `git status --porcelain` 只有 3 改 2 新增，**无 `src/styles.css` / `worker/` / `shared/` 任何条目**；CSS 148114 B（148.11 kB）⇒ 长文本复用既有 `.detail-synopsis`，未新增一条规则 |
| A7 | 英文界面下 `<dt>` 全是英文词 | ⚠️ **离线可判部分 ✅ / 需界面渲染 ❌**：`.tmp/a3v11.mjs` 对线上四类响应跑了「已排除 / 翻译 / 保底」三分归类，`movie` 翻译 5 键、**保底 0** ⇒ 英文界面下这 5 行 `<dt>` 必为 `Director/Genre/Region/Runtime/Cast`；`book` 仍有 12 个保底键（`作者`/`译者`/`ISBN`/`定价`…），它们**本来就不是英文键名**（后端直接返回中文键），不是本轮引入的缺陷，**如实记录见 §8**；界面渲染仍需浏览器 ⇒ 该栏不标 ✅ |
| A8 | 白色三连（`id` / `poster_url` / `detail_url`）不再出现在界面任何位置 | ✅ 线上 `other` 实测键集 `id,title,year,poster_url,content_intro,content_source,detail_url` ⇒ 7 键里 6 键进 `INTERNAL_KEYS`，界面只剩 `year` 一行；`.tmp/a3v11.mjs` 对四类响应断言**没有键带着字面量 `null` 漏出**；线上 bundle 含 `matchedTitle`/`poster_url` 字面量属**名单字符串本身**（用于排除），不是渲染内容 |

## §5.2 红队 ×4（每次都删字面量）

| # | 变异 | 结果 |
|---|---|---|
| R-1 | `<FocusTrap onEscape={onClose}>` → `<div>`（摘掉接线） | ✅ **1 failed** — `焦点与键盘：模态必须真的接上 FocusTrap` |
| R-2 | 删掉 `<audio>` 的 `aria-label={t("歌曲试听", "Audio preview")}` | ✅ **1 failed** — `<audio> 必须有可访问名称` |
| R-3 | `splitDetailFields(detailFields(detail.data, t))` → `Object.entries(detail.data).filter(([, v]) => v).slice(0, 8)`（把旧实现整段搬回来） | ✅ **2 failed** — `表格不再直接打印后端键名` + `判空在 stringify 之前`（后者顺带证明「旧实现必然漏 null」这件事本身被钉住了） |
| R-4 | `INTERNAL_KEYS` 少一个键（删 `"matchedTitle",`） | ✅ **1 failed** — `music：matchedTitle 是兜底链的中间产物，不显示`，`expected [ '演唱', '专辑', 'matchedTitle' ] to not include 'matchedTitle'` |

R-4 值得单记：它**只动了一个字符串**，纯函数层当场转红。迭代 9 的 R-5（空变异，全绿）就是这个陷阱的
反面——那次变异没有语义，这次变异有语义且被测到，说明这一轮的断言确实咬在行为上。

## §6.1 为什么 A4 的浏览器栏仍然留红

本轮开工前先查了浏览器可用性：`npx playwright --version` 返回 **1.60.0**，
但 `%LOCALAPPDATA%\ms-playwright` 下只有 `chromium_headless_shell-1223` / `chromium-1223`
两个**残留目录、没有可执行文件**；本机唯一浏览器是 Edge
（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），未纳入 Playwright 通道。

⇒ 这不是「懒得跑」，是**环境确实没有可驱动的浏览器**。按 CONVENTIONS §8
「未到线上验证不标 ✅」，A4 的行为栏与 A7 的渲染栏**留红**，只把可离线判定的接线部分标 ✅。
**这已经是连续第三次**在同一处留红（迭代 7、9、11）——见 §8 第 3 条。

## §7 反思

### 7.1 「声明」和「行为」之间隔着一整个组件

`role="dialog" aria-modal="true"` 写了两行，读屏软件据此宣布「这是一个模态」。
但它**不产生任何行为**：焦点仍在打开它的那个按钮上，Tab 会走到弹窗背后的页面去，
Esc 什么也不会发生。

写这两行的人（我）以为自己在写「可访问的弹窗」，实际上写的是「**可访问的弹窗的自我声明**」。
真正干活的三件事（Esc / Tab 循环 / 首焦点）已经被 `FocusTrap` 实现好了，
而 `ArtworkDetail` 是全站**唯一**没接的模态。**这不是「缺一个功能」，是「已经有的东西漏接了」。**

判据上的收获：**看到一个 a11y 属性时，要追问「它背后是谁在干活」**。
如果答不上来，那这个属性就是一句空话——而且是那种最容易骗过 review 的空话。

### 7.2 翻译层比过滤器重要

旧实现不是漏了字段，而是**把「后端返回了什么」当成了「界面该显示什么」**。
`slice(0, 8)` 是这个根因上的补丁：用数字掩盖「从来没选过」，还让顺序跟着响应 JSON 插入序变。

本轮把中间那层补上之后，三个量化差异：

| | 旧 | 新 |
|---|---|---|
| `other`（7 键） | 4 行，含 44 字符内部键与 150 字符裸 URL | **1 行**（年份） |
| `book`（20 键） | 8 行，含 389 字符生平挤在表格行里 | 3 行翻译 + 12 行保底 + 生平独立成段 |
| `music`（6 键） | 3 行，含 `matchedTitle` | **2 行**（演唱/专辑） |

值得注意的是 `book` 的 **12 个保底键**（`作者`/`译者`/`校注`/`出版社`/`出版年`/`ISBN`/`页数`/`装帧`/`定价`/`丛书`/`dirs`）。
它们**本来就长得像给人看的中文标签**——是某次书籍接口的字段名直接用了中文。
所以「保底照印」这条路是对的：翻译层不该猜「`出版社` 是不是应该叫 `Publisher`」，
那是另一件事（要改后端字段名，牵动数据源，不是一轮前端能做的）。**保底不是妥协，是把翻译做成增量。**

### 7.3 四个真 bug，其中三个是我自己在写的「更干净」的代码里

1. **`title` 没搬进 `INTERNAL_KEYS`** —— 重写旧 SKIP 列表时漏了一个键，被新测试当场抓住。
2. **`String(null)` 是 `"null"`** —— 我把旧 `.filter(([, value]) => value && …)` 翻译成
   「先 stringify 再 `!text.trim()` 判空」，看着更统一，结果 `country: null` 变成可见的
   「地区: null」。**判空必须在 stringify 之前**，这两步的顺序是语义，不是风格。
3. **数组元素未过滤** —— `["", null, "徐凯鑫"]` 直接 join 出 `、null、徐凯鑫`。
4. **`label` 当 React key 会撞车** —— `author`→「作者」与原始键 `作者`（保底照印）标签相同。
   这条只有在**保留保底键**的设计下才可能出现，也就是说我自己引入的。
   修法：`DetailField.key` 用原始键名，`label` 只给人看。

三条里有一个共同点值得记：**「更统一/更简洁的重写」比「原来的笨代码」更容易引入缺陷**，
因为原文里的每个笨拙（`value &&`、`key`、`label`）都是当年某个 bug 的补丁。
`slice(0, 8)` 也在其中——它是补丁，只是补错了方向。

### 7.4 JSDoc 里写 `/api/*/detail` 会终止整个文件的解析

测试文件第一次跑就报 `Unterminated string literal`，而报错位置在**文件末行**——
离真正的错误（一个 JSDoc 里的 `*/`）有 180 行。定位办法：逐行前缀二分，对每个前缀跑
`esbuild.transform`，找**第一条硬错误**，报 `Expected "*/" to terminate multi-line comment` 于第 7 行。

教训：**「报错行号离错误很远」的第一个反应应该是「我写的注释里有注释终止符」**，
而不是去检查语法树的完整性。

### 7.5 「计划 §3.2 说抽到 `src/lib/`」没错，但 §5 少写了一条绊线

计划里的绊线是「纯函数红线 + 接线形状断言 + 反向断言」，其中「判空」没有单独成条。
结果是判空顺序这个真 bug（7.3 第 2 条）**只能被行为用例抓住，形状断言全绿**——
形状断言在 `isPresent` 存在与否上都成立。最终补了一条独立绊线
（断言 `if (!isPresent(value)) continue;` 与 `value === null || value === undefined` 字面量）。
**「顺序」这类语义，形状断言天生看不见。**

## §8 诚实记账

1. **A4 的浏览器行为与 A7 的界面渲染两栏留红**，未标 ✅。原因是环境无可驱动浏览器
   （§6.1），不是「测了没发现问题」。**这是同一处连续第三次留红**（迭代 7、9、11）。
2. **A5 实测 +1325 B，超预算 325 B，我选择接受而不是削词条**。理由：1.3 KB 里包含
   11 键字典的中英双份文案 + 9 键内部名单 + 分组函数。要压回 1 KB 只能删掉真实字段，
   那是为了数字删功能。**但这意味着计划写的预算不是「测出来的约束」，是「我猜的约束」**，
   下次写预算前应该先量一次空实现的体积。
3. **`book` 仍有 12 个保底键未翻译**。它们本来就是中文键名（后端如此），
   所以界面上不出现裸英文键，但英文界面下就是一片中文标签。
   **这是既有缺陷，不是本轮引入的**，修它要改后端字段名 ⇒ 记为后续轮的独立题目。
4. **焦点归还仍未做**：`FocusTrap` 不把焦点还给打开弹窗的那个按钮。
   这是**仓级组件语义**，改它影响另两处已有调用点 ⇒ 本轮明确不做（§3.5）。
   影响面：Tab 能用了、Esc 能用了，但关闭后焦点位置由 DOM 复用近似决定，不可靠。
5. **`IconButton` 只传 `title` 不传 `aria-label`**（ROADMAP §二 P2 全局项，F-12）
   仍未做：它有 20+ 调用点，改签名是全局重构 ⇒ 另一轮。
6. **线上实测发现 `other|纪念碑谷|monument valley|2014|4` 仍返 `Monument_Valley_icon_unrounded.jpg`**。
   这是**迭代 10 的 24h 边缘缓存**（PITFALLS 2.21 / 4.51），不是回归：
   迭代 10 已用 never-before-cached 的半角括号键验证过同一逻辑产出 `Monument_Valley_screenshot.jpg`。
   **本轮零后端改动，故不做任何缓存相关的动作**，如实记录。
7. **零迁移、零后端改动**：`git status --porcelain` 5 个条目全部在前端与文档；
   `npm run deploy` 报 `✅ No migrations to apply!`；线上 Version `bcbd52d4-5054-42df-a8fb-885bcd046597`。

## §9 线上取证

- `npm run deploy` → Version ID **`bcbd52d4-5054-42df-a8fb-885bcd046597****，25 assets，
  `Total Upload: 1019.27 KiB / gzip: 206.04 KiB`，`✅ No migrations to apply!`。
- A6 线上：`/assets/index-DUmQ19Z2.js` **411823 B**（与本地 build 逐字节相同）、
  `/assets/index-rtSOyFQJ.css` **148114 B**，两者均 `ce=br` +
  `public, max-age=31536000, immutable`；首页 `modulepreload` 计数 **0**。
- bundle 内容探针：`歌曲试听` **true**（新增文案已上线）、`art-rank:cover-choice` **true**、
  `other-name|` **true**（迭代 9 的记忆仍在，未被本轮破坏）、`matchedTitle` **true**、
  `poster_url` **true** —— 后两个是 `INTERNAL_KEYS` 名单里的**字符串本身**，用于排除而非渲染。
- 迭代 9 回归：batch 两个 other 条目均 `found`，`INSIDE` → `INSIDE_Cover.jpg` 不变。


## §5 绊线设计

- **纯函数红线**：`detailFields` 的用例覆盖 §1 四个实测响应形状（other/movie/book/music），
  断言「内部键永不出现」「长文本被标 long」「顺序稳定」。
- **接线形状断言**：剥注释后扫源码（沿用 `src/ui-fixes.test.ts` 既有 `stripComments`），
  钉住 `<FocusTrap onEscape={onClose}>` 包住 `<section role="dialog"`、`audio` 带 `aria-label`。
- **反向断言**：`ArtworkDetail.tsx` **不再含** `Object.entries(detail.data)` 与 `slice(0, 8)`。
- **分层测上游**：本轮判据依赖**线上响应形状**，实测用 `node fetch` 打自己的服务（可达）；
  打维基才需要 `Invoke-WebRequest`（PITFALLS 4.55）。

## §6 风险

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | 白名单漏掉某个键 ⇒ 字段消失 | 未知键**保底照印**，所以最坏结果是「没翻译」而不是「看不到」 |
| R-2 | `FocusTrap` 首焦点落在关闭按钮，用户以为要按它才能关 | 这是通用对话框惯例（`aria-modal` 弹窗首焦点落在关闭钮），且 Esc 已可用 |
| R-3 | `book` 的 `作者`/`译者`/`校注` 是中文键名，白名单里没有 | 保底照印（原样），不回归 |
| R-4 | `t()` 键数膨胀 | 白名单 ≤10 键 ×2 = 20 对，沿用现有 `(zh, en)` 约定，无新机制 |
| R-5 | A4 无浏览器 ⇒ 又一次留红 | A4 拆成「接线形状断言（可离线验）」+「浏览器行为（留红）」两栏，不混标 |

## §7 反思

（待回填）

## §8 诚实记账

（待回填）
