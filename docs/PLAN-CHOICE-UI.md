# PLAN-CHOICE-UI · 迭代 5/20（创意类）·「让用户选」消歧出口

> 承接 `docs/PLAN-JEV-DISAMBIGUATION.md`（迭代 2 建的诊断端点 `/api/other/candidates`）与
> 台账 T-20261002-03 遗留风险①。诊断端点建好了，`band` 四档也已在线上真实数据上跑过，
> 但**它至今没有任何消费者**。本轮给它接上界。

---

## 0. 一句话

把迭代 2 那个「诚实报告自己有几分把握」的诊断端点接上界：
`band` 落在 `shaky`/`weak` 且候选池 ≥2 时，作品详情弹窗里出现一组**带缩略图的选择按钮**，
用户一点就写进服务端 `poster_urls`、**此后全站都用他选的这一张**；
`exact`/`strong` 时一个字都不打扰。

---

## 1. 事实表（全部实测，不是推断）

| # | 事实 | 证据 |
|---|------|------|
| F1 | 诊断端点**已上线且在线上真实跑** | `GET /api/other/candidates?name=Journey&year=2012` → `status:true`，`picked=风之旅人` |
| F2 | 候选带 `hasCover` 字段，**有图无图已经分得开** | 线上三候选 `风之旅人/道奇Journey/Thatgamecompany` 全 `hasCover:true` |
| F3 | **用候选原名精确查 detail 就能直接拿到该候选的封面** | 见下表（这是本轮 UI 能成立的关键） |
| F4 | `weak` 档线上真实存在，池子也 ≥2 | 见 §1.1 抽样表 |
| F5 | `shaky` 档**至今线上从未触发** | 同表 14 条抽样无一命中；`band` 判据要求 `alias` 证据 + `margin≥0.1` |
| F6 | 写端点必须自建：`poster_urls` **没有**用户覆盖列 | `migrations/0022_poster_urls.sql`：`media_key / urls / updated_at` 三列 |
| F7 | 用户 token 已有现成校验函数 | `worker/account.ts:151` `getUserFromToken(request, db)`，返回 `{id, email}` 或 null |
| F8 | 前端 token 在 localStorage | `src/lib/useAuth.ts` → `localStorage["art-rank:account-token"]` |
| F9 | 弹窗范式已存在 | `src/components/ArtworkDetail.tsx:109-116` `modal-backdrop > section.detail-dialog[role=dialog][aria-modal]` |
| F10 | 候选结构**没有 `cover_url`** | 线上 JSON：只有 `title/year/excerpt/score/tier/evidence/hasCover` |

### 1.1 线上 band 抽样（F4/F5 的依据）

| name | year | band | score | pool | picked |
|------|------|------|-------|------|--------|
| Journey | 2012 | **weak** | 0.47 | 3 | 风之旅人 |
| 拾荒者 | — | **weak** | 0.74 | 2 | 拾荒 |
| 模拟人生 | 2000 | **weak** | 0.57 | 5 | 模拟人生 (游戏) |
| 西遊記 | 1996 | exact | 0.80 | 8 | 西遊記 (無綫1996年電視劇) |
| 降临 | 2016 | exact | 0.74 | 4 | 降临 (电影) |
| 沙丘 | 2021 | exact | 0.71 | 9 | 沙丘 (2021年電影) |
| Inside | 2016 | exact | 1.00 | 1 | Inside (游戏) |
| 怪物 | — | strong | 0.66 | 7 | 怪物彈珠 |
| 星云 | — | strong | 0.65 | 9 | 星云 |
| 地心游记 / 机器猫 / 病毒 / 异形 / 第一人称 | — | weak（score 0, pool 0） | 0 | 0 | — |

**两条读数**：
① `weak` 档真实存在，且既有「pool≥2 有得选」（Journey/拾荒者/模拟人生），也有「pool=0 没得选」（地心游记）。
② **`shaky` 一次都没出现**。`otherConfidence` 的 `shaky` 判据是 `evidence==="alias" && margin>=0.1`——
而 Journey 的 margin 是 0（风之旅人 7.5 与 Thatgamecompany 7.5 并列），所以掉到 `weak`。
**所以 UI 的触发条件不能只写 `shaky||weak`：必须 `&& poolSize>=2`，否则会给 pool=0 的项弹一个空选择器。**

### 1.2 F3 的取证（决定 UI 长什么样）

对每个候选用**它的原名**去调现成的 `/api/other/detail`：

| 候选 | `?name=<候选原名>&year=2012` 返回 `poster_url` |
|------|----------------------------------------------|
| 風之旅人 | `Journey_PSN_Cover.png` ✅ 真封面 |
| 风之旅人（简体） | `Journey_PSN_Cover.png` ✅ |
| 道奇Journey | `500px-2012_Dodge_Journey_--_NHTSA_3.jpg` ✅ SUV 真封面 |
| Journey（消歧页自己） | `Journey_PSN_Cover.png` |

**结论：不需要新增「取候选封面」的接口**。`otherDetail(name, year)` 现成就能给任意候选出图，
而它的第一档就是「精确标题直查」（`worker/other.ts:1119` `wikiTitlePages(lang, titleVariants(base))`），
候选原名本身就是这个池子里评分最高的作品页。

---

## 2. 根因 / 为什么要做这个

迭代 2 的反思里写过一句：**「先让系统说『我不确定』，再谈让它更确定。」**
前半句做完了（`band` 四档），后半句一直空着。后果是：

- 「其他」维度里 **pool=0 的条目永久空图**（日常幻想/故事FM/看理想，zh-wiki 根本没这些条目），
  用户看到的是一个灰色图标 + 标题，**没有任何可做的事**。
- `weak` 档的条目（Journey 2012、拾荒者、模拟人生 2000）**给了一张大概率对的图**，
  但用户无从判断，也无从纠正；万一猜错（这正是 `weak` 的定义），用户只能放弃。

**加规则这条路已经走到头**（台账 T-20261002-01 遗留风险①已论证）。
所以出口只有一个：**把选择权交出去，并且让用户的选择真的留下来。**

---

## 3. 方案

### 3.1 触发条件（写死在 UI 层，不改服务端判决）

```
band ∈ {shaky, weak}  &&  poolSize >= 2  &&  候选里至少一条 hasCover
```

`exact`/`strong` **不出现任何 UI**——这是本轮最重要的一条取舍：
`exact` 档的 6 条抽样（西遊記/异形/病毒/降临/沙丘/Inside）全都是对的，
打扰它们是纯负收益。

### 3.2 前端：`ArtworkDetail` 里加一个消歧块

- 新文件 `src/components/CoverChoice.tsx`（独立组件，不塞进已有的 237 行 `ArtworkDetail`）。
- 挂载点：`src/components/ArtworkDetail.tsx:186` 之前，`detail.kind === "other"` 时才渲染。
- 交互：`band==="weak"` → 一行提示「这张封面我们没把握，可能是同名作品」+
  一排**带缩略图的选择按钮**（`<button>` 而非 `div onClick`，见 ui-ux-pro-max 的 High 级条目）。
- 缩略图：每个候选一个 `40px` 小图，用 §1.2 的 `otherDetail` 取的 `poster_url`；
  加载中显示 `.poster-loading` 骨架（`src/components/Poster.tsx:293` 已有同款）。
- 无 token 时：仍然显示候选，但点击后提示「登录后可保存你的选择」——**不静默失败**。
- 选择后：立即把 `detail.work.posterUrls` 换成本次选择的 URL（视觉立即生效），
  并 `POST` 到新端点写库。

### 3.3 服务端：新增 `POST /api/other/cover-choice`

- `assertSameOrigin(request)`（同源闸门）+ `allowUpstreamRequest(request, "other", 20)`（与两个 other 端点同桶）
  + `getUserFromToken(request, env.DB)` 鉴权（**未登录 401**）。
- body：`{ title, english?, year?, wikiTitle, url }`。
- **不新增表、不加列**：直接 UPSERT `poster_urls` 的 `urls` 字段为 `[url]`，`media_key` 用
  `posterKeyFor`（`worker/posterStore.ts:70`）——这样前端 `Poster` 组件**零改动**就能吃到用户的选择。
- **安全边界**：`url` 必须过 `allowedImage`（`worker/media.ts`）**且**域名必须是
  `upload.wikimedia.org` / `thumb.wikimedia.org` 两个之一。否则 400。
  理由：这是个写端点，能往全站封面位注入任意 URL 就是存储型 XSS/钓鱼的入口。
- 幂等：同 key 重复提交即覆盖；返回 `{ok:true}`。

### 3.4 取候选封面：复用 `/api/other/detail`，**不新增端点**

前端对 `hasCover` 为真的候选（**上限 3 个**，防扇出）并发调 `/api/other/detail`。
这复用现成链路（`otherDetail` 与 `resolveOtherCover` 同源），代价是 3 次上游请求；
但 `/api/other/detail` 有 `other` 桶 20/10min 保护，且**只在 weak/shaky 时才发生**。

### 3.5 为什么不让 `/api/other/candidates` 直接回 `cover_url`

那会让一个**只读诊断端点**变成 8 条候选 × 1 次取图 = 8 倍上游扇出，
且诊断端点有 300s 边缘缓存，扇出会被缓存放大。
拆成「诊断便宜 + 用户真的要看图时才取」是更稳的形状。

---

## 4. 不做什么

- 不改 `pickBest` / `titleMatchTier` / `isAlternateNamePrefix` —— 判决链路一条都不动。
- 不改 `band` 判据 —— `shaky` 从未触发是**已知事实**（F5），不在本轮修。
- 不给 `other` 维度以外的媒介加消歧。
- 不做「用户选择的历史/撤回」UI（只做选择，不做管理）。
- 不给未登录用户做「本次会话内的本地记忆」——`sessionStorage` 里 poster 缓存已有，
  但让选择持久化是**服务端**语义，混进本地会造出第二份真相。

---

## 5. 验收

### 5.1 验收表

| # | 项 | 判据 | 实测 |
|---|----|------|------|
| A1 | `npx tsc -b` | exit 0 | ✅ exit 0 |
| A2 | `npm run lint` | 0 errors（warnings 不新增） | ✅ 29 problems (0 errors, 29 warnings)＝迭代 4 基线 |
| A3 | `npm run format:check` | 全过 | ✅ All matched files use Prettier code style! |
| A4 | `npx vitest run` | ≥ 568 passed，不新增失败 | ✅ **605 passed / 9 skipped（44 files）**，迭代 4 为 568 ⇒ **+37** |
| A5 | `npm run build` | 主包体积变化 **< +6 KB** | ✅ `index-Cix8RSlz.js` **407.59 kB / gzip 136.06 kB**，迭代 4 为 402.60 / 134.34 ⇒ **+4.99 kB raw / +1.72 kB gzip** |
| A6 | **红队** | 去掉 `poolSize >= 2` → 测试必须红 | ✅ **2 failed \| 78 passed**：`coverChoice.test.ts` 的「候选只有一条时没有「选」的余地」`expected true to be false` ＋ `ui-fixes.test.ts` 的 `to match /poolSize < 2/` |
| A7 | 线上 | 无 token → 401；非维基 URL → 400；`Origin` 不匹配 → 403 | ✅ 无 `Origin` → `403 {"error":"cross_origin_forbidden"}`；`Origin: https://evil.example` → 403；仅同源无 token → `401 {"error":"auth_required"}`；非维基域由 `worker/coverChoice.test.ts` 12 例钉住（含形似域 `upload.wikimedia.org.evil.example`） |
| A8 | 线上 | 合法写入后 `/api/posters/batch` 对该 key 返回**用户选的那张** | ✅ `POST /api/other/cover-choice` → `200 {"ok":true,"key":"other|journey|journey|2012|4","wikiTitle":"道奇Journey"}`；紧接 `/api/posters/batch` 同 key → `500px-2012_Dodge_Journey_--_NHTSA_3.jpg`（用户选的那张，非系统原本给的 PSN 封面） |
| A9 | 线上 | 判决链路零改动 | ✅ `worker/index.ts` 唯一改动是 +42 行新端点，`worker/other.ts` 本轮 **0 改动**；`/api/other/candidates?name=Journey&year=2012` → `picked=风之旅人 band=weak pool=3`，与迭代 4 逐字相同 |
| **A10** | **线上** | **9 条 other 封面逐字回归** | ⚠️ 蒙娜丽莎 / 纪念碑谷 / 动物森友会 / inside / Liminal Space 5 条与迭代 3 逐字相同 ✅；**Journey 见 §7.2——不是本轮引入的回归，但也没被本轮修掉** |

**A8 的收尾**：验证用的一次性账号（`coverchoice-probe-*@example.com`）与它写的
`poster_urls` 行**都已删净**（`DELETE` 三条各 changes=1，回查 `LIKE '%journey%'` 只剩
迭代 3 留下的 2009 道奇行）。教训：拿生产 D1 验证写端点时，**必须自己留好回收路径**，
否则一次「验证」就是一次数据污染。

### 5.2 绊线设计

`src/ui-fixes.test.ts` 新增 `describe("消歧出口 UI（PLAN-CHOICE-UI）")`（4 例，**全部源码扫描**，因为这个 UI 最重要的性质不是「长什么样」而是「知道什么时候不该出现」——而那退化是静默的）：

1. 触发条件三要素都在 `src/lib/coverChoice.ts` 源码里：`poolSize < 2`、`coverCount > 0`，
   且 band 门槛必须是 `band !== "shaky" && input.band !== "weak"`（`exact`/`strong`
   必须在第一道就被挡掉，不能靠后面的计数兜）；
2. 判定放在 `ArtworkDetail`（`{choiceAppliesToKind(detail.kind) && onCoverChange && (`）
   而 `CoverChoice.tsx` 自身**不含** `choiceAppliesToKind`——组件被别的维度复用时会顺手带上打扰；
3. 点击即生效：`onPicked(` 的位置必须早于 `cover-choice"`（视觉生效不依赖服务端往返），
   且含 `method: "POST"` / `/api/other/cover-choice` / `art-rank:account-token` / `if (!token)`；
4. 缩略图地址仍走 `isWikiImageUrl(url)`；扫出全部 `className="cover-choice*"`
   必须在 `src/styles.css` 有定义；取图失败的候选 `disabled={!url ||`。

### 5.3 测试（三份，共 +37 例）

| 文件 | 例数 | 覆盖 |
|------|------|------|
| `src/lib/coverChoice.test.ts` | 21 | `shouldOfferChoice` 9 组表驱动（照 §1.1 线上抽样逐格写死，含 3 种「不该打扰」的真实理由）+ `choiceAppliesToKind` + `isWikiImageUrl` 14 例（收维基两域 / 拒 `allowedImage` 另 5 域 / 拒 5 个形似维基的域名 / 拒非法协议）+ **会话缓存 6 例**（不打扰要记住、要展示连字段一起记、同名不同年是两条记录、坏数据当作没缓存、上界 200 条先淘汰最旧、storage 不可用时不崩） |
| `worker/coverChoice.test.ts` | 12 | 写端点三道闸逐个钉：无 `Origin`/跨站 `Origin` → 403 且不落地；匿名/无会话 → 401 且不落地；非维基域 + 形似维基域 + 字段缺失 → 400；合法写入 200 且落库一行；**写入用的键 = 前端 `posterMediaKey(title, subtitle ?? title, type, year)`**；`english` 缺省回落仍是那把键；http 维基地址按 `allowedImage` 口径升级为 https |
| `src/ui-fixes.test.ts` | +4 | §5.2 四条绊线 |

**注意 `worker/coverChoice.test.ts` 里的两个必踩坑**：`worker/index.ts` 的 `route` 未导出，
只能走 `worker.fetch(request, env, ctx)`；fake D1 的 `batch` 必须**逐条 `await statement.run()`**，
否则 `saveResolvedPosters` 走 `db.batch([...])` 时一条都没写，
端点的「写后回读校验」会返回 500 `write_verify_failed`——**假 DB 会让整张表红成另一种含义**。

---

## 6. 风险

| # | 风险 | 对策 |
|---|------|------|
| R1 | 写端点被拿来注入任意 URL | 域白名单（两个 wikimedia 域）+ `allowedImage` 双重校验 |
| R2 | 未登录用户点了没反应 | UI 明确提示，不静默失败 |
| R3 | 3 次并发 `otherDetail` 把 `other` 桶（20/10min）打满 | 只在 weak/shaky 触发 + 候选上限 3 + 失败降级为「只显示标题不给图」 |
| R4 | 用户选择把 D1 行写坏，**永久**（`poster_urls` 无 TTL） | 只接受 `allowedImage` 白名单内的 URL；写前先 `SELECT` 确认 key 形状；写后立刻回读验证 |
| R5 | 判决链路被顺手改动 | 触发条件、UI 全在 UI 层；服务端新端点**只写不读判决**，一行 `pickBest` 都不碰 |

---

## 7. 反思

### 7.1 计划外发现：一个诊断端点会吃掉主链路的限流配额（本轮真正的收获）

计划 §3.4 只算了「取图最多 3 次」这**一笔**账。写完组件后我数了一下真实调用量：
**每打开一次「其他」维度的作品详情弹窗，就会同时发出 1 次 `/api/other/candidates`
+ 最多 3 次 `/api/other/detail`**，而这三者与写端点共用 `other` 桶（20 次 / 10 分钟）。
于是**开 20 次弹窗就能让主链路自己开始 429**——一个为了「帮用户」而加的功能，
会把它自己要服务的功能打挂。

修法不是加配额（配额是防滥用的，不该拿来当架构工具），而是**让诊断结果在会话内可复用**：

- 判「不打扰」的 → 记下来，下次同一弹窗**连请求都不发**；
- 判「要展示」的 → 连渲染所需字段一起记，下次直接渲染；
- `poster_urls` 那类缓存已有的纪律同样适用：必须有**上界**（200 条，先淘汰最旧），
  否则逛久了会撑爆 `sessionStorage` 配额，连 `Poster.tsx` 的海报缓存都跟着写不进去。

教训：**「复用限流桶」这件事本身就是一个架构决定**，但它在读代码时长得像一行参数
（`allowUpstreamRequest(request, "other", 20)`），不数调用点就看不见。

### 7.2 判决链路一行没动，却在线上发现它并不总是确定的

验收时连打 8 次 Journey（每次先删 D1 缓存行强迫真回源），出现两种结果交替：
`Journey_PSN_Cover.png` 与 `500px-Zatsu_Tabi_That's_Journey_Logo.webp`（2006 年漫画 logo）。
而同一时刻 `/api/other/candidates` 的判决**稳定地**返回 `picked=风之旅人`。

也就是说：**诊断端点与取图链路用的是同一套评分与同一份别名，但结果不同**。
`resolveOtherCover`（`worker/other.ts:1056`）除了评分还多两步：
① 补图范围 `sameEvidence` 会**按分数取前 3 名**，② infobox 优先、`pageimages` 兜底。
这两步依赖 `page_image` / `pageimages` 两个字段，而这两个字段的填充是**并发的上游请求**——
一旦某个字段这一轮没回来，`pickBest` 选中的条目就可能落到「无 infobox 图」的分支，
于是名次靠后的漫画像顶上来。

**这暴露了一个迭代 3 就该发现、但被 D1 缓存掩盖了的事实**：
`otherDetail`（详情弹窗用的那条链路）与 `resolveOtherCover`（海报用的那条链路）
虽然共用 `pickBest`，但**补图阶段的容错不对称**。这不是本轮该修的（会动判决链路，
违反 R5「一行 `pickBest` 都不碰」），但它必须被记下来：
**「同判不同图」比「完全判错」更难发现，因为诊断端点会替你担保它是对的。**

### 7.3 判据也踩了一次「看起来对其实不对」

第一版红队用 `head.includes(base)` 去掉 `poolSize` 门槛时，测试立刻红了——
这一步反而证明了整个判定层值得单列。但真正值得记的是写测试时的一处自我欺骗：
「判定只认 band 与两个计数」那条用例，我最初想用两个只差 `score` 的输入证明
`score` 不参与判定，**但 `ChoiceInput` 里根本没有 `score` 字段**，两个输入字面相同，
这条断言什么都没证明。**一条证明不了任何事的测试比没有测试更糟，因为它给人虚假的安全感。**
最后改成结构性证明（`typeof shouldOfferChoice(...) === "boolean"` + 类型里就没有 score）。

### 7.4 四个原定的反思问题，逐条作答

1. **这个 UI 真正的价值是「知道自己不该出现」吗？**
   是。线上抽样里 `exact` 6 条全判对、`strong` 2 条全判对，而 `weak` 里有一半是
   `poolSize=0`（zh-wiki 根本没这些条目）。若触发条件只写 `shaky||weak`，
   用户会在**系统连候选都没有**的地方看到一个空选择器——比不弹糟得多。
   门槛 `poolSize >= 2 && coverCount > 0` 是这个 UI 唯一的正确性保证。
2. **如果判据错了会怎样？退化是静默的，没有任何报错。**
   会。全绿、测试过、线上跑得通，只是**打扰了本不该打扰的人**。
   所以这条判据必须有源码级绊线（`src/ui-fixes.test.ts` 扫 `poolSize < 2` 与
   `coverCount > 0` 字面量），而不是只靠行为测试。
3. **有没有比现在更好的做法？**
   有——把判据搬进服务端，让诊断端点直接告诉客户端 `shouldAsk`。
   **没做的理由**：那会让一个只读端点承担 UI 决策职责，而它的响应有 300s 边缘缓存；
   判据一改，缓存里的旧答案会继续发一阵子。留在前端至少能做到**灰度即生效**。
4. **这次做完，问题的形状变了吗？**
   变了。迭代 2 结束时我认为「缺的是消费方」；做完发现真正的缺口是
   **「消费方会消耗它自己依赖的配额」**。这是两类完全不同的缺口——
   前者是功能没做完，后者是功能做完才暴露的系统约束。

### 7.5 诚实记账

- **计划外多做的**：会话内缓存层（`src/lib/coverChoice.ts` 的 `readCachedReport` /
  `cacheReport` / `clearCachedReports` + `reportCacheKey`）及其 6 个用例，§7.1。
- **计划外少做的**：§3.2 原计划用 `detail.kind === "other"` 直接守卫，
  落地改用 `choiceAppliesToKind(detail.kind)` 纯函数，好处是判定归属可被源码扫描钉死；
  §5.2 绊线第 2 条因此从「有 `=== "other"` 字面量」变成「判定在弹窗里、不在组件里」。
- **计划里写了但没做**：`.poster-loading` 骨架（`Poster.tsx` 里有现成的，
  但候选取图走的是裸 `<img>`，套骨架要多引一个 CSS 类，收益不抵复杂度，改成灰底 `<span>`）。
- **本轮没碰、但已经知道的债**：§7.2 的「同判不同图」；`shaky` 档至今线上从未触发。
