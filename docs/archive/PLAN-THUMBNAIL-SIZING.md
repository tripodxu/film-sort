# PLAN-THUMBNAIL-SIZING · 迭代 3/20（前端类）· 海报缩略图尺寸治理

> 类别：前端（视觉资源管线）｜上一轮：[PLAN-BUNDLE-SPLIT](PLAN-BUNDLE-SPLIT.md)（优化）
> 上一轮：[PLAN-JEV-DISAMBIGUATION](PLAN-JEV-DISAMBIGUATION.md)（创意）
> 本轮起点 commit：`8c67773`

## 0. 一句话

把「要一张小图」写成「要 600px」，被上游**向上取桶**成 960px —— 改成一张
**官方桶表 + 按显示尺寸取不超过上界的最大桶**的显式决策，顺带把「桶宽是
白名单、桶外一律 400」这条硬事实写进代码注释与踩坑档案。

## 1. 事实（全部实测，2026-10-02）

| 编号 | 事实 | 取证方式 |
|---|---|---|
| F1 | Wikimedia 缩略图**只存在于 11 个固定桶宽**：`20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840` | 官方文档 `$wgThumbnailSteps`（`https://w.wiki/GHai` → MediaWiki:Common thumbnail sizes）；并经线上 `/api/image` 代理**逐个实测 11 个全部 200**（20px=0.7KB / 40px=1.4KB / 60px=2.5KB / 120px=7.2KB / 250px=26.6KB / 330px=46.5KB / 500px=114.6KB / 960px=505.2KB / 1280px=957.4KB / 1920px=2324.2KB / 3840px=9011.6KB）；另有 23 个非桶宽度全部失败 |
| F1b | 请求不存在的桶 = 上游 **400**，响应体原文 `Use thumbnail sizes listed on https://w.wiki/GHai` | 直连 `upload.wikimedia.org` 实得；502 只是 `proxyImage` 的 catch（`worker/media.ts:2451-2453`）呈现 |
| F1c | **抽样反推会漏项**：我第一轮只测 [60..1200] 区间，于是漏掉 20/40/1280/1920/3840 五档，得出「只有 6 个桶」的错误结论 | 官方文档与实测区间比对 |
| F2 | `iiurlwidth=600` 会落到**上一个可用桶 960px**（官方语义：Manually-specified sizes are not used; instead, the thumbnail with smallest step that has larger value than requested will be shown） | 线上 `other\|蒙娜丽莎\|蒙娜丽莎\|\|3` 实返 `.../960px-Mona_Lisa....jpg`（505.2 KB） |
| F3 | `iiurlwidth` **不放大**：原图已窄于请求宽度时直返原图（标记 `utm_content=thumbnail_unscaled`） | 线上 Journey / Inside / 纪念碑谷 三条 URL 均无 `/thumb/` 段；把它们与手工拼的 `.../330px-...` 对比 |
| F4 | 「Journey 原图 21.9KB vs 330px 67.6KB」这个 3 倍反超是**手工拼 URL 造出来的**，不是本项目会产生的请求 | 同上 |
| F5 | CSP **早已放行** `thumb.wikimedia.org` | 线上 `GET /` 响应头实测 → 台账旧记「待确认」结清 |
| F6 | other 维度的三处尺寸请求：`:318` `iiurlwidth:"600"`、`:539` 与 `:688` `pithumbsize:"600"` | `worker/other.ts` |
| F7 | movie/book/music 用 `pithumbsize:"1200"` | `worker/media.ts:1328` / `:1483` / `:1510` |
| F8 | `.collection-row` 的整宽封面**是设计不是 bug** | `src/styles.css:56` 注释「Collection Sticker Cards (source view only)」+ `src/views/SourceView.tsx:653` `repeat(${colCount}, minmax(0,1fr))` + `colCount ∈ {2,3,4}`（`src/views/SourceView.tsx:627`、`src/lib/useSorting.ts:119-125`） |
| F9 | **`POSTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000`**（`worker/media.ts:45`）：成功的**错的**结果与 miss 同 TTL，**部署清不掉它** | 线上实测：清掉 D1 全部 16 行 gen4 行、连 `other\|journey\|journey\|2012\|4` 单行也删了，线上仍返错图；而从未缓存过的 `year=2014`/`2015` 立刻返回正确封面 |

## 2. 根因

**把「要一张小图」写成了「要 600px」，而 `iiurlwidth`/`pithumbsize` 的语义是
「至少多宽」，维基只会**向上**取桶：600 → 960。**

于是：
- 对 505KB 的蒙娜丽莎 → 白拿 2 倍线性尺寸（505.2KB vs 114.6KB）；
- 对 22KB 的 Journey → 请求不缩放的 original，浏览器还要自己降采样；
- 而「桶宽是白名单」这条硬事实**在代码里没有任何记录**，下一个维护者写
  `iiurlwidth:"800"` 会得到一个 502 表现成「封面随机消失」的诡异 bug。

第二层问题（**本轮明确不做**）：显示尺寸是前端的事实，服务端看不见。
`Poster` 不带尺寸参数，于是一个尺寸决策缺了。

## 3. 方案

### 3.1 服务端：显式桶表 + 取「不超过上界的最大桶」

在 `worker/other.ts` 新增一处**唯一真相**：

```ts
/** 维基缩略图的**合法桶宽白名单**——官方 `$wgThumbnailSteps`
 * （https://w.wiki/GHai → MediaWiki:Common thumbnail sizes，2026-10-02 抓取）：
 * 20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840。
 * 桶外宽度上游一律 400 `Use thumbnail sizes listed on https://w.wiki/GHai`，
 * 经 /api/image 代理呈现为 502 →「封面随机消失」。 */
const THUMB_BUCKETS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const;
export function pickThumbBucket(maxWidth: number): number {
  let best = THUMB_BUCKETS[0];
  for (const bucket of THUMB_BUCKETS) {
    if (bucket > maxWidth) break;
    if (bucket > best) best = bucket;
  }
  return best;
}
```

`worker/other.ts` 三处（`:318` `iiurlwidth`、`:539` 与 `:688` `pithumbsize`）
统一改用 `pickThumbBucket(OTHER_THUMB_MAX_WIDTH)`，**`OTHER_THUMB_MAX_WIDTH = 500`**。

### 3.2 为什么上界取 500（这是本轮唯一需要论证的数）

`iiurlwidth` 是**向上**取桶（旧值 600 → 实际 960）。要定新值，必须先知道
**这张图最终显示多大**。实测了全部 `poster` 位：

| 位置 | CSS 实际尺寸 | 需要的桶 |
|---|---|---|
| `.poster-small`（榜单行、排名卡、维度片） | 26–50px | 120 就够 |
| `.collection-row .poster`（清单贴纸卡，`styles.css:62-64`） | **369–557px**（2/3/4 列 × 1120px 容器） | 960（retina）/ 500（1x） |
| `.poster-large`（详情弹窗） | 整宽 | 960+ |

**关键纠错**：我最初把 `styles.css:62-64` 的 `width:100%!important` 当成 bug，
计划里写了「拆掉」。实测 `SourceView.tsx:653` 是
`gridTemplateColumns: repeat(colCount, minmax(0,1fr))`、`colCount ∈ {2,3,4}`
（`SourceView.tsx:627`、`useSorting.ts:119-125`，默认 3），且该段 CSS 注释写明
「Collection Sticker Cards (source view only)」——**这是一次性的贴纸卡设计，不是 bug**，
拆掉会毁掉版面。故 §3.3 取消。

于是 330px 不行（369px 的卡会糊），960px 太浪费（38px 的缩略位是 25× 过量）。
**500px 是唯一同时站得住的档**：对 369px 的卡是 1.35×（1x 屏足够），
对 38px 的缩略位仍省下 2 倍线性尺寸，而蒙娜丽莎从 505.2KB → **114.6KB（4.4×）**。

### 3.3 关键安全性：`iiurlwidth` 不会放大

`iiurlwidth` 对**原图已小于请求宽度**的文件返回原图而非放大副本（响应标记
`utm_content=thumbnail_unscaled`，线上 Journey/Inside/纪念碑谷 三条都是原图直返）。
所以下调桶宽**只会让大图变小，不会让小图变大**——F4 那个「缩略图反而大 3 倍」
是我手工拼 `.../330px-...` URL 造出来的，**不是本项目会产生的请求**。这条必须
在验收里实测确认，不能靠推理。

### 3.4 为什么不能只把上界写死（这个方案的不完美处）

**因为「显示尺寸」是前端的事实，服务端看不见。** `Poster` 不带尺寸参数，
一个尺寸决策缺了，于是：
- 弹窗大图（整宽）用 500px 会偏糊；
- 榜单行 38px 用 500px 仍是 13× 过量。

所以本轮的取舍是：**服务端只保证「不离谱地大」，剩下的留给前端**。
正确解法是让前端把显示宽度上报服务端（`/api/posters/batch` 加一个
`displayWidth` 字段，服务端按桶表取对应桶宽）——**本轮明确不做**，
因为它要动 29 个 `<Poster>` 调用点 + 批量协议，违反「一次执行一种」。

## 4. 本轮范围（严格「一次执行一种」）

**做**：① `worker/other.ts` 新增 `THUMB_BUCKETS` + `pickThumbBucket`；
② 三处 `iiurlwidth`/`pithumbsize` 改用它；③ 单测（含源码扫描 tripwire）；
④ 文档同步。

**不做**（全部写进「下一步」，不是「忘了」）：
- 前端把显示宽度上报服务端 → §3.4 的正解；
- movie/book/music 的 `pithumbsize:"1200"`（弹窗大图确实需要大图，改了会糊）；
- `/api/image` 代理加缓存层（另开一轮优化）；
- 前端「让用户选」UI（后续轮次）。

## 5. 验收表

| # | 项 | 判定 |
|---|---|---|
| A1 | `pickThumbBucket` 在 11 个桶宽上**精确命中自己**（循环断言） | 单测 |
| A2 | 非桶宽落在「不超过它的最大桶」：`pickThumbBucket(1)===20`、`(38)===20`、`(119)===60`、`(121)===120`、`(200)===120`、`(331)===330`、`(501)===500`、`(601)===500` | 单测 |
| A3 | 边界不炸：`pickThumbBucket(0)===20`、`pickThumbBucket(-5)===20`、`pickThumbBucket(3840)===3840`、`pickThumbBucket(99999)===3840`、`pickThumbBucket(NaN)===20` | 单测 |
| A4 | `OTHER_THUMB_MAX_WIDTH` 的值能被代码读出且等于 500（防止有人偷偷改回去 600） | 源码扫描单测 |
| A5 | `worker/other.ts` 不再出现字面量 `iiurlwidth: "600"` / `pithumbsize: "600"` | 源码扫描单测 |
| A6 | 红队：把 `pickThumbBucket` 改成 `return maxWidth` → A1 必红、A2 必红 | 红队验证 |
| A7 | 线上蒙娜丽莎 URL 从 `960px-` 变成 `500px-`，字节数 505.2KB → 显著下降 | 线上实测 |
| A8 | 线上 `/api/posters/batch` 8 条 other 回归：封面**内容**逐条不变（只允许桶宽变） | 线上实测 |
| A9 | 线上 Journey / Inside / 纪念碑谷 三条**仍是原图直返**（证明 `iiurlwidth` 不放大） | 线上实测 |
| A10 | `npx vitest run` 全绿；build 主包增幅 < 2 KB | 门禁 |

## 6. 风险表

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 弹窗大图（`.poster-large` 整宽）用 500px 会偏糊 | **已知且刻意接受**：原图 URL 仍在候选里（`thumbnail → original` 回落顺序未变）。真要修见 §3.4 |
| R2 | 桶表过期（Wikimedia 改 `$wgThumbnailSteps`） | 桶表带官方出处 URL + 抓取日期注释；某桶失效时上游 400 → 代理 502 → 该候选被 `onError` 跳过并回落到 original，不会白屏 |
| R3 | 把 `pickThumbBucket` 改成「向上取桶」重蹈 600→960 覆辙 | A6 红队锁死向下取语义；函数名与注释都写明「不超过」 |
| R4 | 红队验证被误跳过 | A6 必须实际执行并贴出红色输出（迭代 1 踩过「PowerShell 静默继续导致红队无效」） |
| R5 | 用「清 D1」验证新代码上线，结果被 24h 边缘缓存骗了（F9） | 验证新判决必须换一个**从未被请求过**的维度/年份组合当探针；清 D1 ≠ 清缓存 |

## 7. 反思（已回填，按实际发生的写，不按计划里预想的写）

### 7.1 计划里没写的、我以为不会发生的事：代数 bump 送来一次免费回归

计划通篇在讲「桶宽」，执行时才发现 **gen4 作废缓存 = 全站 other 封面第一次真回源**，于是暴露了一个
与缩略图毫无关系的既有判决缺陷：`Journey 2012` 返 `500px-Zatsu_Tabi_That's_Journey_Logo.webp`
（zh 维基《隨興旅 -That's Journey-》，**石坂ケンタ 2019 年连载的日本漫画** 的 logo），连续 8 次稳定复现。

根因在 `titleMatchTier` 的 `bare.endsWith(baseCompact)` 分支（`worker/other.ts:403-407`）——它只查
`isDescriptiveSuffix`，即**只审「用户标题 + 描述性尾缀」这一侧**，对反向形状「别名 + 用户标题」零设防：

| 候选 | compact | tier | score |
|---|---|---|---|
| 隨興旅 -That's Journey- | `隨兴旅thatsjourney` | **2**（`endsWith("journey")` 成立） | **7** = 3(剥括号后以原名结尾) + 2(类型词) + 1(摘要够长) + 1(pageimages 缩略图) |
| 风之旅人（正确） | `风之旅人` | 1（靠消歧页别名放行） | **5.5** |

**tier 优先于分数**，1.5 分之差翻不了档 ⇒ 真封面 `Journey_PSN_Cover.png`（在 `pageprops.page_image` 里）
根本没机会出场，只能退到漫画像唯一的 `pageimages.thumbnail`，也就是那个 logo。
若没有代数 bump，它会继续被 D1 旧行 + 24h 边缘缓存遮住，**再多轮也不会有人发现**。

修法 `isAlternateNamePrefix`（`worker/other.ts`）：base 是拉丁字母、且前缀也含拉丁字母 ⇒ 判 **tier 0 淘汰**
（不是降档——漫画与游戏是不同作品）。判据试错两次：
① `head.includes(baseCompact)` → 测试红 `expected 2 to be 1`（前缀是「隨兴旅thats」，并没有第二个 journey）；
② 定在「base 含拉丁 ⇒ 前缀也含拉丁」，并用 `集合啦！動物森友會`（前缀全中文）、`Inside (遊戲)`/`紀念碑谷 (遊戲)`
（拉丁注脚在括号内，已被上层剥括号分支收走）作不误杀对照。

### 7.2 我把「上游偶发 502」当成了根因，实际是白名单策略

直连 `upload.wikimedia.org` 拿到的真实状态码是 **400**，body 原文
`Use thumbnail sizes listed on https://w.wiki/GHai`。502 只是自家 `/api/image` 代理 catch 后的呈现。
更严重的是**我的桶表本身就是错的**：只测了 `[60..1200]` 区间，据此写下「只有 6 个桶」，
把 `20/40/1280/1920/3840` 五档全漏在测试范围外。官方 `$wgThumbnailSteps` 实为 11 档
（`https://w.wiki/GHai`），逐档实测 11 档全 200、桶外 23 档全失败。
**白名单类事实必须查官方出处，不能靠抽样反推** —— 抽样区间是你选的，不是事实的边界。

### 7.3 我差点把设计当 bug 改掉

`src/styles.css:62-64` 的 `width:100%!important; height:auto!important` 让一张原图铺满整行，
看上去正是「小缩略位拉全尺寸」的元凶。但 `src/styles.css:56` 的注释写明
`Collection Sticker Cards (source view only)`，且单卡实际宽 **369–557px**（容器 1120px ÷ 列数 2/3/4，
列数存在 localStorage `art-rank:cols`）——**这是贴纸卡的设计**。本轮 §3.2 的上界 500 正是因为量到了
369–557px 这个区间才定的。教训：**动一条规则之前，先去找它的设计注释**。

### 7.4 三个反思问题（按原样作答）

1. **`pithumbsize:"1200"`（movie/book/music）是同病吗？** 向上取桶 → 实际落到 1280px，比 other 的
   960px 还大一档。它服务的是弹窗大图，**是同病不同解**：other 维度的封面从不出现在整宽大图位，
   movie/book/music 会。本轮不动是**刻意**（改了会糊弹窗），正解见 §3.4。
2. **「白名单类事实」在本项目里还有哪些？** `allowedImage` 的域名正则（`worker/media.ts:2411-2433`）
   是我们自己定的白名单，与上游无关；真正的上游白名单是 Wikimedia 的桶表（本轮已解决）。
   豆瓣图片「必然 418」属**反爬**而非白名单，两者解法不同（见 PITFALLS §2 表）。
3. **这次实测如果只试 600/300 两个宽度，会得出什么错误结论？** 会以为「1200 不可用、960 可用、
   600 是偶发失败」，于是把上界拍成 960 —— **正是那个 4.41× 的浪费**。问「为什么 600 会失败」比
   问「600 行不行」多花十分钟，少花四分之三的带宽。

### 7.5 落定在计划外的两件事（诚实记账）

- §4「不做」清单里的**「前端把显示宽度上报服务端」**没做（§3.4 的正解），仍留给后续。
- §4 说好的**「只做服务端桶表」**，实际多改了一处判决逻辑（`isAlternateNamePrefix`）。
  它不是「顺手优化」，是**代数 bump 逼出来的必要修复**——不修则本轮的线上验收（A8）过不了。
  按 CONVENTIONS 的账本纪律记在这里，不假装它在计划内。
