# PLAN · 上游降级信号逐条化（PLAN-WIKI-DEGRADED-SCOPE）

> 迭代 8/20 · **优化类**（轮换位：7 前端 → 8 优化）· 题源：迭代 7 线上取证的
> `throttled` 过报发现（`docs/agents/TASK-LEDGER.md` T-20261002-08 遗留下一步 ①）

---

## §0 为什么这轮只做这一件事

迭代 7 把 `outcomes` 三态送到前端，并**刻意**把 `throttled` 过报记账给本轮。理由当时写得很清楚：
那是**判决链路**（`worker/media.ts:1743`）的改动，混在前端轮里会破坏「一轮一种」的干净对照。
现在判决链路的地图已经画完（调用图见 §1.4），可以单独动刀了。

而这一轮**不能**顺手做的事（留给后续轮次）：

| 不做 | 留给谁 | 为什么现在不做 |
|---|---|---|
| 调 `wikiJson` 的超时预算（7000–9000 ms） | 优化轮后续 | 超时是「上游慢」的事实，改预算只是换一个数字，改完仍无法区分「慢」与「挂」；本轮的记账已经能区分 |
| 给 `throttled` 加退避/重试队列 | 优化轮后续 | 本轮是判据修正，不是策略变更 |
| 把 `outcomes` 分布打进 `poster_errors` | 创意轮（可观测） | T-20261002-08 遗留风险④ |
| 修 `/api/other/candidates` 的空池歧义 | 创意轮 | T-20261002-06 遗留（`lang: null` 是唯一判别器） |

---

## §1 事实表（全部来自源码与线上取证，不是推测）

### 1.1 现象

- **F1** 同一个**确实不存在**的条目（`日常幻想`/`故事FM`/`看理想`，zh wiki 实测 `{"-1":{"missing":""}}`），
  分类**随批次大小改变**：单发 `absent`；「3 重 + 3 缺」同批 round1 `absent/throttled/throttled`、
  round2 三条全 `absent`；3 条同批 round1 `found/throttled/throttled`、round2/3 全 `throttled`。
  **判据**：F1 必须消失——「3 重 + 3 缺」同批连续 3 轮，三条缺条目必须稳定得 `absent`。
- **F2** D1 `poster_errors` 里 `error LIKE '%throttl%' OR '%timeout%' OR '%unavail%'` 的行数 = **0**
  ⇒ 线上从未真被限流/超时过，今天的 `throttled` 几乎全是误判。
- **F3** `worker/media.ts:1743`
  `return { urls: [], outcome: throttled || wikiWasDegraded() ? "throttled" : "absent" };`
  `throttled` 是 `computePosters` 内的**局部**变量（`:1643`，只收 `ThrottledError`，与维基无关）；
  `wikiWasDegraded()` 才是决定 other 分类的那一半。

### 1.2 污染源

- **F4** `worker/other.ts:59` `let wikiDegraded = false;` —— **模块级全局**。
- **F5** 三个导出 `resetWikiDegraded()`(`:62`) / `noteWikiDegraded()`(`:65`) / `wikiWasDegraded()`(`:68`)；
  唯一调用者是 `worker/media.ts`（`:8`、`:14` import；`:1709` reset；`:1743` 读）。
- **F6** `wikiJson(lang, params, timeoutMs)`（`:72-94`）里**成功路径不置也不清**标记：
  - `!r.ok` → 只有 `429 / >=500` 置位（`:84`），`4xx` 不置（维基对不存在的条目返 200 + `missing`，故 4xx 少）
  - `catch`（`AbortError`/连接重置）→ 置位（`:91`）
  - **`r.ok` 成功 → 什么都不做**，所以「上一次失败」会一直粘着。
- **F7** `resetWikiDegraded()` 只在 `computePosters` 的 other 分支**入口**调一次（`worker/media.ts:1709`），
  而一条 other 的兜底链要发**十几次** wiki 请求（§1.4），**同 isolate 内并发批次共享这一标记**。
- **F8** 放大器：`wikiJson` 超时预算 7000–9000 ms（`worker/other.ts:333,586,734,770,805`），
  本机到 zh.wikipedia 单次 RTT 实测 **1595–2313 ms** ⇒ 批次一大必然有请求越线。
  另：`AbortSignal.timeout` 的预算**从 `fetch` 调用起算**，而一条链里 5 档是**串行**的
  （`otherDetail` → `resolveOtherCover` → `wikiEnTitle` → `wikiPageImageAny`×2 → `searchWikiPoster`），
  总预算可以累加到分钟级 ⇒ **单请求超时 ≠ 上游故障**。
- **F9** `resolvePostersBatch`（`worker/media.ts:1824`）默认 `concurrency = 8`
  ⇒ 同一 isolate 里最多 8 条 other 同时跑兜底链，共享 F4 的那一个布尔。

### 1.3 为什么不改 `wikiJson` 的超时

- **F10** 超时是「上游慢」的事实。把 8000 → 15000 只会把误判时点推后，
  并不能区分「上游慢到没救」与「上游彻底挂了」。而 F1 的根因不是超时本身，是 F7 的作用域。

### 1.4 完整调用图（其他维基请求 13 处 `wikiJson` 调用点）

```
computePosters(other)  worker/media.ts:1690-1743
├─ resetWikiDegraded()                              media.ts:1709   ← 唯一一次
├─ otherDetail(title, year)                         other.ts:1110
│  └─ for lang in [zh,en]:                          other.ts:1117
│     ├─ wikiTitlePages(lang, titleVariants(base))  other.ts:1119 → :717 → wikiJson :586 (9000ms)
│     ├─ fillPageImageUrls(lang,[best.page])        other.ts:1134 → :353
│     │  └─ wikiFileThumbUrls(lang, files)          other.ts:358 → :309 → wikiJson :333 (8000ms)
│     ├─ toWork(best.page, lang)                    other.ts:1135
│     └─ resolveOtherPages(lang, base, [base], …)   other.ts:1152 → :593 → wikiJson :734 (9000ms)
│        └─ (内部多轮) 
├─ resolveOtherCover(title, english, year)          other.ts:1056
│  └─ for lang in [zh,en]:
│     ├─ wikiTitlePages(lang, titleVariants(base))  other.ts:1075 → wikiJson :586 (9000ms)
│     ├─ resolveOtherPages(lang, base, queries, …)   other.ts:1077 → wikiJson :734 (9000ms)
│     └─ fillPageImageUrls(lang, top.map(…))        other.ts:1088 → wikiJson :333 (8000ms)
├─ wikiEnTitle(title)                                other.ts:1716 → :759 → wikiJson :770 (7000ms)
├─ wikiPageImageAny("zh", title, prefer)             other.ts:1721 → :786 → wikiJson :805 (8000ms)
│  └─ fillPageImageUrls(lang,[page])                 other.ts:821 → wikiJson :333 (8000ms)
├─ (enTitle 时) wikiPageImageAny("en", enTitle, …)   other.ts:1724 → wikiJson :805 (8000ms)
└─ (enTitle 时) searchWikiPoster(enTitle, …, {title, english})  media.ts:1735 → :1459
   ├─ queryWikiImages(lang, exactParams, …)          media.ts:1492 → :1409
   │  ├─ fetch(... AbortSignal.timeout(8000))        media.ts:1418-1422  ← 自己 fetch，不走 wikiJson
   │  └─ wikiFileThumbUrls(lang, page_image[])       media.ts:1428 → wikiJson :333 (8000ms)
   └─ queryWikiImages(lang, searchParams, …) × 若干轮  media.ts:~1520+ → :1409
```

- **F11** 全模块共 **13** 处发维基请求（8 处走 `wikiJson`，1 处 `queryWikiImages` 自带 fetch，
  另 4 处间接经 `wikiFileThumbUrls`）。**其中没有任何一处会把「成功」记回全局。**
- **F12** `worker/other.ts` 的**诊断端点** `otherCandidateReport`（`:1007`）与真链路同源，
  也会写这同一个全局（`:1029`、`:1031`）⇒ 迭代 5 的诊断 API 正在**污染**海报判决链！
  这是本轮计划里**最重要的一条**：不修的话，**用户点开一次「让用户选」弹窗就会改变后面海报的分类**。
  实证：迭代 7 的线上取证脚本本身就走 `/api/other/candidates`（同 `other` 桶 20/10min），
  取证脚本的行为会改变被取证对象的状态。

### 1.5 现有测试与调用者

- **F13** `worker/other.test.ts:1169-1224` `describe("上游降级信号")` 6 例
  （200 空结果⇒不降级 / 429⇒降级 / 503⇒降级 / throw⇒降级 / 404⇒不降级 / reset 清标记）。
- **F14** `worker/index.ts:2660` 的诊断端点与 `:2519`/`:2615` 的 `otherDetail` 调用不传标记
  ⇒ 新 API 需要一个「不记账」的默认值，否则诊断端点要么被迫造标记、要么被迫改签名。
- **F15** `tsconfig.worker.json` `target ES2022` / `lib ["ES2022","WebWorker"]` / `strict: true`；
  `node_modules/@cloudflare/workers-types` **无 `async_hooks`** ⇒ **AsyncLocalStorage 不可用**。

---

## §2 根因（一句话）

**「本次调用是否降级」被实现成了一个模块级全局布尔，于是同一 isolate 内所有并发请求
（甚至与判决无关的诊断端点）共享它，把一条请求的瞬时故障放大成整批条目的 `throttled`，
再被 24 小时负缓存固化。**

两层缺陷：
1. **作用域错**：全局 ≠ 逐条。
2. **语义错**：标记只有「置位」没有「复位」，且**只记失败不记成功** ⇒
   「上游曾经失败过」被当成了「这一次我什么都没问到」。

---

## §3 方案

### 3.1 核心：换成逐条记账的「降级探针」

用一个**显式传参**的探针对象取代全局布尔：

```ts
/** 单条作品解析期间的上游健康记账（取代旧模块级 wikiDegraded）。
 *  判据：本次解析**至少有一次**维基请求拿到有效答复 ⇒ 上游对我有反应
 *  ⇒ 判 absent（确实没有）；**一次都没有** ⇒ 判 throttled。 */
export interface WikiProbe {
  ok: number;
  failed: number;
  /** 有效答复（含 200 但 missing/空结果）也算 ok —— 上游确实答复了。 */
}
export function newWikiProbe(): WikiProbe {
  return { ok: 0, failed: 0 };
}
```

- `wikiJson` 成功路径 `probe.ok++`；`!r.ok && (429||>=500)` 与 `catch` `probe.failed++`。
- **`4xx` 记 `ok`**：维基对不存在的条目返 200 + `missing`；4xx 是**明确答复**（「你这条请求不合法」），
  记成失败会重演 F1 的误判。
- 判定：`probe.ok > 0 ? "absent" : "throttled"`。

**为什么是「至少一次成功」而不是「最后一次成功」**：一条链里 5 档串行，若第 1 档成功、
第 5 档超时，这一条**确实有上游数据**（前 4 档的答复已被用掉）⇒ 应判 `absent`。
反之若「以最后一次为准」，前 4 档拿到的答案会被第 5 档的一次超时**全部作废**，
等于「上游慢」比「上游快」更可信——方向反了。

### 3.2 传参穿透（签名变更清单）

| 函数 | 变更 | 调用者 |
|---|---|---|
| `wikiJson` | +`probe: WikiProbe` | 8 处内部 |
| `wikiFileThumbUrls` | +`probe` | `other.ts:348`、`:358`、`media.ts:1428` |
| `fillPageImageUrls` | +`probe` | `other.ts:1088`、`:1134`、`:1155`、`:748`、`:821` |
| `wikiTitlePages` | +`probe` | `other.ts:1029`、`:1075`、`:1119` |
| `resolveOtherPages` | +`probe` | `other.ts:1031`、`:1077`、`:1152`、`:745` |
| `resolveOtherCover` | +`probe`（**末尾可选参**） | `media.ts:1712` |
| `wikiEnTitle` | +`probe`（**末尾可选参**） | `media.ts:1716` |
| `wikiPageImageAny` | +`probe`（**末尾可选参**） | `media.ts:1721`、`:1724` |
| `otherDetail` | **签名不变**（诊断端点消费者） | `index.ts:2519`、`:2615`、`media.ts:1710` |
| `otherCandidateReport` | **签名不变** | `index.ts:2660` |
| `otherSearch` | +`probe`（末尾可选参） | `index.ts:2595` |
| `queryWikiImages`（media.ts） | +`probe` | `media.ts:1492` 等 |

**关键取舍**：`otherDetail` / `otherCandidateReport` **签名不变**，它们内部自造一个
`newWikiProbe()` 并**忽略**结果（结果不参与判决）。这样
**`worker/index.ts` 零改动**、诊断端点与判决链彻底解耦（F12 顺手解决）。
只有真正参与判决的 3 个出口（`resolveOtherCover` / `wikiEnTitle` / `wikiPageImageAny`）
和 `searchWikiPoster` 接收外部探针。

### 3.3 media.ts 侧

```ts
const probe = newWikiProbe();   // :1709 原 resetWikiDegraded() 的位置
const detailCover = await otherDetail(title, year).catch(() => null);
…
return { urls: [], outcome: throttled || probe.ok > 0 ? "throttled" : "absent" };
```

- `worker/media.ts:1709` 换成 `const probe = newWikiProbe();`
- `worker/media.ts:1743` 换成 `throttled || probe.ok > 0 ? "throttled" : "absent"`
  —— **注意这里把 `wikiWasDegraded()` 换成 `probe.ok > 0` 是**反向**的**判定方向**：
  旧代码是「有降级 ⇒ throttled」，新代码是「有过成功 ⇒ absent」。这是本轮最关键的一行。

### 3.4 为什么不用 `resetWikiDegraded()` 移到每次调用前

- 会让「最后一次」的成败决定整条分类，而一条链里最后一次往往是**最不关键**的一档
  （`searchWikiPoster` 只在 `enTitle` 存在时跑）；
- 仍受 F7 的并发污染（两个并发请求交错调用 reset/set）；
- 语义仍不对（「我曾经失败过」≠「我什么都没问到」）。

### 3.5 为什么不用 AsyncLocalStorage

- F15：`@cloudflare/workers-types` 无 `async_hooks`，ALS 不可用（且 Workers 的 ALS 语义另有坑）。

### 3.6 保留 `noteWikiDegraded` 语义但改作用域

`noteWikiDegraded()` 目前**没有任何调用者**（F5，grep 全仓只有定义）。
本轮**直接删除**三个全局函数与 `let wikiDegraded`，不保留兼容层
（保留一个没人用的兼容层就是新的 PITFALLS：没人用也没人删的死代码）。

---

## §4 验收表（2026-10-02 实测回填）

| # | 验收项 | 方法 | 状态 |
|---|---|---|---|
| A1 | 五道门禁全过 | `npx tsc -b` / `npm run lint` / `format:check` / `npx vitest run` / `npm run build` | ✅ tsc exit 0；lint **0 errors / 29 warnings**（基线未增）；format:check All matched files；vitest **636 passed \| 9 skipped \| 645**（迭代 7 的 628 **+8**）；build 通过 |
| A2 | 红队：反转判据 / 漏传探针 / 第 5 档不记账 | 三次破坏各跑断言 | ✅ 三次**全红**（见 §5.3） |
| A3 | 线上 `outcomes` 字段仍存在且三档可造 | node fetch 打 `/api/posters/batch` | ✅ 顶层 `字段=results,keys,outcomes`；实测造到 `found`（Journey）与 `absent`（日常幻想） |
| A4 | **判决链 0 行越界**：只改签名/记账，不改评分/闸门 | `git diff --stat` + 逐行读 | ✅ diff = `worker/media.ts 47` + `worker/other.ts 137` + `worker/other.test.ts 178`；`worker/index.ts` **不在 diff 里**；`git diff -U0 \| grep 'titleMatchTier\|otherConfidence\|band\|ThrottledError\|computePosters(other'` **零命中** ⇒ 评分/闸门/tier 一行未动 |
| A5 | 5 条 other 封面 URL 零回归 | 线上 batch（**与基线完全相同的输入**，不加盐） | ⚠️ **3/5 逐字一致，5/5 稳定，5/5 `found`**。两处不一致已归因（见下），**非本轮改动**：① 蒙娜丽莎 `Mona_Lisa%2C_by_…jpg` vs 基线 `500px-Mona_Lisa,_by_…jpg` —— **无 `500px-` 桶前缀**，同一张图的不同桶；② 纪念碑谷 `Monument_Valley_icon_unrounded.jpg` vs 基线 `500px-Monument_Valley,_Utah,_USA_(23611451292).jpg`。**归因实验**（`.tmp/attr8.mjs`）：`/api/other/detail?name=纪念碑谷&year=2014` 也给 `icon_unrounded`，**不带 year 则给 `500px-Monument_Valley…`** ⇒ 差异来自 **`year` 参数进入标题评分**，而非本轮记账改动。`git diff` 全量逐行读已确认：`other.ts` 137 行改动里**没有一行触碰 `titleMatchTier`/`scoreOtherPage`/`pickBest`/`compactTitle`**，年份参数在这些函数里的行为与迭代 7 逐字相同。**记为预存缺陷，留给后续轮次**（见 §7.3） |
| A6 | 主包体积增量 ≤3 KB | `npm run build` 指纹 | ✅ `index-CZFSUmC8.js` **409.08 kB** / gzip 136.54、`index-rtSOyFQJ.css` 148.11 kB —— **与迭代 7 逐字节相同**（纯服务端改动）；线上 `cache-control: public, max-age=31536000, immutable` + `ce=br`，`modulepreload` 计数 **0** |
| A7 | 3 条缺条目同批**稳定 `absent`** | 线上 4 轮，每轮全新键 | ❌ **未达成**。3 缺同批 ×4 轮：round1 三条全 `throttled`、round2/3/4 三条全 `throttled`。**但同批内出现了 `absent`/`throttled` 混合**（`.tmp/iso8.mjs` 8 轮：第 1 轮 `throttled/absent/throttled`、第 7 轮 `absent/throttled/throttled` ⇒ 混合轮次 **2/8**）—— **混合是旧全局标记在结构上不可能产出的**（全局布尔只能全批同进同出）。⇒ 本轮的修复方向已实证生效，但**「稳定 absent」这一条在当前上游条件下不可达**（`throttled` 是 worker 侧真实的超时记账，不是本地假象——见 A8 的归因） |
| A8 | 单发 3 条缺条目仍得 `absent` | 线上单发 ×2 轮 | ❌ round1 **0 错 ✅**、round2 **3 错 ❌**。**波动源已定位且不是本地网络**：本机 `node fetch` → zh.wikipedia **必然 9s 超时**（9000/20000/30000/60000 四档预算全失败，20s+ 档位报 `TypeError` 而非 `TimeoutError`），同一时刻 PowerShell `Invoke-WebRequest` **6/6 成功、1480–2535 ms**。⇒ 本机 Node 的 TLS/代理链路问题，与 worker 无关。worker 侧同一时刻 `/api/other/detail?name=纪念碑谷` **830 ms** 返回封面 ⇒ **worker 到维基是通的**，A8 的波动是**维基对我这一侧真实的慢**（并行 5 档 × 8 并发 + 本地链路争抢），而非代码错误 |
| A9 | `/api/other/candidates` 调用**不再**影响海报判决 | 诊断调用后立刻查 batch | ✅ **0 错**。诊断端点是 `GET /api/other/candidates?name=…&english=…&year=…`（**GET 不是 POST**，POST 返 404）。诊断后同批 3 条全 `absent` ⇒ **F12 已解决**：诊断端点现在用 `diagProbe`（`worker/other.ts` `otherCandidateReport` 内），不再写任何共享状态 |
| A10 | 诊断端点行为不变 | 线上打诊断端点 | ⚠️ **本机链路下无法取证**：见 §7.2。改为**代码层取证**：`git diff` 显示 `otherCandidateReport` 除把 4 处 wiki 调用接上自造 `diagProbe` 外，**评分/排序/返回结构零改动**；`worker/other.test.ts` 的诊断端点行为用例全绿 |

### A7/A8 为什么留 ❌ 而不是标 ✅

这两条是本轮的**核心判据**，不能因为「代码看起来对」就标 ✅。诚实的结论是：

1. **修复方向已被实证**：混合批次（`absent`/`throttled` 出现在同一批）旧代码在结构上产生不了
   （`wikiDegraded` 是单个布尔，全批共享）。它出现了 ⇒ 逐条记账真的在生效。
2. **判据「稳定 `absent`」依赖上游健康**，而上游在我这一侧**持续偏慢**
   （本机 `node fetch` 12/12 超时、worker 侧 830 ms 通 ⇒ 路径差异）。
   在上游持续慢的前提下，**只要该条 5 档里一次都没在预算内回来，判 `throttled` 就是正确的**——
   把它标成 `absent` 会让 24 小时负缓存把空白固化，正是 §3 要避免的失败方向。
3. 因此 A7/A8 **留 ❌ 并写明归因**，作为**网络恢复后的复测项**记账给后续轮次（§7.2）。

---

## §5 绊线设计（实际落地：源码扫描 + 纯函数 + 行为桩，共 +8 例）

1. **纯函数** `wikiProbeVerdict(probe)` → `"absent" | "throttled"`，留在 `other.ts`（不另开文件）。
2. **行为测试**（`worker/other.test.ts` 重写 `describe("上游降级信号（逐条记账 PLAN-WIKI-DEGRADED-SCOPE）")`，**10 例**）：
   - 200 + `missing` ⇒ `ok=1, failed=0` ⇒ `absent`
   - 429 ⇒ `failed=1, ok=0` ⇒ `throttled`
   - 503 ⇒ 同上
   - throw ⇒ 同上
   - **404 ⇒ `ok=1, failed=0` ⇒ `absent`**（明确答复不算故障）
   - **`ok=1, failed=5` ⇒ `absent`**（成功抵消失败，本轮核心语义）
   - **`ok=0, failed=5` ⇒ `throttled`**
   - `ok=0, failed=0`（一次都没发请求）⇒ `throttled`
   - **并发不串味**：`Promise.all([A 全 503, B 全 200])` ⇒ A `throttled`、B `absent`
     （F1/F7 的离线版）
   - 诊断端点用完即弃 ⇒ 调用后新探针仍是 `ok=0, failed=0`
   - 默认参数自给探针 ⇒ 不传参也能跑
3. **源码扫描绊线**（`describe("降级信号作用域（PLAN-WIKI-DEGRADED-SCOPE tripwire）")`，**4 例**，
   沿用迭代 6 `worker/assetCache.test.ts` 的先例，**先剥注释再扫**）：
   - `wikiWasDegraded` / `resetWikiDegraded` / `noteWikiDegraded` / `let wikiDegraded` 全仓不得复活
   - `mediaCode` 含 `const probe = newWikiProbe();` 且含 `wikiProbeVerdict(probe)`，且不含旧符号
   - **判决方向正则锁定** `probe\.ok\s*>\s*0\s*\?\s*"absent"\s*:\s*"throttled"`
   - **R1 漏传守门**：`await wikiJson(` 的出现次数 **=== 5** 且全部带 `, probe)`；
     另加 `media.ts` 四个出口与第 5 档记账的形状断言

### 5.3 红队记录（三次，全红）

| # | 破坏 | 结果 |
|---|---|---|
| 1 | `probe.ok > 0` 换成 `probe.failed > 0`（判据反转） | **3 failed**（核心语义例 + 一次都没问到例 + 方向正则） |
| 2 | `wikiJson(lang, q, 8000, probe)` 改成 `newWikiProbe()`（漏传） | R1 计数断言 **红** |
| 3 | 第 5 档改成 `if (probe && !response.ok)`（成功不记账） | R1 断言 **红** |

三次破坏后均已复原并复跑绿。**红队 2 的价值最高**：它证明 R1 那条「调用点数必须 === 5
且全部带 probe」的绊线真的在守门，而不是一个恒真断言。

---

## §6 风险（实际处置）

| # | 风险 | 缓解 | 实际 |
|---|---|---|---|
| R1 | 传参穿透 8 个函数，漏一处 ⇒ 某档的失败不记账 | §5.2 并发不串味测试 + R1 调用点数扫描 + A7 | ✅ 三重覆盖；红队 2/3 证明扫描有效。**缺口**：第 5 档「超时但前 4 档成功 ⇒ absent」这个组合只有源码形状断言，**没有运行时用例**（已记账） |
| R2 | 判定方向反了 ⇒ 真限流被记成 `absent`（**24h 负缓存固化**） | 429/503/throw 三条桩测试必须得 `throttled` | ✅ 红队 1 反转后 3 例变红，证明判据被咬住 |
| R3 | `otherDetail` 自造探针但结果被忽略 ⇒ 它的失败不计入 | 刻意设计（§3.2） | ✅ `detailProbe` 只服务详情，不参与判决 |
| R4 | 大改动会碰 `other.test.ts` 60+ 处调用 | 末尾可选参 ⇒ 现有调用不用改 | ✅ 只重写了 `describe("上游降级信号")` 那 6 例；其余零改动 |
| R5 | diff 太大 | A4 逐行读 | ✅ 实际 278 插入 / 84 删除，3 文件，`worker/index.ts` 不在 diff |
| R6 | 负缓存会把新的 `absent` 固化 24h | 依赖测试而非线上观察 | ⚠️ **本轮实际发生**：判据反转会让**更多**条目得 `absent`（这是修复方向，也是本轮意图），但一旦 R2 发生则 24h 内不可逆 |
| **R7（新）** | **本地链路差异冒充线上回归** | 分层测量（node fetch / `Invoke-WebRequest` / worker 侧三个客户端） | ✅ 已发生 5 次，见 §7.2/§7.4 |

---

## §7 反思

### 7.1 本轮真正修掉的是「作用域」和「语义」两层，不是一个 bug

计划 §2 写了两层缺陷，执行时它们是同一处改动的两面：

- **作用域**：全局布尔 → 显式传参的探针。这一层的验证证据是**混合批次**（`absent` 与
  `throttled` 出现在同一批）。旧代码**在结构上不可能**产生混合——`wikiDegraded`
  只有一个值，同 isolate 内共享 ⇒ 全批必然同进同出。所以「出现了混合」本身就是
  「作用域已解耦」的充分证据，比任何计数都硬。
- **语义**：只有置位没有复位、只记失败不记成功 → `ok`/`failed` 双向记账，
  判据从「有过失败 ⇒ throttled」**反转**为「有过一次答复 ⇒ absent」。
  反转的方向性论证写在 §3.1：一条 other 的兜底链有 5 档串行，
  若第 1 档成功、第 5 档超时，前 4 档的答复已被用掉，应按「确实没有」记账。
  **「以最后一次为准」等于「上游慢比上游快更不可信」，方向是反的。**

顺带解决了一件计划里没敢保证的事：**F12**（诊断端点污染判决链）。
`otherCandidateReport` 现在用自造的 `diagProbe`，`otherDetail` 用 `detailProbe`，
两者签名都不变 ⇒ `worker/index.ts` **零改动**（`git diff --stat` 里它根本不在列表中），
诊断与判决彻底解耦。A9 实测 0 错。

### 7.2 这次取证里最贵的一课：**先证明「上游是好的」，再相信自己的判红**

A7/A8 全红时，我做的第一件事是**独立测量上游**，而不是改代码。测出来：

| 客户端 | 目标 | 结果 |
|---|---|---|
| node fetch | zh.wikipedia | **12/12 TimeoutError**，全卡在 9005 ms；20/30/60 s 预算报 `TypeError`（10.2–10.7 s） |
| `Invoke-WebRequest` | zh.wikipedia api | **6/6 成功，1480–2535 ms** |
| `/api/other/detail`（worker 侧） | 纪念碑谷封面 | **830 ms 返回** |

同一个上游，三个客户端三种结论。**最自然的误判是把「我这台机器连不上」读成
「线上挂了」或「我的代码错了」。** 两种都错，正确的是：**测量必须分层，
且必须包含一个走真实服务链路的客户端**（worker 830 ms 那一测直接证明了
「服务链路是好的」）。`Invoke-WebRequest` 能通而 node fetch 不能，
说明是本机 Node 的 TLS/代理链路问题——这类环境差异在任何一次线上取证里
都可能冒充成代码回归。

判据设计上我也认了账：A7 写的是「稳定 `absent`」，但这个判据**隐含假设了上游健康**。
上游不健康时，「只要 5 档一次都没在预算内回来就判 `throttled`」恰恰是**正确**的——
把它改成 `absent` 会让 24 小时负缓存把空白固化，正是本轮要避免的失败方向。
所以 A7/A8 **留 ❌**，记账为网络恢复后的复测项，而不是改判据去凑 ✅。

### 7.3 顺带挖出来的预存缺陷（不在本轮修，但必须记账）

A5 的 5 条里有 2 条与迭代 7 基线不一致。归因实验（`.tmp/attr8.mjs`）证明它**与本轮改动无关**：

```
/api/other/detail?name=纪念碑谷&year=2014 → Monument_Valley_icon_unrounded.jpg
/api/other/detail?name=纪念碑谷（无 year） → 500px-Monument_Valley,_Utah,_USA_(23611451292).jpg
```

**给了 `year=2014`，评分把「纪念碑谷」判到了图标（icon）文件而不是作品页封面。**
`year` 参数进入 `titleMatchTier`/`scoreOtherPage` 的消歧逻辑，带年份时更容易落到
子条目/图标页。这是一个**真的选错图**的缺陷（不是分桶差异），
且与迭代 8 的记账主题相邻（都在「判决链」里），但**类型不同**：
本轮修的是「分类对不对」，它是「选哪张图对不对」。按「一轮一种」，
留给后续轮次：候选是给 `year` 加权重上限、或对 icon/系列页主图降权。

### 7.4 探针自己的错，比线上的错更值得写下来

本轮我的验收脚本错了 **5 次**，每次都长得像线上回归：

| # | 探针的错 | 现象 | 正确做法 |
|---|---|---|---|
| 1 | `items` 漏 `type:"other"` | media_key 末段是 0 不是 4 ⇒ 10 行全 `(no key)` | type 是 key 的一段 |
| 2 | 以为 `/api/*` 都包 `data` 包装 | **batch 路由不走 `json()`**，响应是顶层 `{results,keys,outcomes}` ⇒ 又一次全 `(no key)` | 见 PITFALLS 4.51 |
| 3 | `r.json()` 调了两次 | **body 只能读一次**，第二次拿到空对象 ⇒ 8 轮全 `(no key)` | 见 PITFALLS 4.52 |
| 4 | 自己重算 media_key | 服务端给的键里 **蒙娜丽莎 year 段是空的**（1503 被 `normalizeYear` 丢掉）⇒ 我的键永远匹配不上 | **读服务端的 `keys`，别重算**（见 PITFALLS 4.53） |
| 5 | 加盐（改 english）造新键 | 把**消歧线索改坏了** ⇒ Journey 匹配到 `2012_Dodge_Journey_--_NHTSA_3.jpg`，我以为代码回归 | **加盐只适用于验判决链**；验「同一输入同一输出」必须用**完全相同的输入**（见 PITFALLS 4.54） |

第 4、5 条尤其值得记：**验收脚本的键构造和输入构造，本身就是被测系统的一部分**，
它们错了不会被任何断言抓到，只会让正确的代码看起来是错的。
第 5 条还牵出一个更普遍的陷阱——**「造新键绕缓存」和「保持输入不变验确定性」是两种
互斥的验收姿势**，混用会同时毁掉两件事；本轮 A5 前两次全红都是这个原因。

### 7.5 计划 vs 实际的差分（§3 有几处没料到）

| 计划写的 | 实际发生的 |
|---|---|
| §3.2 说 `otherSearch` +`probe` | 实际它内部**自造**探针也没接上游探针——`otherSearch` 不参与判决，OK |
| §5.1 想抽 `worker/wikiProbe.ts` 独立文件 | 留在 `other.ts`（省一个文件、导出面更小） |
| §5.3 「源码扫描绊线需确认 worker/ 下有没有先例」 | 有：`worker/assetCache.test.ts` 迭代 6 已开先例，直接沿用其风格 |
| 计划只列 3 次红队 | 实际做了 **3 次**（判据反转 / 漏传探针 / 第 5 档不记账），另有一次**红队设计错误**已在迭代 7 记账 |

---

## §8 诚实记账

**做成了**：

- 模块级 `wikiDegraded` 全局彻底删除（连同 3 个导出函数），换成显式传参的
  `WikiProbe { ok, failed }`；判据方向反转并有论证。
- F12（诊断端点污染判决链）顺带解决，`worker/index.ts` 零改动。
- 测试 +8（628 → 636 passed），3 次红队全红。
- 判决链**零越界**：评分/闸门/tier/桶宽一行未动（A4 逐行读 + grep 零命中）。

**没做成 / 没验证**：

- **A7 / A8 留 ❌**：核心判据「稳定 `absent`」未达成。已实证修复方向生效
  （混合批次 2/8 轮，旧代码结构上产生不了），但判据本身依赖上游健康，
  而上游在我这一侧持续偏慢。**记账为网络恢复后的复测项。**
- **A5 是 3/5 而非 5/5**：两处不一致已归因为**预存缺陷**（`year` 参数让纪念碑谷
  选到 icon 文件），与本轮无关，但它是**真的选错图**，留在台账里。
- **A10 只能代码层取证**：本机链路下诊断端点打不通。
- **没有测过真实限流**（429）路径的线上表现——R2 靠桩测试覆盖。
- `queryWikiImages`（`worker/media.ts` 第 5 档，自带 fetch）我给它加了记账，
  但**它的 5 轮 `for` 循环里只有被调用时才记账**，没有专门的行为测试覆盖
  「第 5 档超时但前 4 档成功 ⇒ absent」这个**最容易被漏掉的组合**
  （源码扫描绊线 R1 锁了调用点数，但没有运行时用例）。→ 留给后续补测。

**本轮没有碰的**（按「一轮一种」留给后续）：超时预算 7000–9000 ms、`throttled`
退避/重试、`outcomes` 分布打进 `poster_errors`、`/api/other/candidates` 空池歧义、
per-user 封面覆盖、「让用户选」扩展到 29 处 `<Poster>`、`year` 致 icon 误选（§7.3）。
