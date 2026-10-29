# PLAN · 消歧记忆：一次裁决，作用于这一页所有同名作品（PLAN-COVER-MEMORY）

> 迭代 9/20 · **创意类**（轮换位：8 优化 → 9 创意）
> 题源：迭代 8 台账下一步①「把 `outcomes` 分布打进 `poster_errors`」——**换题**，理由见 §0.1。

---

## §0 为什么这一轮做这一件

### 0.1 为什么没做台账指定的那件

台账下一步①是「把 `outcomes` 三态分布打进 `poster_errors` 的新 source」。勘查后发现**它已经做了一半**：`worker/index.ts` 的批次路由**已经在按三态分流写库**（`throttled` / `no_poster_found` 两个分支都挂在 `outcomes[key]` 上）。真正没被记录的是 `absent` 与 `found`——而它们**不是错误**，是正常结果，记它们需要**新表或新列**（CONVENTIONS §5 要求同步 `docs/ARCHITECTURE.md`，且写路径复杂度上一个台阶）。

我确实先看了它，但它的前提（"缺三态打点"）**不成立**，于是换题。换题时发现的缺口更大，而且**不需要碰判决链路**。

### 0.2 真正的问题：UI 承诺了一件代码没做的事

`src/components/ArtworkDetail.tsx:41-44` 的注释写着：

> 用户在「让用户选」里换封面后回调……于是这个弹窗的 `<Poster>` 与**所有已经渲染过该作品的地方同时生效**。

而 `src/App.tsx:1672-1676` 实际做的事是：

```ts
onCoverChange={(url) =>
  setDetailWork((current) => current ? { ...current, work: { ...current.work, posterUrls: [url] } } : current)
}
```

**它只改了 `detailWork` 这一个对象。** 榜单、画廊、对比视图里那些**已经渲染过同一件作品**的地方，各持有自己的 `work` 对象拷贝（`HomeView.tsx:492`、`GalleryWall.tsx:95`、`ProfileView.tsx:697` 都直接读 `work.posterUrls`），**一个都不会被更新**。

于是 `src/components/CoverChoice.tsx:200` 那句

> 「已保存，之后都用你选的这一张。」

在**本次页面会话内**是一句**假话**——弹窗背后的那张卡片，还是旧封面。

### 0.3 第二个问题（同一个根因）：裁决只活一次

`POST /api/other/cover-choice`（`worker/index.ts:2670-2708`）收到的 `wikiTitle`——**"用户认为这个名字指的是哪一部作品"这个事实**——只出现在响应里（`:2708`），**不落盘**。落盘的只有那张图的地址，键是 `posterMediaKey(title, english, "other", year)`。

后果：榜单里若还有第二件同名作品（另一个 `Journey`、另一件 `日常幻想`），**同一次裁决对它的效力立刻归零**。而下一轮它会**重新问一遍**同样的问题（候选列表逐字相同），用户得**再点一次**。

### 0.4 一句话根因

**「消歧」被实现成了"往一个 state 对象上打补丁"，而不是"记下一个事实"。**
补丁只活在被补丁的那一个对象上，事实没有落进任何**所有海报都会经过的地方**。

### 0.5 「一轮一种」与范围账（不做的事）

| 不做 | 为什么 |
|---|---|
| 动判决链路一行 | 迭代 8 的纪律：判决链路每轮只改一处，且必须单独验收。本轮**零改动** `worker/` 下任何文件。 |
| 新增 D1 表 / 迁移 | 零迁移。会话内的真相本来就该在会话内存里；跨会话的真相服务端已经有（`poster_urls` 行）。 |
| 让继承**覆盖**已有封面 | 见 §3.3 的非破坏闸。只填**空格**。 |
| 把「让用户选」扩展到 29 处 `<Poster>` 调用点 | 迭代 5 的遗留。本轮**反向利用**这 29 处而不是改它们。 |
| per-user 隔离 | 迭代 5 遗留风险②（`poster_urls` 全站共享），产品决策、scope 大。 |

---

## §1 事实表（全部来自源码，非推断）

- **F-1** `src/App.tsx:1672-1676` 的 `onCoverChange` 只 patch `detailWork` 一个对象。`src/App.tsx:1666-1678` 是 `<ArtworkDetail>` 唯一的挂载点。
- **F-2** `src/components/ArtworkDetail.tsx:140-148`：`<CoverChoice>` 的挂载条件是 `choiceAppliesToKind(detail.kind) && onCoverChange`。**`onCoverChange` 存在即视为功能开启。**
- **F-3** `src/components/CoverChoice.tsx:164-167` `pick()` 的顺序是 `setChosen` → `setSaveError("")` → `onPicked(choice.url)`。**视觉生效先于网络往返**（`src/ui-fixes.test.ts:555` 用 `indexOf` 顺序钉住）。
- **F-4** `src/components/CoverChoice.tsx:199-201` 的成功文案：「已保存，之后都用你选的这一张。」/ "Saved — this cover is used from now on."
- **F-5** `src/components/CoverChoice.tsx:220-224`：候选项来自 `memo.report.candidates`，每项 `{title, year?, hasCover}`；**`title` 就是 wikiTitle**。
- **F-6** `src/components/Poster.tsx:327` `const urls = [...new Set([...(work.posterUrls ?? []), ...resolved])];` —— **所有 29 处 `<Poster>` 的封面候选都从这一行出**。`url = urls.find(c => !failed.has(c))`（`:328`）⇒ **数组顺序即优先级**。
- **F-7** `src/components/Poster.tsx:62-64` `batchKey(work, kind) = posterMediaKey(work.title, work.subtitle ?? work.title, TYPE_BY_KIND(kind), work.year)`，直接复用 `shared/posterKey.ts` 的唯一实现（含 `other` 维度的代数 `|4`）。
- **F-8** `shared/posterKey.ts:60` `OTHER_POSTER_GENERATION = "4"`。**代数 +1 ⇒ 全部已写下的用户选择同时孤儿化。**
- **F-9** `src/components/Poster.tsx:140-163`：`POSTER_CACHE_KEY = "art-rank:poster-cache"`，`POSTER_CACHE_MAX = 500`，满了**淘汰最旧的一半**，写失败静默跳过（隐私模式/配额满）。
- **F-10** `src/lib/coverChoice.ts:51` `REPORT_CACHE_KEY = "art-rank:other-choice-report"`，`CACHE_LIMIT = 200`，`readCachedReport`（`:76-90`）**只校验** `offer` / `band` / `poolSize` / `coverCount` 四个字段 ⇒ **往缓存值里加新字段完全兼容**（迭代 5 留下的缝）。
- **F-11** `src/lib/coverChoice.ts:32-36` `shouldOfferChoice` = `band ∈ {shaky, weak} ∧ poolSize ≥ 2 ∧ coverCount > 0`。**这是本方案的安全阀**（§3.4）。
- **F-12** `vitest.config.ts`：`environment: "node"`，只 include `src/**/*.test.ts` `worker/**/*.test.ts` `shared/**/*.test.ts`（**无 .tsx / 无 jsdom / 无 testing-library**）⇒ 判定必须落进 `src/lib/*.ts` 纯函数。
- **F-13** `src/lib/coverChoice.test.ts:84-91`：已有 `vi.stubGlobal("sessionStorage", {getItem,setItem,removeItem})` 的手写桩 ⇒ 本轮照抄，不引 jsdom。
- **F-14** `worker/other.ts:892` `confidence.pickedTitle: string | null` **已经在 `/api/other/candidates` 响应里**（`otherCandidateReport`，`:1001-1007`）——**服务端本来就知道自己判成了哪个条目，只是不告诉前端**。本轮**不需要**它（见 §3.2 的判据为何必须避开它）。

---

## §2 根因

`ArtworkDetail` 的文档注释承诺了「一次裁决，处处生效」，实现却选了**唯一一种不可能实现这个承诺的方式**：把裁决结果写进**一个 React state 对象**，而"处处"意味着**几十个各自持有 `work` 拷贝的对象**。补丁打在 N 个地方的一处，剩下 N−1 处照旧。

⇒ **正确的落点不是任何一个渲染方，而是所有渲染方都会经过的那一处**：`src/components/Poster.tsx:327`。

---

## §3 方案

### 3.1 一句话：把「补丁」换成「事实」，事实存在**唯一收口处**读的地方

- **现在**：`App.tsx` 把 url 写进 `detailWork.work.posterUrls` ⇒ 只有这一个海报变。
- **本轮**：`CoverChoice.pick()` 记下一次事实（`url` + `wikiTitle` + 名字），`Poster` 在**第 327 行构造候选数组时**先读这份事实 ⇒ **29 处调用点零改动，全部生效**。

### 3.2 新模块 `src/lib/coverMemory.ts`（判据全部纯函数，可测）

```
COVER_MEMORY_KEY = "art-rank:cover-choice"        // sessionStorage，与 Poster 的海报缓存同一处真相
coverMemoryKey(title, english, year)             // = posterMediaKey(..., "other")，复用 shared 唯一实现（F-7）
rememberCoverChoice({title, english, year, url, wikiTitle})
    ├─ 精确行  coverMemoryKey(...)            → { url, wikiTitle }
    └─ 名字行  `other|name|<seg(title)>`      → { url, wikiTitle }   ← 同名继承的索引
recallCoverChoice(key, title): string | null
    1. 精确行命中 ⇒ 返回
    2. 否则名字行命中 ⇒ 返回（继承）
    3. 否则 null
clearCoverMemory()
```

四条设计决定，每条都有依据：

1. **键用 `batchKey`（服务端 media key），不用 `Poster.tsx` 的本地 `posterKey`。** 前者是跨会话、跨端一致的真相（与服务端回显的 `keys`、D1 行的 `media_key` 同一口径），后者只活在本地缓存里。
2. **名字行的键里没有 wikiTitle。** wikiTitle 存在**值**里。判据是"**这个名字被人裁决过**"，不是"这个名字必须等于某个固定条目"——后者在用户第二次改选时会自我否定。
3. **同一条记录里放两行、一次写入。** 不做两个存储、不做两次写。
4. **坏数据一律当作没记过**（同 `readPosterCache` 的 `catch → null` 纪律），且**有上界**（同 F-9 的淘汰纪律）。

**为什么不用 `confidence.pickedTitle`（F-14）做判据**：那要求前端先知道"这条作品**本来**会被判成哪个条目"，才能判断用户的选择是否与之一致。但①那要多一次 `/api/other/candidates` 请求才能拿到；②更根本的是，**用户选的就是要推翻那个判定的**——拿被推翻的对象当判据，逻辑上自相矛盾。本轮记的是**用户裁决的事实**，不是"与服务端判定的差异"。

### 3.3 ⚠️ 非破坏闸：继承**只填空格**，绝不覆盖

`Poster.tsx` 里：

```
1. 记忆（精确）      ← 新增，排在最前
2. 记忆（同名继承）   ← 新增，且**仅当 1 为空且下面全空时**
3. work.posterUrls   ← 原有
4. resolved          ← 原有
```

**为什么继承要排在 `work.posterUrls` 之后**：一件同名作品如果**已经有一张确定的封面**（它自己的年份让服务端判对了），那它就没有问题；而如果它没有封面（`absent`/`throttled`），用户对同名的裁决就是**目前唯一可用的信息**。这条闸让继承**在结构上不可能**把一张对的封面换成错的。

**代价要说清**：因此 F-a 里"用户选了 2012 版、另一件同名作品仍显示它自己那张（可能也不对）的封面"**这一半不修**。这是有意的保守选择，写进 §6。

### 3.4 安全阀：传播只可能发生在"我们本来就不确定"的地方

记忆的来源只有一个：`CoverChoice` 的 `pick()`。而 `CoverChoice` 只在 `shouldOfferChoice` 为真时渲染（F-11）——`band ∈ {shaky, weak} ∧ poolSize ≥ 2 ∧ coverCount > 0`。

⇒ **一个用户裁决能被传播，前提是我们本来就判不准这个条目。** `exact` / `strong` 的条目**根本不会产生记忆**，也就**不可能被别人的记忆影响**。这条不需要新代码，它是迭代 5 已经建好的闸。

### 3.5 文案必须跟着机制改（一次机制，两个文案）

| 现在 | 本轮 | 为什么 |
|---|---|---|
| 「已保存，之后都用你选的这一张。」/ "Saved — this cover is used from now on." | 「已保存，这一页里所有《名字》都用这一张。」/ "Saved — every **{title}** on this page now uses this cover." | F-4 原本在页内是假话；改完之后页内**真的**成立。跨会话由服务端那行保证，原话已覆盖。 |
| 继承发生时**不加任何提示** | — | 见 §6 R-2：加提示等于把内部机制摊给用户，而继承**只在空格上发生**（用户看到的是"本来空着的一格现在有图了"），这是**预期的改善**而非需要解释的异常。 |

### 3.6 不动的三样（写在这里是为了下次不再重新讨论）

- `worker/` 零改动 ⇒ 判决链路零风险。
- `OTHER_POSTER_GENERATION` 不动 ⇒ 已有选择不会孤儿化（F-8）。
- `App.tsx:1672-1676` 的 `onCoverChange` 补丁**保留**：它是**视觉即时生效**的那一枪（网络往返之前就变），而记忆是**真相**。两者不冲突，删掉补丁会让交互变慢。

---

## §4 验收表

| # | 判据 | 结果 |
|---|---|---|
| A1 | 五道门禁全绿：`tsc -b` exit 0 / `lint` 0 errors 且 warnings 不增 / `format:check` / `vitest` 全过 / `build` 成功 | ✅ `tsc exit=0`；`lint` **29 problems (0 errors, 29 warnings)** = 基线；`format:check` All matched files；`vitest` **660 passed / 9 skipped (669)**，47 files（基线 636 ⇒ **+24**）；`build` ✓ |
| A2 | 红队全红（见 §5.3，实际做了 **5 个**） | ✅ 5 个全红，见 §7 的「红队第 5 次翻车」 |
| A3 | `coverMemory.test.ts` 全过，且迭代 5 的 `coverChoice.test.ts`（21 例）与 `worker/coverChoice.test.ts` 仍全过（证明没碰坏缓存契约） | ✅ `coverMemory.test.ts` **19 例**；`src/lib/coverChoice.test.ts` **21 例**全过 |
| A4 | **零回归**：`ui-fixes.test.ts` 的既有断言一条不少地仍成立 | ✅ `src/ui-fixes.test.ts` **74 例全过**（既有 18 + 空封面三态 7 + 静态资源缓存 3 + 本轮 5） |
| A5 | `worker/` 与 `shared/` **零改动**：`git diff --stat` 里不出现这两个目录 | ✅ 只有 `CoverChoice.tsx`、`Poster.tsx`、`ArtworkDetail.tsx`、`ui-fixes.test.ts` + 本轮 2 个新文件 |
| A6 | 主包增量 ≤ 1.5 KB raw | ✅ `index-BV_vjOsd.js` **410.40 kB / gzip 137.05** ⇒ +1.32 raw / +0.51 gzip（基线 `index-CZFSUmC8.js` 409.08 / 136.54）。线上同名产物 `index-CGd3gcxH.js` **410.50 kB / gzip 137.09**，`ce=br`，`public, max-age=31536000, immutable`，`modulepreload` 计数 **0** |
| A7 | **线上实测（浏览器外可判定的那一半）**：`POST /api/other/cover-choice` 的三道闸顺序没变 | ✅ 三段实测依次为 **403 `cross_origin_forbidden`**（不带 `origin` 头）→ **401 `auth_required`**（带 `origin`、未登录）。`assertSameOrigin` → `getUserFromToken` 的顺序与迭代 5 完全一致；迭代 5 的 `[...rows.keys()] === posterMediaKey(...)` 不变量由未改动的 `worker/coverChoice.test.ts` 持续保证 |
| A8 | **线上实测（会话内继承）**：同一榜单里两件同名 `other` 作品，裁决其中一件后，另一件原本为空的格子拿到同一张图 | ❌ **留红，只能浏览器里验**。见 §8 第 1 条。浏览器外可判定的替代证据已拿到：线上 bundle 里 `art-rank:cover-choice` / `cover-choice` / `other-name\|` / `sessionStorage` 四个痕迹**全部存在** ⇒ 发上去的东西等于我审过的东西。但「第二格拿到同一张图」这一条**没有真实证据**，不标 ✅ |
| A9 | 诚实记账：`npm run lint` 仍是 29 warnings | ✅ 中途一度 **30 warnings**（提取 `writeRows` 后忘了用），修掉后回到 29；`format:check` 一度报 4 files 未格式化，跑 `npm run format` 后通过。两段过程都记在这里 |

---

## §5 绊线设计

### 5.1 纯函数测试（`src/lib/coverMemory.test.ts`，新建）

1. 精确往返：`rememberCoverChoice` 后 `recallCoverChoice(精确键)` 返回该 url。
2. **同名继承**：A(title=T, year=2012) 记下 ⇒ `recallCoverChoice(键B)`（同 T、不同 year）返回同一 url。
3. **不同名不继承**：记 T1，T2 查 ⇒ `null`。
4. **精确优先于继承**：同名两行都在 ⇒ 精确行胜出。
5. **空 `wikiTitle` 仍然记**（裁决本身有效，wikiTitle 只是标注）。
6. 上界：写入 > `COVER_MEMORY_MAX` 条 ⇒ 最早的条目被淘汰，且**最新的仍在**。
7. 坏数据：`"{坏 json"` / `"[]"` / `"null"` / 值缺 `url` ⇒ 一律 `null` 且不抛。
8. `clearCoverMemory()` 后 ⇒ `null`。
9. 键同口径：`coverMemoryKey` 与 `posterMediaKey(t, e, "other", y)` **逐字相等**（`posterKeyYear` 的 1800–2200 口径必须生效：1503 被丢 ⇒ 两端都丢）。

### 5.2 源码扫描绊线（`src/ui-fixes.test.ts` 新增 `describe`，5 例）

沿用既有 `stripComments` 纪律（**先剥注释再扫**，否则我写的解释性注释会把断言喂绿）：

1. **唯一收口处**：`Poster.tsx` 的候选构造仍是 `const urls = mergeCoverRecall(`，且剥注释后仍能匹配到 `work.posterUrls ?? []`；记忆只在 other 维度生效（`mediaTypeForKind(kind) !== "other"` 提前返回）。
2. **先记事实再走视觉**：`ArtworkDetail.tsx` 剥注释后匹配 `rememberPickedCover(detail.work, detail.kind, url, wikiTitle);\s*onCoverChange(url);`；`CoverChoice.tsx` 含 `onPicked(choice.url, choice.title)`；`App.tsx` 仍含 `onCoverChange={(url) =>`；**反向断言 `CoverChoice.tsx` 不含 `rememberCoverChoice`**（记忆不许在拿不到 work 对象的那一层写）。
3. **文案不许过度承诺**：不含旧句「之后都用你选的这一张」，含 `这一页里所有《${title}》都用这一张` / `on this page now uses this cover`。
4. **省一次维基回源**：含 `const userDecided = memorySuppliesCover(recalled)`、剥注释后匹配 `!hasStoredPosters && !userDecided &&`、依赖数组含 `userDecided`。
5. **非破坏闸仍在**：`coverMemory.ts` 含 `return urls.length ? [...urls] : [recalled.url]`，且 `coverChoice.ts` 的 `band !== "shaky" && input.band !== "weak"` 没被本轮放松。

### 5.3 红队（每次都必须**删掉字面量**，不是只删语义）

| # | 手法 | 期望 | 实测 |
|---|---|---|---|
| R-1 | 删掉 `Poster.tsx` 收口处的 `mergeCoverRecall(...)`，退回纯 `[...new Set([...])]` | `ui-fixes` 「唯一收口处」红 | ✅ 1 failed |
| R-2 | 删掉 useEffect 里的 `!userDecided &&`（让裁决过的条目又去问上游） | `ui-fixes` 「省一次维基回源」红 | ✅ 1 failed |
| R-3 | 把 `ArtworkDetail.tsx` 的 `onPicked` 退回 `onPicked={(url) => onCoverChange(url)}`（记忆写入点消失） | `ui-fixes` 「记事实先于视觉」红 | ✅ 1 failed |
| R-4 | 删掉 `recallCoverChoice` 里的精确行分支（只查同名行） | `coverMemory.test.ts` 2 例红（精确往返 + 精确优先） | ✅ 2 failed |
| R-5 | 把 `mergeCoverRecall` 的两个分支整体退化（去掉 `exact` 分支，精确行也按继承处理） | `coverMemory.test.ts` 2 例红 | ✅ 2 failed |

---

## §6 风险

- **R-1 同名不同作品被误继承**（迭代 8 的 F-e2）。缓解：`shouldOfferChoice` 只在"我们判不准"时开口；且继承只填空格。**残留**：用户在弹窗里为 `Journey` 选了 2012 版，榜单里另一件恰好无封面的同名 `Journey` 会拿到这张图。
- **R-2 继承没有任何提示**（§3.5）。这是**有意的**：格子从空变成有图本身就是改善。若日后有人报"怎么这张图不是我以为的那部"，再回来加提示行并记 `poster_errors` 新 source。
- **R-3 记忆只活在本次会话**。跨会话由服务端 `poster_urls` 行负责——但**继承不跨会话**（名字行在 sessionStorage）。这是刻意的：跨会话传播等于**替未来的用户做决定**。
- **R-4 sessionStorage 配额**：海报缓存 500 条 + 记忆 100 条。记忆的值只有 url + wikiTitle（~200 B），100 条 ≈ 20 KB。配额满时静默跳过（同 F-9）。
- **R-5 与海报缓存的交互**：`Poster.tsx` 空结果**不写** `resolvedPosters`、不写 sessionStorage；记忆**会**让下一批这些格子非空 ⇒ 记忆存在时不再重发解析请求。这是**少发请求**，不是多发。**注意方向**：记忆只可能让格子从「空」变「非空」，不可能把非空变空。

### 6.1 计划的骨架有一处没对：先记后走视觉的**层**（执行时改了）

§5.2 第 2 条原写「`CoverChoice.tsx` 里 `rememberCoverChoice(` 在 `onPicked(` 之前」。执行时改成 **反向断言 `CoverChoice.tsx` 不含 `rememberCoverChoice`**，写入点搬到 `ArtworkDetail`。理由见 §7.1——组件手里的键与服务端不同源。**计划的绊线写错了，代码没写错；这是计划阶段就该读一遍调用链的信号。**

---

## §7 反思

### 7.1 真正的收获：**「记住」和「记住在哪一层」是两件事**

第一版我把 `rememberCoverChoice` 直接放进 `CoverChoice.pick()`——组件里就有 `title/english/year`，看起来天经地义。写完立刻错：`CoverChoice` 只在 `ArtworkDetail` 里挂一次，**它的键是自己拼的 `title|year`，与服务端 `posterMediaKey(title, english, "other", year)` 不同源**。症状是「页内看着好使、刷新全丢、零报错」。

真正的教训不是「拼键要小心」（PITFALLS 早就有了），而是：**当一件事需要「和服务端同源的键」时，正确的归属地不是「恰好手里有那几个字段的那个函数」，而是「那个持有完整对象的层」。** 写入口与读入口因此必须**同处一个文件**（`Poster.tsx` 的 `recalledCover` / `rememberPickedCover`），这样「键的算法改了」只会有一个地方需要跟着改。

顺带把 `onPicked` 的签名从 `(url)` 改成 `(url, wikiTitle)`：`wikiTitle` 是「这个名字指的是哪部作品」这个事实的另一半，`CoverChoice` 手里有、之前扔了（写进请求体、发回来当成功标记、又扔）。组件不存它，只往上交——**存哪儿是消费者的决定，不是生产者的**。

### 7.2 两次换题，都是因为**先去量了而不是先去想**

- 台账指定的题（`outcomes` 分布进 `poster_errors`）在读代码后被否：批次路由**已经**按 `throttled` / `no_poster_found` 分流写库了，缺的 `found`/`absent` 不是错误、要新表。一个计划里写着「顺手记一下」的活，落地是**一次迁移**——那就该另起一轮，不是硬塞进来。
- 判据也换过一次：原判据是「候选的 wikiTitle 等于服务端判出的 `wikiEntry`」，读代码发现**前端从来拿不到 `wikiEntry`**（后端从不下发），判据不可执行。换成「**用户裁决过的那一件优先，且同名继承只填空格**」——可判定，且直接对应用户能看见的现象。

### 7.3 红队第 5 次翻车：我的「变异」是空变异

R-5 第一次我把 `mergeCoverRecall` 里的 `if (recalled.exact) A; else B;` 改写成 `if (!recalled.exact) B; else A;`——**这是同一个函数**。测试当然全绿。我当时的错误结论是「断言不够强」，于是去加测试；加了还是绿，才回头意识到**变异本身没有语义**。

这比迭代 7 的教训更进一步：**红队全绿有两种原因，排查顺序不能反。** 先问「我的变异有没有真的改掉行为」，再问「我的断言够不够」。判据是**行为可分辨**：候选数组里已有别的图时，精确行与同名行的输出**必然不同**——所以变异必须落在「精确行的图 vs 继承行的图不是同一张」这个反例上，而不是落在分支的书写顺序上。

### 7.4 顺手修掉的两个真 bug（都是我自己写的）

1. **`persist` 早退导致整份记忆只活在内存副本。** 原写法在 `setItem` **之前**判断上界并 `return` ⇒ 刷新即全丢，而页内一切正常、零信号（比崩溃更难查）。改成**先写、再淘汰**。是「两行并存」那条测试转红把它抓出来的。
2. **`writeRows` 提取后忘了用** ⇒ lint 多出第 30 个 warning。**基线 warning 数本身就是一张网**：任何一次新增 warning 都该当场处理，而不是等到收尾。

### 7.5 A8 留红的诚实说法

「两件同名作品里第二格拿到同一张图」这条**只有浏览器里能验**。我在浏览器外能拿到的最强证据是：线上 bundle 里 `art-rank:cover-choice`、`other-name|`、`sessionStorage` 四个源码痕迹全在 ⇒ 部署的产物等于我审过的产物。但**「产物里有代码」不等于「功能成立」**，所以 A8 留 ❌。这也是迭代 7 遗留的浏览器 E2E 缺口的第 N 次现身——它是本仓最大的结构性测试债。

---

## §8 诚实记账

1. **A8 留 ❌，且没有替代性的浏览器验证。** 见 §7.5。要真正关掉它需要一个 Playwright 级的一次性脚本（导入含两件同名 `other` 作品的清单 → 裁决一件 → 断言第二格），**那是独立一轮的活**（新增 devDependency + 契约）。
2. **R-1 同名不同作品的误继承，本轮未解，只是被压到最小。** 用户为 `Journey` 选了 2012 版后，榜单里另一件无封面的同名 `Journey` 会拿到这张图。缓解只有两条：`shouldOfferChoice` 只在「我们本来判不准」时开口，且继承只填空格。**要根治需要比较 wiki 条目而不是名字**——而 `wikiEntry` 从来没下发给前端（见 §7.2）。
3. **收益是个位数，不是大功能。** `shouldOfferChoice` 要求 `band ∈ {shaky, weak} ∧ poolSize ≥ 2 ∧ coverCount > 0`，一次典型使用影响**个位数**格子。所以它是「让迭代 5 的功能不白费」的修复，**不进 `FEATURES.md` 主表**，只在 CHANGELOG 记一笔。
4. **只在本次会话有效。** 跨会话由 `poster_urls` 行负责（那是服务端缓存，全站共享，本轮没碰其语义），但**同名继承不跨会话**。这是有意的：跨会话传播 = 替未来的用户做决定。
5. **`sessionStorage` 里的记忆没有 per-user 隔离**（与 `poster_urls` 全站共享是同一个性质）。同一浏览器换账号登录，另一账号的继承仍在。§3.5 的 UI 文案已经说了「这一页里所有《X》都用这一张」而不是「已保存」——但严格说这是**本地会话事实**，不是账号事实。
6. **本轮没碰判决链路一行。** `worker/` 与 `shared/` 零改动（A5），所以迭代 8 的 `throttled` 判定、`posterKeyYear` 的 1800–2200 口径（**蒙娜丽莎 1503 仍被丢**）全部原样保留。**迭代 8 归因出的 `year` → icon 误选仍未修**，仍是最高优先级的遗留项。
7. **没做的三件**（写在 §0.5，这里再确认一次没偷做）：零 D1 迁移、零 per-user 隔离表、零 `outcomes` 分布记账。