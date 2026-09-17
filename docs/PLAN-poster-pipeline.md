# 海报管线优化计划

> 状态：**Phase 0 待实施（存在线上活跃风险）** · Phase 1–3 待实施
> 相关文档：`OPTIMIZATION.md` §2.3、§3.3 · `DOUBAN_API.md` · `API.md`
> 相关提交：`d158fce` `d4492eb` `23fc8c3`（已完成）· `51dfc8d` `58da68a` `4ce1f15`（历史成因）

---

## 1. 摘要

海报管线的核心矛盾是：**海报地址要么持久化（会撑爆 512KB），要么每次现解析（会撞上游限流）**。

2026-09 的历史选择是"不持久化"，由此产生了两个后果：

| 层 | 问题 | 影响 | 状态 |
|---|---|---|---|
| 第一层 | 不持久化 → 每次浏览现解析整份榜单 | 150 首歌单一次批量只有 **16~17/150** 命中，其余显示占位图标 | 已缓解（24h 缓存 + 侧表 + 分块），未根治 |
| 第二层 | 剥离逻辑零散、写入路径缺护栏 | **`poster_urls` 侧表已上线并注回 `items`，而 4 条写入路径没有护栏 → 会将海报地址写回库，重演 512KB 故障** | **待实施（线上活跃）** |

第二层是本文档的重点，也是必须最先处理的部分。

---

## 2. 背景：设计沿革

### 2.1 原始实现（`51dfc8d` 之前）

`posterUrls` **内嵌在每个作品条目里**，随画像一起持久化：

```ts
// src/lib/useSorting.ts
items: kept.map((w, i) => ({ ...w, rank: i + 1 }))   // ...w 把 posterUrls 原样带进去
```

随之流入三个存储：`localStorage`（`art-rank:library:v2`）、云端 `user_profiles_v2.profile`、`plaza_posts.items`。

### 2.2 512KB 事件与"剥离"决定

超过 512KB 预算后云端保存与广场发布直接失败，因此连打三个补丁：

| 提交 | 改动 | 说明 |
|---|---|---|
| `51dfc8d` | `useSorting.ts` 两个保存函数改为只留最小字段 | "保存不排序时去掉 posterUrls" |
| `58da68a` | `worker/account.ts` PUT profile 增加剥离 + 二次体积校验 | Worker 端首次有护栏 |
| `4ce1f15` | `App.persist()` 全量清洗后再写 localStorage | 处理旧数据残留 |

提交信息写下了设计决定：

> 海报由 Poster 组件按需从 `/api/posters` 实时解析，**不需要持久化到画像中**。

### 2.3 量级修正（重要）

原始提交信息把成因归为"150 首歌曲画像超过 512KB"，但按实测 URL 长度算：单条 item 带 5 个 URL ≈ 520 字节，**150 条仅约 50~60KB，远不到 512KB**。

真正的越线量级是千条级：**1000 条 × 520 字节 ≈ 520KB**。而 `user_collections` 的上限恰好在 `0021_user_collections_limit_1000.sql` 被提到 1000，`parseRanking` 也允许 1000 条。

> ⚠️ 这是估算，实施时需用真实数据实测确认。它决定了 512KB 预算到底有多紧、以及哪些路径最先崩。

---

## 3. 现象与实测证据

测试环境：`https://sort.logicc.top`，样本 `https://sort.logicc.top/plaza/32`（网易云 uid 导入的 150 首歌单）。

### 3.1 帖子 32 的特征

- `kind = music`，150 条 item
- **全部 `posterUrls = 0`**：海报地址从未持久化
- item 字段只有 `id / title / rank / creator`（**无 `year`、无 `subtitle`**）

### 3.2 解析成功率

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 150 首一次批量 | **16~17 / 150**（11%），复现两次 | **37 / 150**（25%），44.7s |
| 30 首（= 客户端一页） | 未测 | **19 / 30**（63%），4.8s |
| 10 首 | 未测 | 8 / 10，11.8s |
| 同样的歌单条 GET | **4 / 4 全部成功** | 同 |

**失败率只与"一次请求里塞了多少首"相关，与歌名无关。** 从 150 批量的失败项里挑 6 首此前从未单独查询过的（避免缓存污染），逐首单独查**全部返回 4 张**。

### 3.3 图片加载（已修复，与解析是两回事）

豆瓣 CDN 对**无 Referer** 的请求一律返回 `418 cdn error 001`（13~14 字节）；带 `Referer: https://movie.douban.com/` 同一 URL 立即 200。

浏览器 `<img>` 无法伪造 Referer，组件又显式设了 `referrerPolicy="no-referrer"`，因此豆瓣图**必须**走 `/api/image` 代理（`buildHeaders()` 会补 Referer）。

| host | 直连（无 Referer） | 代理 |
|---|---|---|
| `img1/2/3/9.doubanio.com` | **418** | **200** |
| `m.media-amazon.com` | 200（与代理字节一致） | 200 |
| `p2.music.126.net` | **200**（180814 B） | 200 |

---

## 4. 根因分析

### 4.1 第一层：不持久化 → 现解析 → 上游限流

```
150 首歌单无持久化 posterUrls
  → 每次浏览都要现解析 150 次
  → 8 并发 worker + throttle() TOCTOU 竞态（节流只对顺序调用生效）
  → 豆瓣 418 → searchCover 当作"没找到"并给全域设 10s 冷却（连坐）
  → 降级 Wiki（中文流行歌无收录）/ 网易云
  → 返回空列表 → 客户端显示占位图标
```

### 4.2 第二层：剥离零散 + 写入路径缺护栏（**本文档重点**）

仓库里存在**三套各写各的"可落库形状"**：

| 位置 | 实现方式 |
|---|---|
| `src/lib/profile.ts:46-52` `parseRanking` | 白名单 `id/title/rank/creator?/year?/subtitle?` **+ posterUrls（保留、校验、截断 8 个）** |
| `src/lib/useSorting.ts:134,155` | 手写同样 6 个字段，无 posterUrls |
| `worker/account.ts:364-370` | 黑名单 `delete item.posterUrls` |

而实际能写入 `items` 的路径有 5 条，**只有 1 条有护栏**：

| # | 写入路径 | 位置 | 护栏 |
|---|---|---|---|
| 1 | `PUT /api/account/profile` | `account.ts:364` | ✅ 有（本地实现） |
| 2 | `POST /api/plaza/posts` | `plaza.ts:148` | ❌ **无** |
| 3 | `PUT /api/plaza/posts/:id` | `plaza.ts:184` | ❌ **无** |
| 4 | `POST /api/account/collections` | `account.ts:409` | ❌ **无**（1000 条上限，最高危） |
| 5 | `POST /api/share` | `index.ts:1966` | ❌ **无** |

另外体积判定单位不一致：`account.ts` / `index.ts` 用**字节**，`plaza.ts:121,169` 用 `raw.length`（UTF-16 码元）—— 对中文实际放行到约 3 倍。

### 4.3 合并成因：当前线上活跃风险

`23fc8c3` 上线的 `attachStoredPosterUrls()` 会把 `poster_urls` 侧表的结果**注回 `post.items`**，于是：

```
attachStoredPosterUrls 注回 post.items                    ← 已上线（worker/plaza.ts:104）
  → PlazaPostView.tsx:234  setEditItems(post.items.map(w => ({ ...w })))   ← ...w 展开带入
  → saveEdit()  body.items = editItems
  → plaza.ts:184  itemsJson = JSON.stringify(body.items)   ← 无护栏
  → 写回 plaza_posts.items                                  ← 重演 512KB 故障
```

对照历史：`51dfc8d` 修的正是这条链。**只要作者编辑一次帖子，海报地址就会重新进库并随覆盖率增长。**

> 三个结构性缺陷缺一不可：① 没有权威的"可落库形状"；② 编码出口不唯一（5 处各自 `JSON.stringify`）；③ 体积口径不一致。**这也是为什么补丁会反复出现 —— 漏掉一处没有任何信号。**

---

## 5. 已完成（`d158fce` / `d4492eb` / `23fc8c3`）

| 项 | 内容 | 验证状态 |
|---|---|---|
| 批量接口 | `POST /api/posters/batch`，300 首一次提交，独立 `posters` 限流桶，逐条宽松清洗，回显 `keys` 保证位置对齐 | ✅ 线上 |
| 服务端缓存 | L1 isolate LRU（2000 条 / 24h）+ L2 Edge Cache，键为 `type\|title\|english\|year` 的截断 SHA-256 | ✅ 线上 |
| 分页懒加载 | `RankingDetail` 30 首/页，滚动续载；`PlazaPostView` 原死代码已删 | ✅ 线上 |
| 并发闸门 | 批量 fetch 在途 ≤ 8 | ✅ 线上 |
| 豆瓣 Referer | `imageUrl()` 只把 `img\d+.doubanio.com` 交给代理，其余直连 + `onError` 代理兜底 | ✅ 线上 |
| 图片免节流 | 图片请求不走豆瓣抓取节流（实测 12 张并发 169ms 全 200） | ✅ 线上 |
| `throttle` 串行化 | 改为每域 promise 链，修 TOCTOU；`search.douban.com` 间隔 800ms → 200ms | ✅ 线上 |
| 冷却去连坐 | `searchCover` 10s 全域冷却 → 1.2s 短冷却 + 重试一次 | ✅ 线上 |
| 客户端分块 | 批量上限 300 → 30 | ✅ 线上 |
| `poster_urls` 侧表 | `migrations/0022`，解析结果落库；plaza 详情读取时挂载 | ⚠️ **已上线但见 §4.3 风险** |

**实测确认**（部署后复测）：迁移已生效；`posterUrls` 覆盖率随解析累积 **0 → 3 → 37**，与批量实际解析数完全对应；写穿与读取挂载链路成立。

---

## 6. 待实施方案

### Phase 0 — 结构性保证（**最高优先级**）

> 目标：让"posterUrls 进入 items"在结构上不可能，而不是靠"记得剥离"。

#### 0a. 海报地址走旁路，不进 items

读取接口不再注入条目对象，改为按位置对齐的旁路数组：

```jsonc
{
  "post": { "items": [ /* 与库里完全一致的干净数组 */ ] },
  "posterUrls": [ ["https://…"], null, ["https://…", "https://…"] ]
}
```

客户端**只在渲染时**合并（`PlazaPostView` 单点合并后传给 `RankingDetail`），编辑流继续使用干净的 `post.items` → 泄漏路径从结构上消失。

#### 0b. 定义唯一的"可落库形状"（白名单，不是 delete）

新建 `shared/storedItem.ts`，被客户端与 Worker 同时引用（两个 tsconfig 的 `include` 各加 `"shared"`）：

```ts
/** 可落库作品的唯一字段集。posterUrls 永远不在其中——海报走 poster_urls 侧表。 */
export interface StoredWork {
  id: string; title: string; rank: number;
  creator?: string; year?: number; subtitle?: string;
}

/**
 * 白名单式规范化。刻意不用 `delete item.posterUrls`：
 * 以后任何新加的本地渲染字段（cacheKey/thumbnail/loading…）默认都进不了库。
 */
export function toStoredWork(value: unknown): StoredWork | null;
export function toStoredWorks(value: unknown): StoredWork[];
/** profile 形状：rankings[].items[] 逐层走 toStoredWorks；榜单元数据保留 */
export function toStoredRankingsContainer(value: unknown): unknown;
```

字段集**照抄 `parseRanking` 现有形状**（不做增删），因此不是新语义，只是把既有语义收敛为唯一实现。
`tags` 仅为类型声明、全仓无引用，故不入白名单。`posterUrls` 的排除需要**注释 + 测试**双保险。

#### 0c. 唯一的编码出口 + 统一字节限额

同模块内，只有这两个函数能产出可落库字符串：

```ts
export const MAX_PAYLOAD_BYTES = 512 * 1024;

export function encodeStoredWorks(value: unknown):
  | { ok: true; json: string; count: number }
  | { ok: false; error: "payload_too_large" };

export function encodeStoredRankings(value: unknown): /* 同上 */;
```

内部统一用 `new TextEncoder().encode(json).byteLength` 判定，**顺带把 `plaza.ts` 两处 `raw.length` 口径统一到字节**。
5 条写入路径全部改为"先编码、`ok:false` 即 413"，路由内不再出现针对载荷的 `JSON.stringify`。

#### 0d. 让第 6 条路径无法悄悄出现

- **静态守卫测试** `worker/payloadGuard.test.ts`：扫描 `worker/**/*.ts`，若在编码器模块之外出现针对载荷的 `JSON.stringify`（窄模式匹配 `JSON.stringify\(\s*(body|collection|parsed)\.(items|profile|rankings)`），测试失败并输出文件行号。
- **类型品牌（可选加固）**：`StoredJson = string & { __stored: true }`。不能拦 D1 `.bind()`（那里是 `unknown`），但能拦住"编码结果被当普通字符串二次加工"的误用。

#### 0e. 客户端收敛

| 位置 | 改法 |
|---|---|
| `profile.ts:39-53` `parseRanking` | 改为调用 `toStoredWork`，删除本地重复白名单 |
| `useSorting.ts:134,155` | 改为 `toStoredWorks(kept.map((w,i) => ({ ...w, rank: i+1 })))` |
| `App.tsx` `persist()` | 复用同一 builder，删除自定义 destructure |
| `useSorting.ts:165` | 保持不动（内存里带 posterUrls 用于渲染是合法的，落库必经编码器） |

#### 0f. 存量数据自愈

读取时也过一遍 `toStoredWork`：库中残留 posterUrls 的旧行读出来即干净，客户端编辑保存后自动瘦身 —— **无需数据迁移脚本**。

### Phase 1 — 批量/单条接口先查库

| 文件 | 改动 |
|---|---|
| `worker/posterStore.ts` | 导出目前私有的 `loadPosterUrls` |
| `worker/media.ts` | `resolvePostersBatch(requests, env, known?)`：命中即短路；`keys` 仍与入参等长对齐 |
| `worker/index.ts` | 批量/单条路由：先算 keys → `loadPosterUrls` → 作为 `known` 传入 → 只解析未命中项 → 只对新解析到的写库 |

空数组命中按未命中处理。DB 不可用/表缺失 → 返回空 map → 退化为当前行为，不报错。
**受益面**：分享页（posterUrls 被剥掉）、任何走批量的入口都不再重复回源。

### Phase 2 — 失败可重试

核心：**不能一刀切** —— 瞬时失败该重试，永久失败不该反复打上游。

**2a. 失败分类**（`worker/media.ts`）

- 新增 `ThrottledError`：`searchCover` 遇 418/403、`upstream` 重试耗尽时抛出
- `computePosters` 返回 `{ urls, outcome: "found" | "absent" | "throttled" }`

| outcome | 负缓存 TTL | 理由 |
|---|---|---|
| `throttled` | **15 秒**（或零） | 瞬时限流，刷新就该重试 |
| `absent` | **24 小时** | 上游干净地回答"没有"，不必反复打 |

**2b. 刷新即重试**（`src/components/Poster.tsx`）

- `resolvedPosters.set` 改为只在有结果时写 → 失败不再被页面会话记住
- 每次页面加载的**首次**批量带 `retry: true`；服务端据此**绕过负缓存**（正缓存仍生效）→ "刷新 = 真重试"是确定的，不依赖 15 秒窗口

**2c. 页内自动补一轮**（可选，限 1 次，首批 settle 后 3~5 秒）

**2d. 批量失败记入 `poster_errors`**（source=`batch`）—— 目前批量失败在后台完全不可见

### Phase 3 — 失败队列 + 定时补温

**3a.** 迁移 `0023_poster_misses.sql`：`media_key PK, title, english, type, year, attempts, first_seen, last_attempt`
失败 upsert（`attempts+1`）、成功 delete。同时成为"还差什么"的唯一事实来源。

**3b.** `wrangler.jsonc` 增加 cron（如 `*/20 * * * *`），`scheduled()` 按 `event.cron` 分支：
每轮取 `last_attempt` 最旧的一批（30~60 个），走现有节流链解析落库，严格限量。

> 只靠人刷，冷门帖子永远补不齐；这一步让覆盖率在无人访问时也能收敛到接近 100%。

### Phase 4 — 验证

**单元测试**
- 白名单丢弃未知字段（含 posterUrls、tags、缓存字段）；超限返回 `payload_too_large`；字节口径对中文正确
- `known` 短路、空数组按未命中、重复 key 的 `keys` 对齐
- **静态守卫测试**：故意在某路由加 `JSON.stringify(body.items)`，确认测试变红

**线上复测**
- 已落库条目重复浏览：上游解析请求数 = 0
- 刷新确有真实上游耗时（非 <100ms 空返回）
- `throttled` / `absent` 两种 TTL 行为符合预期
- 帖子 32 覆盖率随轮次单调上升
- **重点回归**：编辑 150 首帖子后，`plaza_posts.items` 字节数未增长且不含 posterUrls

---

## 7. 验收标准

1. 已落库条目在重复浏览时，上游解析请求数 = **0**
2. 刷新后上次未解析到的条目**确实重试**（可观测到真实上游耗时）
3. 真正不存在海报的条目**不**被反复重试拖累上游
4. **任何写入路径落库的 `items` 都不含 `posterUrls`**，且有自动化测试护栏
5. 帖子 32 的 `posterUrls` 覆盖率在连续两次刷新后单调上升

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 白名单漏字段 → 数据丢失 | 字段集照抄 `parseRanking` 现状、不增删；先落测试再落实现 |
| 缩短负缓存 → 上游压力上升、更多 418 | 已有 60 次/10 分钟限流桶 + 200ms 串行链；若恶化则上调 `throttled` TTL |
| `retry: true` 被滥用 | 已在限流桶之后；只对每次加载首次生效 |
| 定时补温耗 subrequest/CPU | 每轮硬上限，复用同一节流链 |
| 失败分类改错，把瞬时当永久 | 单元测试覆盖两种 outcome 的 TTL 分支 |
| `shared/` 新目录影响构建 | 两边 tsconfig 各加一个 include；`tsc` 三 project + `vite build` + worker bundle 全部验证 |
| 静态守卫正则误报 | 只匹配"载荷变量 + JSON.stringify"的窄模式，命中后人工确认再收窄 |

---

## 9. 实施顺序

```
Phase 0（0a+0b+0c+0d+0e+0f）  ← 最高优先级，修当前线上活跃风险
  → Phase 1（先查库）
  → Phase 2d（失败可观测）
  → Phase 2a（失败分类）
  → Phase 2b（刷新即重试）
  → Phase 2c（可选）
  → Phase 3（失败队列 + 补温）
  → Phase 4（验证）
```

**阶段收口建议**：Phase 0 单独落地并复测"编辑帖子不再写回 posterUrls"；确认无误后再动 Phase 1 及缓存语义 —— 避免一次改太多而分不清影响。

**改动量**：Phase 0 = 1 个新模块 + 1 个守卫测试 + 5 条写入路径各 2~4 行 + 客户端 3 处收敛，**不涉及迁移、不改接口形状、可独立复测**。

---

## 10. 附录

### 10.1 关键常量与现状

| 常量 | 位置 | 值 |
|---|---|---|
| `POSTER_CACHE_TTL_MS` | `worker/media.ts:24` | 24h（正结果） |
| `POSTER_MISS_TTL_MS` | `worker/media.ts:26` | **10 分钟**（L1/L2 共用负结果） |
| `POSTER_CACHE_MAX_ENTRIES` | `worker/media.ts:27` | 2000 |
| `MIN_DELAY_MS` | `worker/media.ts` | 800（`search.douban.com` 覆写为 200） |
| `MAX_POSTER_BATCH_ITEMS` | `worker/index.ts` | 300 |
| `MAX_POSTER_BATCH_BYTES` | `worker/index.ts` | 128KB |
| `MAX_BATCH_SIZE`（客户端） | `src/components/Poster.tsx` | 30 |
| `BATCH_TIMEOUT_MS`（客户端） | `src/components/Poster.tsx` | 60000 |
| `MAX_PROFILE_BYTES` | `src/lib/profile.ts:22` | 512KB |
| 512KB 硬编码 | `account.ts:360,377,409` · `index.ts:1954,1966` · `plaza.ts:121,169` | 需统一 |

### 10.2 相关提交

| 提交 | 主题 |
|---|---|
| `d158fce` | 海报批量接口、分页懒加载与服务端 1 天缓存打通 |
| `d4492eb` | 豆瓣海报直连必然 418 —— 豆瓣系改走代理，并让图片免于抓取节流 |
| `23fc8c3` | 批量海报被豆瓣限流打回 + 海报地址持久化 |
| `51dfc8d` | 保存不排序时去掉 posterUrls（历史成因） |
| `58da68a` | 画像云端存储 Worker 端强制去掉 posterUrls（历史成因） |
| `4ce1f15` | persist 函数全量清洗 posterUrls（历史成因） |
| `e3dbcec` | 广场发布 POST items.length 上限 20 → 300 |

### 10.3 复测方法

```powershell
# 帖子 32 详情：posterUrls 覆盖率
curl.exe -s https://sort.logicc.top/api/plaza/posts/32 -o post32.json

# 批量解析成功率（客户端真实页粒度 = 30）
curl.exe -s -X POST https://sort.logicc.top/api/posters/batch `
  -H "content-type: application/json" --data-binary "@items30.json"

# 图片 host 是否可用（无 Referer = 等价 referrerPolicy=no-referrer）
curl.exe -s -o NUL -H "User-Agent: Mozilla/5.0 … Chrome/131" -w "%{http_code} %{size_download}`n" "<url>"
```

> 注意：批量接口有 60 次/10 分钟限流桶；连续压测会把 Worker 出口 IP 打进豆瓣风控，导致数字偏悲观。复测前应留冷却时间。
