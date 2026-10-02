# PLAN-COVER-ARTIFACT-FILTER

> 迭代 10/20 · 优化类 · 台账 P0「`year` → icon 误选」的收尾
> 题源：`docs/agents/TASK-LEDGER.md` T-20261002-09 遗留 ②、T-20261002-10 遗留风险 ①。
> 由用户 m05616「继续，做到优化轮次停止」排到本轮。

## §0 换题说明

台账 P0 写的是「`year` 导致 icon 误选」。**动手前的实测推翻了它的因果**：

| 请求 | 键 | 结果 |
|---|---|---|
| `纪念碑谷` / `monument valley`（无 year） | `other\|纪念碑谷\|monument valley\|\|4` | `500px-Monument_Valley,_Utah,_USA_(23611451292).jpg` ✅ |
| `纪念碑谷` + `year=2014` | `other\|纪念碑谷\|monument valley\|2014\|4` | `Monument_Valley_icon_unrounded.jpg` ❌ |

`year` **没有**参与任何选图判断。它做的是**换了一道分支**：`worker/media.ts:1727` 第一档
`otherDetail(title, year)`。不带 year 时它返回 `紀念碑谷`（地貌页，`page_image` 为空 ⇒
落到第二档 `resolveOtherCover` 第二段 `thumbnail.source`，即那张 500px 地貌照）；
带 year 时它返回 `纪念碑谷 (游戏)`（tier 2 / score 13.5 / band `exact` —— **条目选对了**），
而该条目第一档唯一的图就是 infobox 里那个 app 图标。

⇒ **题眼不是 year，是「infobox 封面名指向 app 图标」这件事本身。**
year 只是让它暴露出来的开关。给 year 加权重上限治不了（没有任何权重能造出那张不存在的
封面），也不该修（条目选得是对的）。

## §1 事实表（2026-10-02 全部亲自实测）

| # | 事实 | 证据 |
|---|---|---|
| F-1 | `纪念碑谷 (游戏)` 的 `pageprops.page_image` **就是** `Monument_Valley_icon_unrounded.jpg` | 拉 `prop=pageprops` 直读 |
| F-2 | 同一页 `images` 里躺着 `File:Monument Valley screenshot.jpg`（第 7 位，字母序在 icon 之后） | `prop=images&imlimit=50` |
| F-3 | 该页 images 里 `Monument Valley icon unrounded.jpg` 与 page_image **重复** | 同上 |
| F-4 | `imageinfo` 的 `iiprop=url\|size` 能给出 `width`/`height`/`size` | 直读：`316×316 / 14191 B` |
| F-5 | `utm_content=thumbnail_unscaled` 出现在原图小于请求桶宽 500 时 | 四个样本全部如此 |
| F-6 | **`Animal_Crossing_New_Horizons.png` 只有 248×402**，比那个 icon 更窄 | 同上 |
| F-7 | 正确封面同样可能是 `thumbnail_unscaled` | 同上 |
| F-8 | 加 `prop=images&imlimit=50` 体积：gsrsearch 12007→14753 B（+23%）；titles 6020→7989 B | 实测两次 |
| F-9 | `wikiSearchOnce:602` / `wikiTitlePages:752` 现在的 `prop` 里**没有** `images` | 源码 |
| F-10 | `wikiPageImageAny:859` 的 `SKIP` 已含 `icon`，但只作用于 `:866` 的 images 分支 | 源码 |
| F-11 | `resolveOtherCover:1134-1137` 的 page_image 分支**无任何**文件名检查 | 源码 |
| F-12 | `wikiPageImageAny:857` `if (page.fileUrl) return page.fileUrl;` 同样无检查 | 源码 |
| F-13 | `worker/media.ts:1322 wikiPagePoster` 是 media.ts 侧同款无检查直取 | 源码 |
| F-14 | `紀念碑谷` 地貌页 `page_image` 为空，其 `thumbnail.source` 是 500px 地貌照 | 实测 |

### 1.1 被否决的方案：靠宽高判 icon

F-6 是决定性的：`Animal_Crossing_New_Horizons.png` 248×402，**比 316×316 的 icon 更窄**。
任何「太窄/太小 ⇒ 不是封面」的规则都会误杀当前**正确**的动物森友会封面。
F-7 同理：`thumbnail_unscaled` 对正确封面是常态。
⇒ **文件尺寸不是判据**。这不是保守，是实测把这条路钉死了。

### 1.2 文件名里的 `icon` 是硬信号

`icon` 在维基文件名里基本只出现在应用图标与界面图标（`OOjs UI icon edit-ltr-progressive.svg`、
`Symbol support vote.svg`、`Crystal Clear app package games.svg`、`Monument Valley icon unrounded.jpg`）。
扫描四个样本页的全部 images：**非作品图几乎都带 `icon`/`logo`/`edit`/`symbol`/`Star full`，
作品图一个都没有**。

## §2 根因

「infobox 封面」在代码里被实现成「**page_image 指名的那个文件**」，而不是
「**这个文件长得像作品封面**」。维基编者把 app 图标填进 infobox 时，代码毫无还手之力。

SKIP 正则是**已经写对的那把尺**，只是放在了错误的层级：

- `wikiPageImageAny:866` 用了它 ⇒ images 分支有防护。
- `:857`（page_image 直取）、`resolveOtherCover:1134-1137`、`media.ts:1322` 都没用。

**一句话：SKIP 正则存在，却只覆盖了优先级最低的那条取图路径。**

## §3 方案

### 3.1 一把尺，纯函数

```ts
/** 这个文件名像不像「作品封面本身」。 */
export type ArtworkFileVerdict = "artwork" | "artifact";

const ARTIFACT_FILE_RE =
  /(^|[\s_\-()\[\]])(?:icon|logo|logotype|wordmark|banner|avatar|flag|placeholder|mascot)(?:[\s_\-)\]]|$)|edit[-_ ]|ui[-_ ]?icon|symbol|(?:^|[\s_])star (?:full|empty|half)/i;

export function classifyArtworkFile(name: string): ArtworkFileVerdict;
```

**不是**把旧 `SKIP` 改名，是**加严 + 收窄**：旧 SKIP 的三个词各有代价 ——
`disambig` 是消歧页标记而非文件名特征；`commons`（`Monument Valley, Utah, USA (23611451292).jpg`
来自 Commons 但完全正确）；`question` 只命中 `File:Question book-icon.svg` 一类。
`edit` 改成 `edit[-_ ]` 限定，避免误伤 `File:Edit-wiki.png` 之外的正常词。

### 3.2 四处 page_image 直取收口到一把尺

| 位置 | 改法 |
|---|---|
| **`toWork:874-879`（真正修 bug 的那处）** | page_image 判 artifact ⇒ 不采用，走 thumbnail/original，再走 §3.3 的同页 images 第四档 |
| `resolveOtherCover:1258-1262` | 同上；**不返回 null**，继续走同页 images |
| `wikiPageImageAny:1037` | 同上；**不**直接 return null，它后面本来就有 images 分支 |
| `media.ts:1325-1333 wikiPagePoster` | 同一把尺（第 5 档 `searchWikiPoster` 的收口）；**artwork 但 imageinfo 超时时仍回落缩略图** |

> **计划写错了「哪一处在生效」，执行时才发现。** 计划以为主路径是
> `resolveOtherCover`，但 `.tmp/which10.mjs` / `.tmp/which10b.mjs` 实测：
> `worker/media.ts:1727-1728` 第一档 `if (detailCover?.poster_url) return {...}`，
> 而 `otherDetail` 内部的 `toWork` 就会给出 `poster_url` ⇒ **带 year 的请求
> 根本走不到 `resolveOtherCover`**。只改 `resolveOtherCover` 的话线上一点变化都看不到。

### 3.3 替补从哪来（关键：不能退化成 null）

被 `icon` 判掉之后有三个来源，按可信度：

1. **同页 `images` 里文件名含作品关键词的候选** —— `Monument Valley screenshot.jpg`
   含 `Monument Valley` ✔。用 `preferTitles` 归一后 `includes` 匹配，
   **沿用 `wikiPageImageAny:861-870` 的现成口径**，不发明第二套相似度。
   追加一条**与语言无关的作品词**（`ARTWORK_NAME_HINT_RE`：
   `screenshot|cover|boxart|poster|keyart|title screen|capture|gameplay`）——
   因为中文条目正文里的文件名是英文的（实测 F-2），只靠中文标题去 `includes`
   永远匹配不上，**第一次验收就是这么白跑一轮的**。

   为什么不去查 `langlinks` 换英文标题：那条路会让**每个** icon 页多付一次
   请求，而作品词表与语言无关，在这一档已经够用。
2. 同页 images 里**不是 artifact** 的第一张（仅当该页已由 `pickBest` 确认是作品页）。
3. `thumbnail.source` / `original.source`（`resolveOtherCover:1138-1141` 已有）。

**顺序不可换**：② 若排在 ① 前面，`紀念碑谷` 地貌页会先命中 `Monument Valley 10.jpg`。
而 `紀念碑谷` 地貌页**根本不会走到这条路**（page_image 为空，`fillPageImageUrls`
对它不产出 `fileUrl`），所以 ② 只在「已确认是作品页」的位置生效 ——
`resolveOtherCover` 的 `top` 数组正好由 `pickBest` 保证 tier≥1 且带年份佐证。

### 3.4 收口点的位置决定代价

`prop=images` 加在**哪**个请求上决定多付多少体积（F-8）：

- `wikiTitlePages`（titles 轮）：+1969 B / 2 页。其它调用点（`otherDetail`、
  `otherSearch`）根本不需要 images，给它们加就是纯浪费。
- `wikiSearchOnce`（gsrsearch 轮）：+2746 B / 6 页，一条 other 最坏跑 4 次 ⇒ +11 KB。

⇒ **只在 `resolveOtherCover` 的取图阶段单独发一次带 `images` 的 titles 查询**，
只查 `top` 里那几个页（1–3 个）。

## §4 验收表

| # | 判据 | 状态 |
|---|---|---|
| A1 | 五道门禁全过，lint 保持 29 problems | ✅ `tsc -b` exit 0；lint **29 problems (0 errors, 29 warnings)** = 基线；`format:check` All matched files；`vitest` **674 passed · 9 skipped (683)**（基线 660 ⇒ **+14**）；`build` 成功 |
| A2 | 红队 ≥3 次全红（每次删掉被断言的字面量） | ✅ **R-1** 删 `toWork` 的守卫 1 failed / **R-2** 改成 `return null` 2 failed / **R-3** 删正则扩展分隔符 2 failed / **R-4** 删 `fillArticleImageNames` 存回 `{title}` 的 `.map` 1 failed（详见 §7.3） |
| A3 | 线上 `纪念碑谷`+year=2014 ⇒ 不再是 `icon_unrounded` | ✅ batch：`other\|纪念碑谷(游戏)\|monument valley\|2014\|4` ⇒ `Monument_Valley_screenshot.jpg`；detail：`poster_url` 同值，标题仍是 `纪念碑谷 (游戏)` |
| A4 | 四个对照 other 封面**逐字不变** | ✅ 三轮逐字稳定：风之旅人 `Journey_PSN_Cover.png`、动物森友会 `Animal_Crossing_New_Horizons.png`、Journey `Journey_PSN_Cover.png`、Inside `INSIDE_Cover.jpg`，全 `found` |
| A5 | 反样本不误伤 | ✅ `Animal_Crossing_New_Horizons.png` / `Doubutsu_No_Mori_Boxart.jpg` / `Florence_Preview_Image.jpg` / `500px-Mona_Lisa…` 全判 artwork（§5 黑线用例 + A4 线上两条） |
| A6 | `worker/other.ts` 的**非本轮**行零改动 | ✅ 判决链 / 评分 / 别名 / 档位一行未动；新增全在取图层。`git diff` 逐行核过 |
| A7 | 24h 边缘缓存下能验证新代码 | ⚠️ **原键 `other\|纪念碑谷\|monument valley\|2014\|4` 仍返 icon**（24h TTL 未过）。改用**真实形态**的变体 `纪念碑谷(游戏)`（半角括号，真实用户输入）⇒ 新键命中新代码。**加盐会破坏维基消歧**（PITFALLS 4.54），所以换的是输入形态而不是内容 |
| A8 | 主包字节数变化 ≤1 KB（纯服务端改动，应为 0） | ✅ **0 字节**：`index-CGd3gcxH.js` 本地 410498 / 线上 410498，与迭代 9 同一指纹；`ce=br`、`immutable`、`modulepreload` 计数 0 |
| A9 | 每条 other 解析**多出的上游字节** ≤12 KB | ✅ 只在 page_image 判 artifact 时多发一次 `prop=images`（实测 2 页 +1969 B / 6 页 +2746 B，单条 other 最坏 1 次 ⇒ **+1.9 KB**）；其它条目**零**多付（§5 形状断言钉住） |

## §5 绊线设计

- **红线（必须真的红）**：`classifyArtworkFile` 判定纯函数用例；
  `resolveOtherCover` 在「page_image 是 icon + 同页有 screenshot」时必须给 screenshot；
  `wikiPageImageAny` 在「page_image 是 icon」时必须不返回 icon。
- **黑线（必须真的黑）**：`Florence_Preview_Image.jpg`、
  `Animal_Crossing_New_Horizons.png`、`Doubutsu_No_Mori_Boxart.jpg`、
  `Monument Valley, Utah, USA (23611451292).jpg`、`Journey_PSN_Cover.png`、
  `INSIDE_Cover.jpg` —— 一个都不能被判成 artifact。
- **形状断言**：新 prop 只出现在新增的那个查询上；`wikiTitlePages`/`wikiSearchOnce`
  的 `prop` 字符串保持原样。
- **分层测上游**：判定依赖维基真实数据，本机 node fetch 到 wikipedia **仍 100% 超时**
  （PITFALLS 4.55），测量一律走 `Invoke-WebRequest`。

## §6 风险

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | 新正则误杀某个真封面 | §5 黑线 6 条用例；拿线上五个 other 封面文件名逐个喂 |
| R-2 | 替补取到同页无关照片（`Ken wong - game developers conference cropped.jpg` 是开发者在会议上的照片） | ① 只认含作品关键词的文件名；② 只在 `pickBest` 已确认的作品页上生效 |
| R-3 | 多一次上游请求 ⇒ 更慢 | 只在 page_image 命中 artifact 时才发；实测 +1.9 KB / 1–3 页 |
| R-4 | `media.ts:1322` 改动影响第 5 档全部 other | 该函数是纯函数 + 已导出，改动可离线测；`searchWikiPoster` 本来就有标题闸门 |
| R-5 | 24h 边缘缓存让线上验证失真 | A7 专列；用 never-before-cached 的作品或带 year 的键（`2014|4` 与 `|4` 是两个键） |
| R-6 | 误以为「改好了」其实是缓存 | 先 `raw8` dump 原始响应确认走的是新代码 |

## §7 反思

### 7.1 这一轮真正修的 bug，比计划写的大一层

计划 §3.2 点名三处直取，执行时发现漏了**唯一真正生效的那处**：`toWork`。
带 year 的 other 请求在 `media.ts:1727` 第一档就被 `otherDetail` 的返回值截住，
`resolveOtherCover` 压根没跑。更糟的是**只修 `resolveOtherCover` 时全套测试仍然全绿**——
69 个用例断言的全是那条没跑到的路径。**测试全绿和线上没变化同时成立**，因为它们
量的根本不是同一段代码。

⇒ 纪律：**动手前先确认「主路径上真正跑的是哪一行」，而不是「哪一行看起来该修」。**
`.tmp/which10.mjs` 花一次线上请求换来这条，比读一百行源码便宜。

### 7.2 「判掉之后往下落」的梯子有一处是空的

第一版只做「icon ⇒ 不采用」，结果纪念碑谷从「图标」变成「**没有**」——
因为实测发现该页 `thumbnail` / `original` / `pageimages` **三者全空**（app 图标是
非自由文件）。把一个错误换成另一个错误，只有实地量过才知道。

⇒ 纪律：**「回退到下一档」必须验证那一档真有东西**。梯子的每一级都要各自取证。

### 7.3 红队第四次的价值，和它暴露的那类 bug

R-1/R-2/R-3 在部署前就抓到了守卫的形状与正则边界。R-4 是**线上取不到图之后**才补的：
回退 `fillArticleImageNames` 存回值的 `.map((name) => ({ title: name }))`，
`worker/other.test.ts` 精准红一条。

那次修复的性质值得单列：填 `images` 的函数写**裸字符串**，读它的两个函数
（`articleImageNames` / `wikiPageImageAny`）按 `{title}` **对象**读。两边各自
`as WikiPage & { images?: ... }` cast 成自己那套类型，**TypeScript 全程零报错**，
运行期静默全空。整个 `worker/other.test.ts` 69 条全绿而线上取不到图。

⇒ 这是 PITFALLS 4.51「自己以为的结构要 dump 看过」的反面：**它写出去的形状
和读进来的形状不一致时，最强的静态检查也看不见**。新写的测试必须**让被测的
填充器真的跑一次**——原先那条把 `images` 直接挂在 fixture 上，恰好绕过了出问题的那一层。

### 7.4 判据只能是文件名，而且是被实测钉死的

「icon 封面看起来是正方形」这个直觉很容易让人上宽高。`Animal_Crossing_New_Horizons.png`
248×402，比那个 316×316 的 icon **更窄**，任何宽高规则都会误杀当前**正确**的封面。
加上 `thumbnail_unscaled` 对正确封面是常态 ⇒ 尺寸这条判据**根本不存在**。

### 7.5 A7 是 ⚠️ 不是 ✅

原键仍返 icon（24h TTL 没到）。我换的是**输入形态**（`纪念碑谷` → `纪念碑谷(游戏)`，
半角括号，正是真实用户会输的写法）而不是给内容加盐——后者在迭代 8 已经证明会破坏
维基消歧。所以 A3 的证据建立在**另一个键**上，原键的修复要等 TTL 过期才能验证。

## §8 诚实记账

1. **原键仍未验证**（A7）。`other|纪念碑谷|monument valley|2014|4` 今天仍返 icon，
   那是缓存不是代码。这是本轮**唯一没做到**的判据。
2. **A6 我只核到「取图层之外零改动」**。`git diff` 逐行读过，但没有自动化断言
   钉住「评分/档位/别名一行不动」——下一轮若碰 `other.ts` 应补一条形状 tripwire。
3. **正则有已知漏网**（诚实记账，不装完美）：`Crystal Clear app package games.svg`、
   `Future film2.svg`、`Symbol support vote.svg` 这类 2010 年代条目模板图标，
   文件名不共享任何特征词，只能靠 `articleImageNames` 的 `jpe?g|png` 过滤兜住
   （svg 进不来）。png/jpg 的模板图标仍有漏网可能。
4. **`icon` 按词边界命中**，`File:Icon Man.jpg` 会被判 artifact。实测没有这种
   真封面，但这是明确的取舍，不是「不会发生」。
5. **`toWork` 改成 async 是签名变更**，三个调用点都传了 probe，但这意味着
   `otherSearch` 的 `Promise.all` 并发度没有变化（没有新增串行等待）——我确认了
   没变，没测量它对总时长的影响。
6. **不动的部分**：判决链、评分、别名、`OTHER_POSTER_GENERATION`、D1 零迁移、
   per-user 隔离仍不做（迭代 5 遗留）。本轮是纯服务端修图，不进 FEATURES 主表。
