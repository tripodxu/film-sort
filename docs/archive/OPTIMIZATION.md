> ⚠️ **【已过时 · 归档】**（2026-09-22 归档）内容停留在归档时点，**请勿据此操作**；现行结论见 `PLAN-ui-refresh.md`（§10）与各活跃文档。多为 AI 时期路线图；「待办池」为归档时点快照，现行待办见 PLAN-ui-refresh §10.8 遗留清单。

# 优化路线图

基于全量代码审查的优化建议，按优先级和实施顺序排列。

---

## 1. 架构优化

### 1.1 App.tsx 单体组件拆分

**现状**：✅ 已完成。视图组件已提取到 `src/views/`，但"文件是否过大"这个判断标准此前一直看错了对象。

**已实现结构**：

```
src/
├── App.tsx                    # 路由 + 全局状态 + 弹窗
├── views/                     # HomeView / SourceView / SetupView / SortingView
│   │                          # ProfileView / CompareView / PlazaView / PlazaPostView
│   │                          # ShareView / IconButton / helpers / types
├── components/                # Poster / OrbScene / DeferredOrb / ArtworkDetail
│   │                          # RankingDetail / SettingsMenu / ThemeSwitcher
│   │                          # ExpandableNote / FocusTrap / ErrorBoundary
└── lib/                       # ranking / profile / collections / notes / theme
                               # exportPng / gdMusic / useAuth / useRouter / useSorting
```

**2026-09-18 补充：真正的可维护性杀手是"巨行"而不是"大文件"。**

`App.tsx` 587 行本身是可读的，问题在于 JSX 被压成了超长单行：

| 文件 | 格式化前最长单行 |
|------|------------------|
| `src/views/SourceView.tsx` | 10,539 字符 |
| `src/views/CompareView.tsx` | 8,554 字符 |
| `src/App.tsx` | 6,817 字符 |
| `src/views/HomeView.tsx` | 4,422 字符 |

已引入 Prettier（`npm run format`）并全仓统一格式，最长单行降到 252 字符。格式化前后用
esbuild 把两侧压成 minified 产物逐字节比较（JSX 文本会变成字符串字面量，任何文案
空白变化都会暴露），67 个代码文件确认只有排版变化。

**仍待处理**：`worker/index.ts` ~2848 行、`src/views/PlazaPostView.tsx` ~1101 行仍偏大，
按路由/子组件继续拆分（见文末待办池）。

**风险**：
- 弹窗组件仍需访问全局状态，目前靠 prop drilling

### 1.2 状态管理精简

**现状**：40+ 个 `useState` 平铺在 App 组件顶层，部分状态仅在特定视图使用。

**建议**：

| 状态组 | 包含状态 | 优化方式 |
|--------|----------|----------|
| 排序状态 | `ranking`, `collection`, `selected`, `draft`, `topN`, `seed` | 组合为 `useReducer` 或独立 hook |
| 比较状态 | `compareMode`, `compareActiveKind`, `manualOwn*`, `compareSortBy`, `compareRankDetail`, `peerRankPickOpen` | 下沉到 CompareView |
| 账号状态 | `accountToken`, `accountEmail`, `accountNickname`, `authMode`, `authError`, `syncStatus`, `cloudConflict` | 组合为 `useAccount` hook |
| UI 状态 | `notice`, `busy`, `search`, `colCount`, `editingNickname`, `showGuide`, `showTech` | 大部分可下沉到子组件 |

---

## 2. 性能优化

### 2.1 Bundle 按需加载

**现状**（2026-09-18 实测 gzip，`npx vite build`）：

| 产物 | 原始 | gzip |
|------|------|------|
| `index-*.js`（主包） | 505.74 KB | 159.43 KB |
| `OrbScene-*.js`（Three.js 光球，独立 chunk） | 521.72 KB | 132.13 KB |
| `index-*.css` | 89.16 KB | 16.46 KB |

| 优化项 | 方案 | 状态 |
|--------|------|------|
| QRCode 库 | 仅在点击「分享」时 `import("qrcode")` | ✅ 已完成 |
| fflate | 仅在分享链接解析/生成时动态 import | ✅ 已完成 |
| lucide-react | `sideEffects: false` + Vite tree-shaking | ✅ 已完成 |
| **首屏 3D 光球** | **从关键路径移出**（见下） | ✅ 2026-09-18 完成 |
| catalog.ts（36 KB） | 改为动态 import | ⏸ 暂缓（原因见文末） |

**首屏光球移出关键路径**：`OrbScene` 是装饰性背景（`aria-hidden`），却占了落地页 JS 的
约 45%。此前只有 `lazy()`——那只是把它拆成第二个请求，并没有避免加载。现改为
`src/components/DeferredOrb.tsx`：

- 省流模式（`navigator.connection.saveData`）或 2G/slow-2G：**完全不加载**，保留既有的 CSS 兜底背景
- 其余情况：等首屏空闲（`requestIdleCallback`，2s 上限；Safari 缺该 API 时退回定时器）后再 `import()`
- `prefers-reduced-motion` **刻意不拦截**：`OrbScene` 内部已把该偏好处理成"只渲染一帧静止画面"，
  这些用户本来就该看到静态光球，跳过加载反而是视觉回归
- 等待期间渲染与 `OrbScene` 根节点同 class 的占位元素，因此没有布局跳动（无 CLS）

注意口径：这一步把 132 KB gzip 从**首屏关键路径**上摘下来（并让省流/2G 用户完全省掉），
而不是把页面总传输量减少 132 KB——留在页面上的用户仍会在空闲时加载它。

**实施（QRCode 按需加载示例）**：

```typescript
// QRCode 按需加载示例
const [qrModule, setQrModule] = useState<typeof import("qrcode") | null>(null);

async function generateQR(url: string) {
  if (!qrModule) {
    const mod = await import("qrcode");
    setQrModule(mod);
  }
  return qrModule.toDataURL(url, { width: 240, margin: 2 });
}
```

### 2.2 排序撤销性能 （✅ 已完成）

**现状**：已改为快照法——每次决策前保存完整 `RankingState` 快照，撤销时直接回退到上一个快照（O(1)）。快照上限 500 个，防止内存溢出。开始新排序或恢复草稿时清空快照栈。

**方案 A — 快照法**（推荐）：
- 每次决策后保存完整 `RankingState` 到数组
- 撤销时直接回退到上一个快照
- 内存开销：每个快照约 2-5 KB，300 作品约 150 KB

**方案 B — 增量 diff**：
- 每步只记录 `activeInsertion` 的 `low/high` 变化和 `rankedIds` 的变更
- 撤销时反向应用 diff
- 内存开销更低，但实现更复杂

### 2.3 海报加载优化

**现状**：✅ 前端与服务端均已完成。**完整方案见 [`PLAN-poster-pipeline.md`](./PLAN-poster-pipeline.md)。**

| 能力 | 实现 | 状态 |
|------|------|------|
| 批量解析 | `POST /api/posters/batch`，一次最多 300 首，回显 `keys` 保证位置对齐 | ✅ |
| 客户端分块 | 批量上限 30（= 分页粒度），避免一次请求压垮上游 | ✅ |
| 会话缓存 | `sessionStorage`（`art-rank:poster-cache`）+ 内存 `resolvedPosters`（只记成功结果） | ✅ |
| 服务端缓存 | L1 isolate LRU + L2 Edge Cache，键 `type\|title\|english\|year`；`found` 24h / `absent` 24h / `throttled` 15s | ✅ |
| 分页懒加载 | `RankingDetail` 30 首/页 + 滚动续载 | ✅ |
| 并发闸门 | 批量 fetch 在途 ≤ 8 | ✅ |
| 持久化 | `poster_urls` 侧表（`migrations/0022`），读取时走**旁路数组** | ✅ |
| 先查库 | 批量/单条路由先算键 → `loadPosterUrls` → 命中即短路，不再回源 | ✅ |
| 导入即种子化 | 豆瓣豆列/清单（电影·书籍）与网易云歌单（音乐）导入时，把封面**顺带写进 `poster_urls` 侧表**：键与客户端之后发来的批量请求逐字一致，之后榜单/广场/分享/单条查询一律命中侧表 → 零回源、封面稳定、跨用户共享 | ✅ |
| 取图优先级 | **音乐：网易云 CDN 直出优先，豆瓣垫后**。两档并行取，返回数组顺序即前端尝试顺序；网易云封面 `p*.music.126.net` 浏览器直连、不占豆瓣抓取配额，豆瓣封面必须走 `/api/image` 补 Referer 且并发下会被 418 打回 | ✅ |
| 自带封面优先 | `Poster` 把作品自带的 `posterUrls`（导入网易云时拿到的封面）排在解析候选之前，加载失败再依次降级 | ✅ |
| 刷新即重试 | 每次页面加载首次批量带 `retry: true`，服务端据此绕过被限流的负缓存 | ✅ |
| 失败可观测 | 批量失败写入 `poster_errors(source = 'batch'/'single')` | ✅ |

> 取图优先级只调整了**音乐**：电影/书籍仍保持"豆瓣准确度优先"，因为网易云没有影视/图书封面，
> 而 IMDb/Amazon（可直连）的封面常与豆瓣不是同一版设计。回归护栏见 `worker/posterPriority.test.ts`。
>
> 导入种子化三条路径共用 `seedImportedPosterUrls()`（`worker/import.ts`）：落库前统一过
> `allowedImage()`（与 `/api/image` 同一套主机白名单，顺带 http→https），并跳过豆瓣
> `/f/shire/` 静态占位图——把"没有封面"的占位图写进侧表会让所有用户都看到假封面。
> 回归护栏见 `worker/importSeed.test.ts`。

**已修复（原线上活跃风险）**：`attachStoredPosterUrls()` 曾把海报地址**注回 `post.items`**，而 `plaza_posts` / `user_collections` / `share` 等写入路径没有剥离护栏 —— 作者编辑一次帖子即会把海报地址写回库，重演 512KB 故障（`51dfc8d` 修的就是这条链）。

**根因与修法**：仓库里曾存在三套各写各的"可落库形状"，且体积判定口径不一致（`plaza.ts` 用 `raw.length`，其余用字节）。Phase 0 把语义收敛为唯一实现 `shared/storedItem.ts`（客户端与 Worker 共用）：

- **白名单投影**而非 `delete posterUrls`：未知字段默认进不了库；
- **唯一编码出口** `encodeStoredWorks / encodeStoredRankings / encodeStoredProfile`，统一按 UTF-8 字节判定，5 条写入路径全部改走它；
- **读取端自愈**：库中残留 posterUrls 的旧行读出来即干净，无需迁移脚本；
- **静态护栏** `worker/payloadGuard.test.ts`：编码器之外再出现针对载荷的 `JSON.stringify` 直接让测试变红。

### 2.4 首屏渲染

**建议**：
- 首页 3D 光球（OrbScene）已做 lazy load，但 CSS 中 `.orb-scene-fallback` 的背景色应与光球初始帧一致，避免闪烁
- 考虑给首页加 `Suspense` fallback 的骨架屏

### 2.5 画像读写的单侧校验（✅ 已修复）

**现象**：云端清单（150 首网易云歌单）→「不排序直接成榜单」→ 跳转 `/myself` 能看到榜单，**刷新一次就整份画像消失**，且云端也恢复不回来。

**根因**：写读两侧对"合法榜单"的定义不一致，且读侧的失败代价是删除用户数据。

| 环节 | 旧行为 |
|---|---|
| 导入 | `applyImportedWorks` 的 `seen` 只由「已有清单」构建，**不加入本批已接受的作品** → 同一批里的同名曲目全部放行 |
| 写入 | 三处保存路径只重排 `rank`，**不做 identity 去重** |
| 读取 | `parseRanking` 遇重复判 `Duplicate artwork` 并 **throw**；`readProfile` 把任何异常当作"本地数据损坏"，把原文丢进 `:recovery` 后 **`removeItem(LIBRARY_KEY)`** → 整份画像消失（`parseProfile` 是整份画像一起校验，一份榜单坏掉会连坐全部） |
| 云端 | 云端那份是同一份内存数据，`parseProfile` 同样抛错 → 换浏览器也恢复不出来 |

网易云导入**不带 `year`**，而 identity 是 `标题|年份|作者`，于是「童话/光良」「水手/郑智化」「大城小爱/王力宏」「后来/刘若英」「绿光/孙燕姿」「广岛之恋/莫文蔚/张洪量」这类同名同歌手曲目必然相撞（线上帖子 32 里可逐条看到）。

**修复**（口径收敛到唯一实现 + 读侧永不删数据）：

| 位置 | 改动 |
|---|---|
| `profile.ts` `workIdentity()` | 全仓**唯一**的去重口径，读写两侧、导入、云端清单共用 |
| `profile.ts` `toRankedItems()` | **写入端唯一入口**：白名单投影 → identity 去重 → 补齐 id → 重排 `rank`。返回值保证满足 `parseRanking` 的全部约束，即"写进去的一定读得出来" |
| `profile.ts` `parseRanking()` | 单条作品的问题只丢那一条并重排 `rank`；重复曲目**合并**而非作废整份榜单 |
| `profile.ts` `parseProfile()` | 一份榜单坏掉只跳过它，不再连坐整份画像 |
| `profile.ts` `readProfile()` | **绝不删除用户数据**：主键原地保留，坏主键不覆盖已有好备份；主键真丢了时从 `:recovery` 自动恢复（旧版本误删的画像因此能救回来） |
| `useSorting.ts` | 排序完成路径改走 `toRankedItems`（此前既不白名单也不去重，还会把 `posterUrls` 写进 localStorage）；导入、云端上传/下载均按同一口径去重；合并了重复项时**明确提示用户**而不是静默改数据 |
| `App.tsx` | `useAuth` / `useSorting` 的 `persist` 不再各写一份未清洗实现，统一复用含白名单的 `persist`；清除数据时一并清掉备份键 |

**回归护栏**：`src/lib/profile.test.ts` 用线上帖子 32 里真实相撞的曲目做 fixture，钉住「重复→合并、脏数据→单条丢弃、写入端产物必可被读取端接受、读取端永不删数据」。

### 2.6 音乐试听 / 歌词（✅ 已修复误播与可诊断性）

**线上实测**（`sort.logicc.top`）：

| 现象 | 证据 |
|---|---|
| 点「试听」播了一首**毫不相干**的歌 | `GET /api/music/play?q=zzzzqqqxxx` 返回 `Can't Give Up` / `ZXXXQ`，且 `isCover:false`（连"仅提供翻唱"的提示都没有） |
| 连点十来次后被拦，界面却说"没找到" | 撞上 `429 rate_limited`（试听+歌词共享 `music` 桶 **12 次/10 分钟**），而服务端给的 `retry-after: 60` 与 10 分钟窗口不符；客户端把 429/404/502 一律折叠成 null → 统一显示"未找到可试听的版本" |
| 同一首歌忽好忽坏 | 同一查询先 502 `music_search_failed`、紧接着 200；`gdSearch` 还会把 `200 + 非数组` 的响应当成"没有结果"**缓存 10 分钟** |

**修复**：

| 位置 | 改动 |
|---|---|
| `gdstudio.pickTracks()` | **歌名必须对上**才算候选（原先"一条都没对上"时会把搜索结果原样返回，于是播无关的歌、也给无关的封面）；只有歌手相同不再入选 |
| `gdstudio.gdSearch()` | 只缓存数组响应，非数组不再被当成"没有结果"缓存 10 分钟 |
| `/api/music/play`、`/api/music/lyric` | `retry-after` 60 → **600**（与实际 10 分钟窗口一致） |
| `src/lib/gdMusic.ts` | 保留失败原因（`rate_limited` / `upstream_limited` / `not_found` / `unavailable`）+ `retry-after`，不再一律折叠成 `null` |
| `ArtworkDetail` | 按原因给提示："操作太频繁了，请 10 分钟后再试" / "音乐服务暂时限流" / "未找到可试听的版本" |

**第二轮（配额与译文）**：

| 位置 | 改动 |
|---|---|
| `allowUpstreamRequest` | 新增 `music_play` / `music_lyric` 两个桶：**试听与歌词各 12 次/10 分钟**，互不吃额度（原先共享一个桶，点 6 首各看歌词就撞上） |
| `gdstudio.playNeedsUpstream()` / `lyricNeedsUpstream()` | 命中缓存（搜索 + 首候选的播放链/歌词）时**零上游调用 → 不记账**；只有能**证明**完全不需要上游才放行，拿不准一律照记（保守，不放松保护） |
| `ArtworkDetail` + `styles.css` | **渲染译文**：行数与原文一致时逐行配对（`.music-lyric-line` + `.music-lyric-translation`）；行数不同（`stripLrc` 对两段各自去空行/去重）时译文单独成段，绝不逐行错位 |

**回归护栏**：`worker/musicMatch.test.ts`（12 项）、`src/lib/gdMusic.test.ts`（13 项）。

---

## 2.6b 算法三模式（排序：简易/经典/精确；比较：三档深度）（✅ 2026-09-20，见 [PLAN-algo-modes.md](./PLAN-algo-modes.md)）

quick=守门员截断（满员后 1 次比较出局，gate→bisect 两阶段）；precise=验证 max(4,ceil(topN/2)) + 未比较相邻对主动入队 + 回环阈值 2× + 校准一致率统计（完成 notice 汇报）；比较侧 mergeDimensionRankings 支持 best/median 聚合，CompareView 三档深度（simple 隐藏折叠区、precise 展开全部+共识构成+全量分歧表）。排序/深度选择均 localStorage 持久化，classic 缺省零迁移（旧草稿/旧快照 deserialize 自动补 mode/calibration/stage）。测试 239→255（ranking +10、profile +6）。

## 2.7 AI 点评三场景 + 双通道四协议（✅ 2026-09-19 完成，见 [PLAN-ai-insights.md](./PLAN-ai-insights.md)）

原「AI 解读」只有比较场景一个入口、模型硬编码、摘要只是标题列表。本次落地：

| 能力 | 实现 |
|------|------|
| 三场景 | 榜单点评（ProfileView 榜单级）/ 画像点评（ProfileView 画像级）/ 比较解读（CompareView「AI 观察」卡改造），共用 `AiInsightCard` |
| 双通道 | 内置（`AI_API_URL/KEY` + 新增 `AI_MODEL/AI_PROTOCOL`，默认行为与旧版逐字一致=零迁移）+ 用户自带（网页端三参数，存 localStorage，经 Worker 转发，key 不落日志） |
| 四协议 | Chat Completions / Responses API / Anthropic Messages / Gemini Native 全按原生形态适配；auto 探测 404 降档并按 baseUrl 缓存 |
| 模型列表 | `POST /api/ai/models` 代理各家列表端点（gemini 自动剥离 `models/` 前缀），设置面板 datalist 点选 |
| 提示词模块化 | ROLE/TASK/CONSTRAINT/OUTPUT 指令模块 + dataBlock 数据块（数据只进数据块，无自由文本注入面）；输出三档长度 + 中英 locale；管理端可在线覆盖 system（`admin_config`，写审计），响应回显 `promptVersion` |
| 安全 | 自定义 baseUrl 强制 https、拒字面 IP/localhost/metadata；限流桶 `ai 8 / ai_custom 15 / ai_test 5 / ai_models 10`（次/10 分钟）；错误码分类透传 |

**实施偏离说明**（相对 PLAN）：`dataBlock` 的 compare 场景按每维度一节的紧凑格式渲染（计划只写了字段），实现时补了空 `media`（无共同维度）的显式文案；前端会话缓存的失效粒度包含 `length`（计划未明确）。

**回归护栏**：`worker/ai.test.ts`（41 项：端点归一 8 / 配置校验 8 / 协议适配与错误映射 7 / 自动探测 5 / 提示词模块 10 / 模型列表 4 / 探活 1，四协议请求形状与响应解析全 stub 实测）+ `src/lib/aiInsight.test.ts`（19 项：配置存取与隐私模式、三场景组装截断、请求失败透传、会话缓存）。**测试基线 179 → 239 passed**。本地 e2e：mock 服务器（`npm run ai:mock`）四协议端点与错误注入实测通过；SSRF 拒绝 localhost 实测生效；内置通道转发与错误映射实测（404→`upstream_not_found` 中文文案）。

**真实上游矩阵（2026-09-19，`token-plan-cn.xiaomimimo.com` / `mimo-v2.5`，Chat Completions 协议）**：`/api/ai/test` 探活 ✅（回显 protocol=chat）；`/api/ai/models` ✅（6 个模型含 `models/` 无前缀）；`/api/insights` 内置通道 ranking ✅（~30s）/ profile ✅ / compare(brief) ✅（20s）/ compare(en+deep) ✅（英文输出）；自定义通道（请求体带 config）✅；错误注入：错 key → `upstream_auth_failed` ✅。其余三协议（Responses/Anthropic/Gemini）该网关不支持（探测路径 404/模型解析失败），与 auto 降档设计一致，待接入对应服务商补测。

**真实测试发现的两个缺陷（当轮修复）**：① 推理型模型生成 250 字点评实测 14–30s，20s 默认超时必然掐断（表现为 `upstream_error`）——Worker 默认超时 20s→60s，前端 30s→70s，另加 `Promise.race` 兜底（防 miniflare/dev 环境 signal 不生效的挂死连接，生产无害）；② 探活 `max_tokens=16` 被推理模型的推理段耗尽、content 为空被误判失败——探活配额提到 256。**验证插曲**：本地 wrangler dev 一度对所有请求（含不涉外的 /api/health）挂起，属本地 workerd 实例坏死假象，重启后全部场景通过；其余三协议的真实矩阵与线上探针仍待部署后执行。

**验证记录**（§7.2 执行摘要）：`/api/ai/test` 对 `http://localhost` 返回 400 `invalid_config`（SSRF 生效）；`/api/insights` 内置通道在 mock 404 时返回分类文案——路由、env 通道选择、`callAi`、错误映射链路全部走通。

---

## 3. 后端优化

### 3.1 D1 查询合并

**现状**：`getDashboard` 函数发起 10 个独立 SQL 查询（`Promise.all`），每个查询一次 D1 round-trip。

**建议**：用 CTE 合并概览查询：

```sql
WITH overview AS (
  SELECT
    COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS total_visits,
    COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS visits_7d,
    COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS total_completed,
    -- ...
  FROM analytics_events
),
daily AS (
  SELECT strftime('%Y-%m-%d', created_at) AS date,
    COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS visits,
    COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completions
  FROM analytics_events
  WHERE created_at >= datetime('now', '-14 days')
  GROUP BY date ORDER BY date DESC LIMIT 14
)
SELECT * FROM overview;
```

可将 10 次 round-trip 减少到 3-4 次。

### 3.2 API 日志批量写入

**现状**：每次 API 调用都执行 `INSERT INTO api_logs`，高频场景下 D1 写入成为瓶颈。

**建议**：

```typescript
// 内存队列 + 定时 flush
const logQueue: Array<[string, string, number, number, string, string?]> = [];
let logFlushTimer: number | undefined;

function enqueueLog(path: string, method: string, status: number, duration: number, source: string, error?: string) {
  logQueue.push([path, method, status, duration, source, error]);
  if (logQueue.length >= 50) void flushLogs();
  else if (logFlushTimer === undefined) logFlushTimer = setTimeout(() => void flushLogs(), 5000);
}

async function flushLogs() {
  if (logFlushTimer !== undefined) { clearTimeout(logFlushTimer); logFlushTimer = undefined; }
  const batch = logQueue.splice(0);
  if (!batch.length || !env.DB) return;
  // D1 batch API 或逐条插入
}
```

### 3.3 缓存策略改进 （✅ 跳过 — 当前内存缓存已满足需求）

Top250 内存 Map + 15 分钟 TTL 对当前流量已足够。D1 高频写入已通过日志批量写入优化。图片代理已有 Edge Cache 24h。跨实例共享缓存需引入 KV 或 Cache API 绑定，改动量大且收益有限。

| 资源 | 当前 | 建议 |
|------|------|------|
| Top250 索引 | Worker 内存 Map（15 分钟） | 改用 Cloudflare Cache API，跨实例共享 |
| 海报 URL | ✅ L1 isolate LRU + L2 Edge Cache（`found`/`absent` 24h、`throttled` 15s）+ 单条响应 `max-age=86400` | 已落地，无需变更 |
| AI insights | 无缓存 | 基于 summary hash 缓存 1 小时（`Cache API`） |
| 图片代理 | Edge Cache 24h | 已合理，无需变更 |

### 3.4 数据库清理

**现状**：D1 无自动清理策略，`analytics_events` 和 `api_logs` 无限增长。

**建议**：添加 Cloudflare Cron Trigger：

```typescript
// worker/index.ts - scheduled handler
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    await env.DB.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM api_logs WHERE created_at < datetime('now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM poster_errors WHERE created_at < datetime('now', '-180 days')").run();
  }
}
```

```jsonc
// wrangler.jsonc（实际配置为每周一凌晨 3 点）
{
  "triggers": {
    "crons": ["0 3 * * 1"]
  }
}
```

### 3.5 限流窗口的内存上界 （✅ 2026-09-18 完成）

**问题**：`allowUpstreamRequest` 的 isolate 级 Map 键为 `bucket:ip`，写入后**没有任何淘汰
路径**——只有同一个键再次出现时才可能重置，于是不同 IP 只增不减，长寿命 isolate 里会随
访问者数量单调增长。（外部分析报告把它称作"P0 内存泄漏"，定级过高：每条约 50 字节且随
isolate 回收释放；但无界本身是真的。）

**实施**：窗口语义抽到 `worker/rateWindow.ts`：

- 保留逐字等价的行为：窗口过期即重开并计 1；达到上限时不再自增、返回 `false`
- 写入后惰性清扫（只在超过上界时触发，常规路径仍是一次 Map 查找）：先删已到期条目，
  仍超上界才按插入顺序淘汰。淘汰最坏情况是把某个 IP 的窗口提前重置——只会放宽、不会
  收紧，因此不会误伤正常用户
- 顺带把硬编码在两处（isolate 判定与 Edge Cache 判定）的 10 分钟窗口提成 `RATE_WINDOW_MS`

上界取 5000（约 250 KB）：5000 个不同 IP / 10 分钟已远超本站在单个 isolate 上的真实流量，
正常限流语义不会因淘汰而失效。`worker/rateWindow.test.ts` 覆盖窗口重置、上限拒绝且不自增、
桶与 IP 相互独立、超上界后 Map 不再增长、优先清扫过期条目、淘汰只会放宽共 7 项。

---

## 4. 安全加固

### 4.1 Token 存储 （⏸ 暂缓 — 改动量大，收益有限）

当前 localStorage 存储 token 已满足需求。改 HttpOnly Cookie 需重构整个认证流程。

**现状**：`accountToken` 存储在 `localStorage`，XSS 攻击可窃取。

**建议**：
- 改用 `HttpOnly` + `Secure` + `SameSite=Strict` Cookie
- Worker 端在登录响应中设置 `Set-Cookie`，前端不再手动管理 token
- 需要修改前后端的认证流程

**短期方案**（不改 Cookie）：
- 缩短 token 有效期（30 天 → 7 天）
- 添加 token 刷新机制
- 限制 `localStorage` 访问权限（CSP `script-src` 更严格）

### 4.2 CSP 加固 （✅ 已完成）

**原状**：`img-src 'self' data:` 之外的图片来源靠 `https:` 泛放行，等于允许任意外部图片。

**已落地**（唯一出处是 `worker/index.ts` 的 `SECURITY_HEADERS`，此处只摘录图片与媒体相关指令）：

```
img-src 'self' data: https://*.doubanio.com https://m.media-amazon.com
        https://ia.media-imdb.com https://image.tmdb.org https://*.music.126.net
        https://*.githubusercontent.com https://upload.wikimedia.org
        https://thumb.wikimedia.org https://bkimg.cdn.bcebos.com
media-src 'self' https://*.music.126.net
```

注意两点容易记错的细节：

- `img-src` 用的是 `https://*.doubanio.com`（子域通配），而**应用层**入库/代理白名单是更严的
  `img\d+\.doubanio\.com`（见 §6.3 与 `worker/media.ts` 的 `allowedImage()`）。两者刻意不同：
  CSP 管浏览器能加载什么，白名单管服务端允许写入/代理什么。
- `https://cdn.jsdelivr.net` 属于 `script-src`，不属于 `img-src`；内联脚本用固定 SHA-256 hash 放行。

配套还启用了 COOP、`nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy`
与 `upgrade-insecure-requests`；写接口另有 `assertSameOrigin()` 同源校验。

### 4.3 输入验证

**现状**：`share()` 和 `shareSingleRanking()` 直接把 profile JSON 发送到后端，无前端 schema 校验。

**建议**：发送前调用 `parseProfile()` 校验，避免发送畸形数据：

```typescript
async function shareSingleRanking(ranking: RankingExport) {
  const singleProfile = { ... };
  try { parseProfile(singleProfile); } catch { setNotice("数据格式错误"); return; }
  // ... fetch
}
```

---

## 5. 代码质量

### 5.0 死代码清理 （✅ 已完成）

2026-09 全量审计后的无用代码清理，`tsc --noUnusedLocals`（前端 + Worker）已零告警：

- 删除 `src/App.tsx.bak`（旧版备份文件）与未跟踪的 `wrangler.log`
- `App.tsx`：移除 12 个未使用的 lucide 图标导入、未使用的 `NoteScope` 类型导入、无调用方的 `encode()`（fflate 压缩编码，分享已全面改走服务端短码，`decode` 保留用于兼容旧链接）、从未被读取的 `accountEnabled` 状态及其 `/api/auth/config` 请求
- `ExpandableNote`：移除从未传入的 `onExpand` 分支与 `onExpand ? "查看全文" : "查看全文"` 恒同三元
- `lib/notes.ts`：移除零引用的 `getNote` / `countNotes`
- 测试文件：移除未使用的 `compareDimensions` / `choosePreferred` 导入与 `comp` 变量
- 视图层：移除 `CompareView` 的 `allNotes` 残留计算与 `MediaKind` 导入、`ShareView`/`types.ts` 未用导入、`HomeView` 未用 `ReactNode`、`ProfileView` 拖拽悬停中未使用的 `rect`/`midY` 计算
- `worker/media.ts`：移除未使用的 `extractText` 函数

> 说明：`/api/auth/config` Worker 端点保留（docs 中为文档化 API），仅移除前端无消费方的调用。

### 5.1 测试覆盖

**现状**（2026-09-22）：18 个测试文件、**273 项通过 / 9 项跳过**。`npm test` 全绿；CI 每次都跑。

已覆盖的核心模块：

| 测试文件 | 覆盖内容 |
|----------|----------|
| `src/lib/profile.test.ts` | 画像解析、去重口径、坏数据容错、备份恢复（42 项） |
| `shared/storedItem.test.ts` | 可落库白名单、唯一编码出口、UTF-8 字节上限 |
| `worker/posterCache.test.ts` / `posterPriority.test.ts` | 缓存 TTL 分类、取图优先级与短路 |
| `worker/posterStore.test.ts` | 海报键等价性（数字/字符串年份、全角、繁简）、侧表读写 |
| `worker/importSeed.test.ts` | 导入即种子化（白名单校验、占位图跳过、覆盖写） |
| `worker/musicMatch.test.ts` | 歌名匹配、失败原因分类、缓存命中不记账的判定 |
| `src/lib/gdMusic.test.ts` | 上游失败分类、歌词行与译文配对 |
| `worker/rateWindow.test.ts` | 限流窗口语义与内存上界 |

**仍未做**：没有任何覆盖率工具（未安装 `@vitest/coverage-*`），所以**任何"覆盖率 X%"的说法
目前都不可测量**。若要让覆盖率成为可追踪指标，先建立基线：

```jsonc
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // 先只报告、不设阈值；等基线稳定后再逐目录提阈值
      reporter: ["text", "lcov"]
    }
  }
})
```

### 5.2 TypeScript 严格化 （⏸ 暂缓 — 需大量类型断言修复）

开启 `noUncheckedIndexedAccess` 需修复数百处类型断言，建议大版本迭代时逐步开启。

```jsonc
// tsconfig.app.json 建议开启
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,   // Map.get() 返回 T | undefined
    "exactOptionalPropertyTypes": true,  // 区分 undefined 和缺失
    "noPropertyAccessFromIndexSignature": true  // 强制用 obj["key"] 访问索引签名
  }
}
```

**注意**：开启 `noUncheckedIndexedAccess` 需要大量类型断言修复，建议逐步开启。

### 5.3 CSS 可维护性 （⏸ 模块化仍暂缓；**损坏 content 已于 2026-09-19 修复** ✅）

当前压缩单文件已够用。迁移到 CSS Modules 或 Tailwind 需重写所有 class 引用。

**现状**：`src/styles.css` 562 行，大量压缩长行，不可读、不可 diff。

**2026-09-18 发现：文件里存在 4 处损坏的 `content` 声明。**

```css
.metrics-more summary::after{content:"<U+FFFD>?;font-size:10px;…}
.tech-sections details summary::before{content:"<U+FFFD>?;font-size:12px;…}
.advanced-import summary::before{content:" <U+FFFD>? "}
.advanced-import[open] summary::before{content:" <U+FFFD>? "}
```

`U+FFFD` 是替换字符——原本的装饰箭头（形如 `\25B8` ▸ / `\25BE` ▾）在早前的某次编辑里
被编码破坏了。字符串因此没有正常闭合，CSS 解析器只能靠错误恢复跳过，`npx vite build`
每次都会为它打印警告。（这 4 处在 `git show HEAD:src/styles.css` 里同样存在，属历史遗留，
不是本轮引入。）修复需要判断每一处原本用的是哪个箭头，建议与 CSS 可维护性一起处理。

**2026-09-19 修复 ✅ —— 且确认其破坏面远大于"4 条装饰箭头"（线上 UI 回归的真正根因）：**

字节级对比定位到引入点：**`73374fe`（9/18 歌词译文提交）的 styles.css diff 把
`.tech-sections summary::before` 与 `.metrics-more summary::after` 两处的 content
字符串改成了未闭合形式**（闭合引号丢失），父版本 `d5f1ba1` 为 0 处未闭合 / 0 个
U+FFFD。破坏机制：

1. styles.css 是压缩单行文件，一条未闭合字符串在其所在物理行内吞掉**该行剩余的
   全部规则**；esbuild minify 合并行后，吞没范围进一步扩大到产物中下一个引号为止——
   文本仍在（grep 计数正常），但浏览器把它们当字符串丢弃，**不再作为规则解析**；
2. 另有若干注释与 `.advanced-import` 两处 content 的字符损坏（闭合完好，属装饰性）。

实测症状与修复：首页 `.orb-canvas` 的 `width:100%` 失效 → canvas 以 1680 物理像素
裸奔撑爆横向（bodyScrollWidth 1752 > 1280），加上其它被吞规则构成"大量前端 UI 错误"。
修复方式：以 `73374fe^`（好版本）逐行恢复 13 条被破坏行（含 3 条注释），保留该提交的
正常功能改动（`.music-lyric-line/.music-lyric-translation`）。修复后：build 警告消失、
`bodyScrollWidth` 1274（无溢出）、光球正常、各页布局恢复。

**遗留 8 个 U+FFFD 位于闭合完好的注释内（纯文字损坏，无功能影响）**；历史重复定义
清理仍挂待办池。同日另发现本地 dev D1 存有 9/12 写入 bug 产生的 4 条乱码广场帖
（标题字节即 U+FFFD，与代码无关的历史坏数据），已按外键依赖顺序清理。

**另一个决定**：`src/styles.css` 已加入 `.prettierignore` 并**刻意不做格式化**。Prettier 的
CSS 打印器除了 5 类无害归一化（逗号后补空格、小数补前导零、组合器两侧补空格、属性选择器值
补引号、括号内媒体特征名后补空格），还会把 `content:"\25B8"` 改写成 `content:" \25B8 "`——
按 CSS 转义规则，转义后的那个空格会被当作终止符吃掉，字符串凭空多出一个前导空格，折叠标记
真的会位移。为了把 `--bg:#x` 改成 `--bg: #x` 而引入 1276 节点重排并附赠一个真实视觉改动，
不划算。

**建议**：
- 开发时维护未压缩版本，构建时通过 Vite 插件压缩
- 或迁移到 CSS Modules（`styles.module.css`），与现有 class 名兼容
- 或引入 Tailwind CSS（与现有的 `glass-capsule` 等自定义 class 共存）
- 顺手清理历史重复定义（`.rank-detail-dialog` / `.guide-help-btn` / `.profile-layout section` /
  `.ranking-card-*` 各出现两份）

---

## 6. 用户体验

### 6.1 排序进度预估改进 （✅ 已完成）

**现状**：已改进为混合预估——初期使用理论公式，处理3个以上作品后切换为60%实际速率+40%理论速率的加权混合，显著提升预估准确度。

**建议**：基于滚动平均：

```typescript
// 用最近 10 次比较的实际耗时推算
const recentDurations = decisionLog.slice(-10);
const avgComparisonsPerItem = comparisonCount / processedCount;
const remaining = sourceIds.length - processedCount;
const estimatedRemaining = Math.round(remaining * avgComparisonsPerItem);
```

### 6.2 PWA 离线支持 （✅ 已完成）

- `public/manifest.json`：PWA 清单文件（名称、主题色、图标）
- `public/sw.js`：Service Worker 缓存静态资源（JS/CSS/HTML/图片）
  - 带 hash 的静态资源 cache-first；**导航请求 network-first**（部署后立即生效）
  - 导航成功只刷新 SPA shell（`/index.html`）缓存，避免任意路径撑爆 Cache Storage
  - 离线时导航回退到 `/index.html`（SPA 路由兼容）
  - API 请求不缓存（`/api/*` 跳过）
  - 新版本自动清除旧缓存
- `index.html`：注册 Service Worker + 链接 manifest
- 支持「添加到主屏幕」（standalone 模式）

### 6.3 无障碍改进 （✅ 部分完成）

| 问题 | 修复 | 状态 |
|------|------|------|
| 排序卡片缺少 ARIA 角色 | `<div role="group" aria-label="选择更偏好的作品">` | ✅ |
| 进度条缺少 ARIA 属性 | 已有 `role="progressbar"` + `aria-valuenow` 动态更新 | ✅ |
| 弹窗焦点陷阱 | `FocusTrap.tsx` 已存在；引导与 AI 配置已接入，其余 modal 待推广 | 🟡 部分 |
| 海报图片 alt 文本 | 改为「作品名 - 创作者 (年份)」格式 | ✅ |
| 颜色对比度 | `--muted` (#a1a8a2) 在深色背景上对比度偏低 | ❌ 待调整 |
| 广场筛选/排序按钮 | 添加 `role="tab"` + `aria-selected` + `aria-label` | ✅ |

### 6.4 国际化完善 （⏸ 暂缓 — 大型重构，当前内联翻译已满足中英双语需求）

提取翻译到 locale 文件需改动所有视图组件，收益有限。

**现状**：使用 `t(zh, en)` 函数内联翻译，缺少系统性。

**建议**：
- 提取所有翻译文本到 `locales/zh.json` 和 `locales/en.json`
- 使用 `i18next` 或简单的翻译文件 + hook
- 便于未来添加更多语言

---

## 7. 部署与运维

### 7.1 CI/CD

**现状**：✅ 已完成。`.github/workflows/ci.yml`（2026-09-18 补入 lint 与 format:check）。

```yaml
name: CI
on:
  push:
    branches: [main, "docs/**"]
  pull_request:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run check          # tsc -b
      - run: npm run lint           # eslint（react-hooks + no-unused-vars）
      - run: npm run format:check   # prettier --check
      - run: npm test -- --run
      - run: npm run build
```

`npm run lint` 当前是 0 error / 39 warning（`exhaustive-deps` 与未使用变量）。warning 不
阻塞 CI——这是刻意的：这些 warning 是待办线索，不是门禁。

### 7.2 监控 （✅ 部分完成）

- `/api/health` 已增强：返回版本号、时间戳、数据库连接状态
- 外部监控（UptimeRobot / Cloudflare Notifications）待配置
- 豆瓣接口错误率告警（基于 `poster_errors` 表的增长速率）
- Worker CPU 时间和内存使用监控（Cloudflare Dashboard → Observability）

### 7.3 环境管理 （✅ 已完成）

- `.dev.vars` 已在 `.gitignore` 中
- 环境变量通过 `wrangler secret` 管理
- 预览环境使用独立 D1 数据库待配置（需 Cloudflare Dashboard 操作）

---

## 实施优先级

| 优先级 | 项目 | 状态 |
|--------|------|------|
| **P0** | 视图组件拆分 | ✅ |
| **P0** | 排序/画像核心测试 | ✅（最新基线见 §5.1） |
| **P0** | 画像读写单侧校验 | ✅ 见 §2.5 |
| **P0** | 首屏 3D 光球移出关键路径 | ✅ 2026-09-18，见 §2.1 |
| **P0** | 限流窗口内存上界 | ✅ 2026-09-18，见 §3.5 |
| **P0** | lint / format 工具链 + 全仓格式化 | ✅ 2026-09-18，见 §1.1、§7.1 |
| **P1** | Bundle 按需加载（QRCode / fflate / lucide） | ✅ |
| **P1** | D1 查询合并 + 日志批量写 | ✅ |
| **P1** | CSP 加固 | ✅ img-src 白名单 |
| **P1** | 海报管线 Phase 0/1/2 | ✅ 见 [PLAN-poster-pipeline.md](./PLAN-poster-pipeline.md) |
| **P1** | 导入时把封面写进 `poster_urls` 侧表 | ✅ |
| **P1** | 音乐试听 / 歌词（含独立配额与译文） | ✅ 见 §2.6 |
| **P1** | 音乐封面取图网易云优先、豆瓣兜底 | ✅ |
| **P1** | AI 点评三场景 + 双通道四协议 + 提示词模块化 | ✅ 2026-09-19，见 §2.7 |
| **P1** | Token 安全加固 | ⏸ 暂缓（原因见下） |
| **P1** | CI/CD 流水线 | ✅ |
| **P2** | 海报缓存优化 | ✅ |
| **P2** | TypeScript 严格化 | ⏸ 暂缓 |
| **P2** | 数据库自动清理 | ✅ Cron Trigger |
| **P2** | 无障碍改进 | ✅ 部分完成 |
| **P3** | PWA 离线支持 | ✅ 见 §6.2 |
| **P3** | CSS 模块化 / 修 4 处损坏的 `content` | ⏸ 暂缓，见 §5.3 |
| **P3** | 国际化系统化 | ⏸ 暂缓 |
| **P3** | 排序撤销性能优化 | ✅ 快照法 O(1)，见 §2.2 |
| **P3** | catalog.ts 动态加载 | ⏸ 暂缓 |

> **本表是实施状态的唯一出处。** 历史上"未完成项说明"与"可优化点清单"里出现过
> ❌ PWA 离线支持、❌ 排序撤销性能优化，与本节 ✅ 直接矛盾——这两项实际都已落地。
> 本次校订已按上表口径统一，并删掉了重复的条目清单。

### 广场功能

广场（帖子 CRUD + 点赞 + 留言/回复 + 编辑历史 + 发布 + 广场→排序互动）已全部上线。
功能清单与入口以 `FEATURES.md` 为准，本文不再重复维护一份（此前这里列了 20 条"额外优化"，
其中"区分比较链接和分享链接"还重复出现了两次）。

---

## 暂缓项及其原因

### ⏸ Token 安全加固（P1）

**原因**：需要改造整个认证流程。当前 `accountToken` 存储在 `localStorage`，改为 HttpOnly Cookie 需要：
- Worker 端登录响应改用 `Set-Cookie` 替代 JSON body 返回 token
- 前端所有 `/api/account/*` 请求不再手动携带 `Authorization` 头，改为浏览器自动附带 Cookie
- OAuth 回调流程从 URL 参数传 token 改为 Cookie 设置
- 同步机制（`syncProfile`、`pagehide`/`visibilitychange` 的 keepalive 请求）需要适配 Cookie 模式
- 影响范围：`worker/account.ts`（登录/OAuth）+ `src/App.tsx`（所有认证相关逻辑）

改动量大且涉及安全关键路径，需要充分测试，不宜在批量优化中一并处理。

### ⏸ TypeScript 严格化（P2）

**原因**：开启 `noUncheckedIndexedAccess` 后，所有 `Map.get()`、数组索引访问都返回 `T | undefined`，需要在数百处添加非空断言或类型守卫。`exactOptionalPropertyTypes` 会改变 `interface` 中 `prop?: T` 的语义，现有代码中大量使用 `undefined` 赋值的地方需要逐一修复。

建议在大版本迭代时逐步开启，而非一次性修改。

### ⏸ 无障碍改进（P2，已部分完成）

**已完成**：ARIA 属性增强（duel-grid、广场筛选、海报 alt）、新手引导使用 `FocusTrap`。

**剩余子项**：
- 焦点陷阱推广到全部 modal——需要引入 Radix Dialog 或手动实现，与现有 `modal-backdrop` 模式冲突
- 海报 alt 文本改为作品名——当前 `Poster` 组件的 `alt` 是通用文案，改为动态值需要调整组件接口
- `--muted` 对比度调整——需要验证所有使用场景的视觉效果
- toast 队列化 + `aria-live` 播报（现在多条通知会互相顶掉）

各项独立性高，建议按子项逐步推进，不阻塞其他优化。

### ⏸ CSS 模块化（P3）

见 §5.3。除了拆分压缩长行，还需一并修掉那 4 处 U+FFFD 损坏的 `content` 声明。

### ⏸ catalog.ts 动态加载（P3）

**原因**：`catalog.ts`（36 KB）是电影目录数据，通过 `media.ts` 的 `fromFilms()` 在模块初始化时构建 `mediaCollections` 常量。改为动态加载需要：
- 将 `mediaCollections` 从同步常量改为异步加载（`Promise<MediaCollection[]>`）
- 所有调用 `getCollectionsByKind()` 的地方改为 `await`（涉及 HomeView、SourceView 等多个组件）
- 首页媒介选择卡片需要在数据加载前显示骨架屏

改动链路长且影响首屏渲染逻辑。`"sideEffects": false` 已添加，Vite tree-shaking 已生效，实际收益有限。

---

## 待办池（滚动更新）

来源：外部分析报告核验结论（见 [REVIEW-2026-09-external-reports.md](./REVIEW-2026-09-external-reports.md)）、
`npm run lint` 的 39 条 warning、以及日常开发中的观察。**这不是承诺清单，只是候选池。**

### UI / 组件精修
- [x] `src/styles.css`：~~修掉 4 处 U+FFFD 损坏的 `content` 声明~~ ✅ 2026-09-19 已修复（含根因分析见 §5.3）；~~清理历史重复定义~~ ✅ 同日清理 9 条 byte-identical 重复（`.rank-detail-dialog` border 组 / `.guide-help-btn` 主+媒体 / `.profile-layout section` / `.ranking-card-poster`+top3 四连各 2 份，删前留后 cascade 等价）；~~补 `mini-note`/`badge` 系缺失类~~ ✅（`.mini-note`/`.badge`/`.badge-visit` 以主题令牌补定义）；新增手机端 `.metrics{overflow-x:clip}` 兜底比较页瞬态溢出。剩余：注释内 8 个无害 U+FFFD 文字
- [ ] `worker/index.ts`（~2848 行）按资源拆成 `worker/routes/*`；`src/views/PlazaPostView.tsx`（~1101 行）拆出评论区、作者编辑区子组件
- [ ] **无障碍剩余项（详见 `UI_REVIEW.md` 的「剩余未完成项」）**：`ExpandableNote` 是 `<p onClick>`，没有 `tabIndex`/`role`/`onKeyDown`，键盘无法触发"查看全文"；14 处 modal backdrop 缺 `aria-hidden`；焦点陷阱只接了新手引导一处（`FocusTrap`）；`RankingDetail` 行首奖牌 emoji 缺 `aria-hidden`
- [ ] toast 通知队列化（现在多条会互相顶掉）+ `aria-live` 播报
- [ ] `OrbScene` 移动端降级（低 dpr / 小屏减粒子或静态图）
- [ ] 广场 / 比较长列表虚拟化（> 200 项时）
- [ ] 主题切换器下拉在 cyber / retro 下的对比度微调（菜单 hover 态）
- [ ] retro 主题字体本地化（Manrope / DM Mono woff2 入 `public/fonts`，当前回退系统字体）

### 数据 / 逻辑
- [ ] **`pickTracks` 补繁简归一**：`worker/gdstudio.ts` 的 `norm()` 只做 `NFKC + toLowerCase + 去标点`，而 **NFKC 不统一繁简**，所以「告白氣球」与「告白气球」当前不匹配、会被判成"未收录"。这是收紧歌名匹配后唯一被确认的召回缺口（只扩召回，不放松精确性）
- [ ] `clearAllData` 与登出的 localStorage 清理集合不一致（notes 一处清一处不清）
- [ ] `other` 类别的 `/api/posters` 解析路径未接维基（仅详情带图；搜索候选带图已可用）
- [ ] 网易云扫码 risk 判定后 unikey 已销毁，「再试一次扫码」会重新签发——可保留原 unikey 轮询恢复窗口
- [ ] `doubanSearch` 无 music suggest（`/api/douban/music/suggest` 确实缺失，已核实）
- [ ] Poster 缓存键已含 kind，但豆瓣标题常带原文后缀，可把豆瓣干净标题同样喂给维基（当前用的是用户输入标题）

### 后端 / 可观测性
- [ ] `ensureIndex()` / `ensureMusicIndex()` / `ensureBookIndex()` 改为不 `await`（`ctx.waitUntil` 预热）：`doubanTop250(250)` = 10 页，经 `throttle()` 按域名 800ms 串行，冷 isolate 首请求有 **≥8s 墙钟下界**且压在响应路径上。改成后台预热是"命中率换尾延迟"的取舍，**先测量再改**
- [ ] 给取图来源加计数（`direct` 网易云 vs `proxied` 豆瓣 各胜出多少次，写进 `poster_errors` 或新建极简计数表）。动机：音乐封面并行取图时两侧预算不对等（gdstudio 40 次 / 5 分钟 / isolate vs 豆瓣 120 次 / 10 分钟），稀缺的那份还要供试听与歌词用。**先测出 direct 胜出比，再决定是否让豆瓣在 direct 命中时短路**——不要直接改成串行，那会在"网易云失败"这条用户已经在等的路径上再叠一次豆瓣往返
- [ ] 建立覆盖率基线（装 `@vitest/coverage-v8`，见 §5.1）

### 海报管线（详见 [PLAN-poster-pipeline.md](./PLAN-poster-pipeline.md)）
- [x] Phase 0 / 1 / 2 已落地，512KB 体积口径统一为 UTF-8 字节
- [ ] Phase 3：`poster_misses` 失败队列 + cron 定时补温——需新增迁移与 cron，且会持续占用 Worker 出口 IP，**建议在线上观察 Phase 1/2 效果后再落地**

### 文档
- [ ] `FEATURES.md` 的回归走查清单尚未做成可自动化脚本（Playwright）
