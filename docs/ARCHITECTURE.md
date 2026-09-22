# 技术架构文档

本文档详细描述 ART/RANK 的技术实现，包括前端架构、后端服务、数据流、排序算法和部署模型。

---

## 1. 整体架构

ART/RANK 采用前后端一体化架构，部署在 Cloudflare Workers 上：

```
┌─────────────────────────────────────────────────┐
│                  Cloudflare Edge                 │
│                                                  │
│  ┌──────────────┐     ┌───────────────────────┐ │
│  │  Static Assets│     │   Worker (index.ts)   │ │
│  │  (Vite dist)  │     │                       │ │
│  │               │     │  /api/* 路由          │ │
│  │  index.html   │◄────│  /admin 管理后台      │ │
│  │  JS/CSS/IMG   │     │  海报/图片代理        │ │
│  └──────────────┘     │  用户认证             │ │
│                        │  分析事件             │ │
│                        └───────┬───────────────┘ │
│                                │                  │
│                        ┌───────▼───────┐         │
│                        │   D1 Database  │         │
│                        │   (SQLite)     │         │
│                        └───────────────┘         │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          外部服务                          │   │
│  │  豆瓣 / IMDb / Wikipedia / 百度百科       │   │
│  │  / gdstudio / anysearch(搜索代理)         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 请求流

1. 浏览器请求到达 Cloudflare Edge
2. 静态资源（JS/CSS/图片）由 Workers Static Assets 直接返回
3. `/api/*` 请求路由到 Worker 处理
4. HTML 请求未匹配静态文件时回退到 `/index.html`（SPA 路由）
5. Worker 按需查询 D1、Edge Cache / isolate 缓存或外部 API（见 §5.3、§5.5）

---

## 2. 前端架构

### 2.1 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 框架 | React 19 | 成熟的 UI 框架，支持 Suspense/lazy |
| 构建 | Vite 6 | 快速 HMR，ES2022 输出 |
| 3D | Three.js | 首页光球效果 |
| 图标 | Lucide React | 轻量、风格统一 |
| 压缩 | fflate | 仅用于解码旧版内联分享链接（`lib/utils.ts` 的 `decode()`） |
| 二维码 | qrcode | 比较链接二维码生成 |

### 2.2 文件结构

```
src/
├── main.tsx              # React 入口，StrictMode 挂载 + 挂载前应用主题 + 注册 SW
├── App.tsx               # 应用外壳：视图编排/弹窗/分享与导出入口
├── types.ts              # 内置电影目录类型（Movie / FilmList，由 data/catalog.ts 使用）
├── styles.css            # 设计令牌 + 六主题变量块 + 组件样式（data-theme 切换）
├── components/
│   ├── Poster.tsx         # 海报组件（解析/代理/失败上报）
│   ├── RankingDetail.tsx  # 统一榜单详情（分享页/比较详情弹窗/广场帖共用）
│   ├── ArtworkDetail.tsx  # 统一作品详情弹窗（含音乐试听）
│   ├── ThemeSwitcher.tsx  # 顶栏主题切换器（六主题下拉）
│   ├── SettingsMenu.tsx   # 顶栏设置菜单（单次导入上限）
│   ├── ExpandableNote.tsx # 长批注截断 + 展开查看
│   ├── FocusTrap.tsx      # 弹窗焦点陷阱
│   ├── ErrorBoundary.tsx  # 错误边界
│   ├── DeferredOrb.tsx    # 光球加载闸门（空闲时 import，省流/2G 不加载）
│   └── OrbScene.tsx       # 3D 光球场景（reduced-motion 降级）
├── views/                 # 各视图组件（Home/Source/Setup/Sorting/Profile/Compare/Share/Plaza/PlazaPost + types/helpers/IconButton）
├── data/
│   ├── media.ts           # 媒介定义 + 内置榜单
│   └── catalog.ts         # 电影目录数据
└── lib/
    ├── ranking.ts         # 排序状态机（二分插入 + 回环检测 + 验证 + 快照撤销）
    ├── profile.ts         # 画像管理 + 比较算法（Kendall τ/年代偏好/共识评分）
    ├── collections.ts     # 清单导入解析
    ├── exportPng.ts       # PNG 导出：主题感知采样 + 五版式 Canvas 渲染
    ├── notes.ts           # 三级批注存取
    ├── theme.ts           # 主题清单/持久化/data-theme 应用
    ├── gdMusic.ts         # 音乐试听/歌词的前端调用与错误分类
    ├── useSorting.ts      # 排序域状态与动作（集合/草稿/导入/排序机）
    ├── useAuth.ts         # 账号与云同步状态、动作
    ├── useRouter.ts       # History API 路由（View ↔ 路径映射）
    └── utils.ts           # 会话 ID、埋点、文件下载、旧分享链接解码
```

前后端共用的纯函数放在 `shared/`：`shared/storedItem.ts` 定义画像/榜单的**可落库白名单投影**（`MAX_PAYLOAD_BYTES` = 512 KB、`encodeStoredProfile()`、`healStoredProfile()`），前端写入、Worker 写入与读取自愈共用同一份实现。

### 2.3 状态管理

状态按域拆进三个 Hook，`App.tsx` 只保留视图编排、跨域 UI 与弹窗开关。

**路由状态**（`lib/useRouter.ts`）
- `view`: `home / source / setup / sorting / profile / compare / share / plaza / plazaPost`，另有 `plazaPostId`
- 路径映射：`/`、`/catalog/source`、`/catalog/setup`、`/catalog/sorting`、`/myself`、`/encounter`、`/share`、`/plaza`、`/plaza/:id`
- 通过 `history.pushState` 和 `popstate` 事件实现，支持浏览器前进/后退

**排序状态**（`lib/useSorting.ts`）
- `kind`: 当前媒介类型（film / book / music / other）、`source`（builtin / custom / douban）
- `collection`: 当前选中的作品集合；`selected`: 已选中的作品 ID 列表
- `ranking`: `RankingState | null`，排序机状态；`draft`: 排序草稿，自动保存到 localStorage
- 另含 `topN`、`seed`、自定义/豆瓣导入态、`importCap`、`cloudCollections`

**账号状态**（`lib/useAuth.ts`）
- `profile`: 本地艺术人格画像；`peer`: 对方的艺术人格画像
- `accountToken`: 登录 token；`syncStatus`: 同步状态（idle / saving / saved / error）
- `cloudConflict`: 数据冲突弹窗状态

**比较状态**（仍由 App.tsx 持有）
- `compareMode`: 比较模式（auto / manual）
- `compareActiveKind`: 当前比较维度
- `aiInsight`: AI 生成的解读文本

**弹窗状态**（仍由 App.tsx 持有）
- `showGuide`: 使用说明弹窗显示状态，首次访问自动弹出（检查 `art-rank:guide-dismissed`）
- `showTech`: 技术说明弹窗显示状态，从使用说明弹窗进入
- `accountOpen`: 账号弹窗
- `detailWork`: 作品详情弹窗
- `compareRankDetail`: 比较排名详情弹窗
- `peerRankPickOpen`: 选择对方榜单弹窗

### 2.4 数据持久化

| 数据 | Key | 存储 |
|------|-----|------|
| 画像 | `art-rank:library:v2` | localStorage |
| 草稿 | `art-rank:draft:v2` | localStorage |
| 对方画像 | `art-rank:peer:v2` | localStorage |
| 批注 | `art-rank:notes` | localStorage |
| 主题 | `art-rank:theme` | localStorage |
| 账号 token | `art-rank:account-token` | localStorage |
| 会话 ID | `art-rank:session:v1` | localStorage |
| 列布局 | `art-rank:cols` | localStorage |
| 年轮布局 | `art-rank:rings-layout` | localStorage |
| 使用说明已关闭 | `art-rank:guide-dismissed` | localStorage |
| 海报缓存 | `art-rank:poster-cache` | sessionStorage |

其余 UI 偏好同为 localStorage：`art-rank:import-cap`（单次导入上限）、`art-rank:plaza-cols`、`art-rank:plaza-links`（已发布帖子的链接映射）。画像、对方画像与分享载荷共用 `shared/storedItem.ts` 的 512 KB 上限（`MAX_PAYLOAD_BYTES`）。

### 2.5 分享链接编码

现行方案为**服务端短码**：`POST /api/share` 把画像 JSON（经 `shared/storedItem.ts` 的 `encodeStoredProfile()` 白名单投影，≤512KB）存入 D1 的 `shared_links` 表，返回 12 位十六进制码与两个 URL——

- `/share/<code>`：只读分享查看页（ShareView）；
- `/encounter?payload=<code>`：比较链接，前端按短码拉取后直接进入比较。

有效期 7/30/90/365 天可选（默认 30），cron 每周一清理过期行。

历史兼容：`?payload=` 仍支持旧版 fflate 压缩内联编码（`lib/utils.ts` 的 `decode()` 解压，上限 512KB 防 zip 炸弹），仅用于读取存量链接，不再用于生成。

---

## 3. 排序算法

### 3.1 核心数据结构

```typescript
interface RankingState {
  version: 2;                       // RANKING_STATE_VERSION
  seed: string;                     // 随机种子
  topN: number;                     // 保留前 N 名
  sourceIds: readonly string[];     // 所有候选作品 ID
  shuffledIds: readonly string[];   // 种子洗牌后的顺序
  rankedIds: readonly string[];     // 已排序的作品（≤ topN）
  pendingIds: readonly string[];    // 待排序的作品
  deferredIds: readonly string[];   // 暂放的作品
  skippedIds: readonly string[];    // 略过的作品
  outsideTopIds: readonly string[]; // 超出 TopN 的作品
  activeInsertion: ActiveInsertion | null;      // 当前二分插入区间 [low, high)
  phase: "ranking" | "verification" | "complete";
  verificationQueue: readonly VerificationTask[];  // 验证任务队列
  activeVerification: ActiveVerification | null;
  pairEvidence: readonly PairEvidence[];        // 偏好证据记录
  recentPairKeys: readonly string[];            // 冷却用：最近出现过的序对
  preferenceEdges: readonly PreferenceEdge[];   // 偏好有向边
  cycleEvents: readonly CycleEvent[];           // 偏好回环事件
  cycleStatus: "none" | "observed" | "persistent";
  preferenceTension: PreferenceTension;
  comparisonCount: number;
  estimatedTotalComparisons: number;
  processedCount: number;
  nextPresentationIndex: number;
  completed: boolean;
  decisionLog: readonly RankingDecision[];      // 决策日志（用于撤销）
}
```

### 3.2 二分插入排序

`low` / `high` 是 `rankedIds` 上的搜索区间，比较对象恒为该区间的中点
`rankedIds[floor((low + high) / 2)]`（不是整份已排序列表的中位数）。每个候选作品：

1. 取出下一个候选作品（`scheduleNextCandidate` 会避开 `recentPairKeys` 里的冷却序对）
2. 与 `rankedIds[floor((low + high) / 2)]` 比较
3. 候选胜 → `high = 中点`；对手胜 → `low = 中点 + 1`
4. 重复直到 `low >= high`，插入位置即 `low`
5. 将作品插入，超出 `topN` 的移入 `outsideTopIds`

```
已排序: [A, B, C, D, E]  候选: X

第1次: low=0, high=5 → X vs C → X > C → low=3, high=5
第2次: low=3, high=5 → X vs E → X < E → low=3, high=4
第3次: low=3, high=4 → X vs D → X < D → low=3, high=3
插入到索引 3: [A, B, C, X, D, E]
```

### 3.3 冷却机制

- **配对冷却** (PAIR_COOLDOWN=3): 同一对作品至少间隔 3 次比较
- **作品冷却** (WORK_COOLDOWN=4): 同一作品至少间隔 4 次比较
- 防止用户产生比较疲劳和顺序偏差

### 3.4 偏好回环检测

当发现 A→B→C→A 的偏好循环时：

1. 记录循环事件（CycleEvent）
2. 将循环中的每一对加入验证队列
3. 首次出现标记为 "observed"
4. 复测时如果方向一致，累加 consistentConfirmations
5. 所有边一致确认后标记为 "persistent"（真实张力）

### 3.5 验证阶段

排序完成后自动进入验证阶段：

1. 对排序结果中相邻的作品对进行稳定性复测
2. 对循环检测发现的偏好回环进行确认
3. 验证结果不改变排序，但记录偏好证据
4. 验证数量：`min(MAX_BASELINE_VERIFICATIONS, max(1, ceil(topN/3)))`

### 3.6 排序三模式（quick/classic/precise）

`RankingState.mode` 三选一（缺省 classic，零迁移）：

- **quick（简易）**：未满员二分建榜；满员后候选先与**守门员**（末位）比较（`ActiveInsertion.stage="gate"`），输则 1 次出局，赢则升级 bisect 于守门员之前定位；验证仅守门员边界 1 次；
- **classic（经典，默认）**：二分插入 + 冷却 + 回环检测 + 验证阶段（上文 §3.2–3.5）；
- **precise（精确）**：验证数 max(4, ceil(topN/2)) + TopK 内未直接比较的相邻对主动入队 + 回环确认阈值 2× + `calibration` 校准一致率统计（完成时 notice 汇报）。

旧快照/旧草稿反序列化自动补 `mode`/`calibration`/`stage`；`undoLastAction` 重放透传 mode。

### 3.7 撤销

撤销通过重放决策日志实现：

```typescript
function undoLastAction(state: RankingState): RankingState {
  if (!state.decisionLog.length) return state;
  let restored = createRankingState(state.sourceIds, {
    seed: state.seed,
    topN: state.topN || undefined,
  });
  for (const decision of state.decisionLog.slice(0, -1))
    restored = replayDecision(restored, decision);
  return restored;
}
```

---

## 4. 画像系统

### 4.1 数据模型

```typescript
interface ArtisticProfile {
  version: 2;
  profileId: string;       // UUID
  profileName: string;     // 用户自定义名称
  updatedAt: string;       // ISO 时间戳
  rankings: RankingExport[]; // 各维度的排序结果
}

interface RankingExport {
  version: 1;
  profileId: string;
  profileName: string;
  kind: MediaKind;         // film | book | music | other
  collectionTitle: string; // 榜单名称
  createdAt: string;
  items: RankedArtwork[];  // 排序后的作品列表
}

interface RankedArtwork extends Artwork {  // Artwork 定义见 data/media.ts
  rank: number;
}
```

写进 localStorage / 云端 / 分享链接前统一过 `shared/storedItem.ts` 的白名单投影（`STORED_WORK_FIELDS`）：作品只保留 `id / title / rank / creator / year / subtitle`，`posterUrls` 不在其中，改由 `poster_urls` 侧表在读取时挂载（见 §5.3）。

### 4.2 画像合并策略

- 同一 `kind + collectionTitle` 的榜单会被替换
- 不同的榜单追加到 rankings 数组
- 排序按媒介类型固定顺序：film → book → music → other
- 云端合并时重名自动添加后缀：`榜单名称（2）`、`榜单名称（3）`...

### 4.3 比较算法

**维度合并**（mergeDimensionRankings）
- 同一维度下多个榜单合并，同作品取最高名次
- 匹配依据：标题 + 年份 + 创作者（规范化后比较）

**贪心匹配**（greedyMatch）
- 生成所有候选对及其匹配评分
- 按评分降序、排名差升序排列
- 贪心选择不冲突的最优匹配

**比较指标**（`profile.ts` 的 `compareDimensions`，返回 `DimensionComparison`）

主指标（比较页常驻）：
- 作品重合度 `overlap`：共同作品 ÷ 双方去重总数
- 顺序一致率 `orderAgreement`：并列序对剔除后再算，保证相同画像 = 100%
- 加权偏好一致 `weightedTopAgreement`：共同作品按 1/rank 加权

扩展指标（折叠在「更多指标」内）：
| 指标 | 计算方式 |
|------|----------|
| Kendall τ-b | (一致序对 − 不一致序对)/√((C+D+Ty)(C+D+Tx))，线性映射 0-100（50 = 无关） |
| Spearman 一致 | 由名次差的平方和换算，`n < 2` 时为 `null` |
| 前五重合（Top-5 Jaccard） | 双方前五名集合的交并比 × 100 |
| 年代偏好 | 双方完整榜单年代中位数差，每差 1 年 −6 分（任一方无年份为 `null`） |
| 名次距离 | 共同作品的平均名次差（越低越一致） |
| 冠军一致 | 双方第 1 名是否为同一作品 |
| Top 3 共识 | 同时进入双方前三的作品数 |
| 综合共识评分 | 顺序一致 30% + 重合 20% + 加权偏好 20% + (100 − 名次距离) 15% + 年代 15% |

比较页 UI：共识评分圆环 hero（conic-gradient，随主题色）+ 判词 + 上方三项主指标 + 可折叠「更多指标」+ 每指标 ? 悬浮解释。

---

## 5. 后端架构

### 5.1 Worker 路由

`worker/index.ts` 是入口文件，`route()` 按 `url.pathname` 顺序分发：`/api/health`、`/api/events`、`/api/stats`、`/api/poster-errors/client`、`/api/admin/*`、`/api/douban/*`、`/api/posters`、`/api/posters/batch`、`/api/image`、`/api/{movie,book,music}/{list,detail}`、`/api/artwork/detail`、`/api/other/{list,detail}`、`/api/insights`、`/api/music/{play,lyric}`、`/api/auth/config`、`/api/{netease,douban}/*`、`/api/import/*`、`/api/plaza/*`、`/api/comments/*`、`/api/account/*`、`/api/share` 与 `/api/share/:code`、`/api/challenges*`、`/admin`；其余请求交给 `serveAssets()`（静态资源，未命中且 `Accept: text/html` 时回退 `/`）。

完整接口清单与参数见 `API.md`。广场路由（`/api/plaza/*`、`/api/comments/*`）由 `worker/plaza.ts` 处理，`index.ts` 只做分发。

Worker 模块划分：

| 文件 | 职责 |
|------|------|
| `index.ts` | 路由分发、安全头/CSP、限流、cron 清理、API 日志、管理看板内嵌 HTML、详情四步流程 |
| `media.ts` | 豆瓣搜索/详情/Top250/suggest、海报多级解析与两级缓存、图片代理、简介消歧（维基+百科） |
| `posterStore.ts` | `poster_urls` 侧表读写：解析结果落库、读取时挂载 `posterUrls`、导入即种子化 |
| `gdstudio.ts` | 音乐上游（GD Studio API）搜索/播放链/歌词/封面，含 isolate 缓存与预算、失败熔断 |
| `rateWindow.ts` | isolate 级限流窗口（`bucket:ip`、`RATE_WINDOW_MS`、上界与惰性清扫） |
| `other.ts` | "其他"类别维基搜索/详情（opensearch + pageimages 图片） |
| `plaza.ts` | 广场帖子 CRUD/点赞/留言/编辑历史/可见性 + 管理端 |
| `account.ts` | 注册/登录/OAuth/画像云同步/云端清单 + 管理端账户 |
| `import.ts` | 豆列/网易云歌单导入路由（`/api/import/*`）；网易云用 v6 detail + v3 song/detail 分层链（开放接口→weapi 降级+退避，旧 detail 已要求登录） |
| `doubanlist.ts` | 统一豆瓣导入：豆列/subject_collection/mine 三类链接识别与抓取 |
| `netease.ts` | 网易云 weapi 加密、扫码（开放接口+weapi）、Cookie 保险库、用户歌单 |
| `douban.ts` | 豆瓣扫码登录（qrlogin）、dbcl2 入库、Cookie 保险库 |
| `audit.ts` | 管理操作审计写入 |
| `ai.ts` | AI 点评通道：四协议适配（Chat/Responses/Anthropic/Gemini）+ auto 探测、模块化提示词（composePrompt）、自定义配置 SSRF 校验、模型列表代理、管理端提示词覆盖 |

`worker/imdb-posters.json` 是内置海报索引数据（由 `media.ts` 导入）。

### 5.2 数据库 Schema

**权威定义在 `migrations/*.sql`**（共 23 个文件，编号 0001–0022，其中 0008 有两支）；下表只做索引，不复制 DDL。

| 表 | 用途 | 迁移 |
|----|------|------|
| `analytics_events` | 匿名分析事件（事件名白名单 + `json_valid(payload)` 约束） | 0001 |
| `challenge_sets` | 挑战片单（`POST /api/challenges` 写入、`GET /api/challenges/:id` 读取） | 0001 |
| `user_profiles` | 旧版画像表（已被 `user_profiles_v2` 取代） | 0002 |
| `api_logs` | API 调用日志（path/status/duration_ms/source/error/ip） | 0003 |
| `admin_sessions` / `admin_config` | 管理员会话与配置（`password_hash`、`cookie_enc_key`） | 0003 |
| `user_accounts` | 用户账户（`nickname` 0006、`disabled_at` 0008） | 0004 |
| `user_sessions` | 会话 token | 0004 |
| `user_profiles_v2` | 用户画像 + 批注（`profile` ≤512KB、`notes` 默认 `'{}'`，见 0010） | 0004 |
| `user_oauth` | OAuth 关联 | 0004 / 0005 |
| `poster_errors` | 海报错误日志（`source` 见 0017） | 0007 |
| `user_collections` | 云端清单（0021 重建为 `user_collections_v2` 后改名：`item_count` 2–1000、`items` ≤512KB） | 0008 / 0021 |
| `shared_links` | 分享短链（`code` 主键、`profile`、`notes` 见 0013、`expires_at`） | 0009 / 0013 |
| `plaza_posts` | 广场帖子（`description` 见 0012） | 0011 |
| `plaza_likes` | 广场点赞（`UNIQUE(post_id, user_id)`） | 0011 |
| `plaza_comments` | 广场留言（`parent_id` 楼中楼见 0014） | 0011 / 0014 |
| `oauth_exchanges` | 一次性 OAuth code→token 交换（5 分钟有效，阅后即删） | 0015 |
| `admin_audit` | 管理操作审计日志（action/detail/ip/created_at） | 0016 |
| `plaza_post_edits` | 广场编辑历史（有外键，删帖须先删此表） | 0019 |
| `user_cookie_vault` | 外部平台 Cookie 保险库（AES-GCM 密文，密钥存 `admin_config`） | 0020 |
| `poster_urls` | 海报地址侧表（`media_key` = `type\|title\|english\|year`，`urls` JSON） | 0022 |

**索引**：`0018_plaza_perf.sql` 为广场补 `(kind, created_at DESC)` 与 `like_count DESC`，其余索引随建表语句创建。

### 5.3 海报解析与缓存分层

海报获取按优先级尝试多个来源（`worker/media.ts` 的 `computePosters`）；同一条目的多来源结果会合并成一个候选数组，顺序即前端尝试顺序。

**电影**
1. 豆瓣 suggest API（标题与年份均匹配）
2. search.douban.com 搜索
3. Top250 索引缓存（`ensureIndex()`）
4. IMDb suggestion API（精确匹配）

**书籍**
1. 豆瓣 suggest API
2. search.douban.com 搜索
3. Top250 索引缓存（`ensureBookIndex()`）

**音乐**
1. 网易云 CDN 封面（`p*.music.126.net`，浏览器可直连，不占豆瓣配额）
2. 豆瓣 search.douban.com 搜索 + Top250 索引缓存（`ensureMusicIndex()`）

以上都没有结果时统一降级：维基（`searchWikiPoster`）→ 网易云/gd-proxy（音乐档已在前一步取过，不重复请求）。

豆瓣图片会生成多个 CDN 镜像变体（`doubanVariants`，`img1/2/3/9.doubanio.com`），前端按顺序尝试加载。

**缓存分层**（写入时逐层穿透，读取时自上而下短路）：

| 层 | 键 | TTL / 上界 |
|----|----|-----------|
| 客户端内存 | `${kind}\|${title}\|${subtitle}\|${year}`（`Poster.tsx`） | 会话内；`requests` 去重 + `resolvedPosters` 同步副本 |
| 客户端 sessionStorage | 同上，`art-rank:poster-cache` | 上限 500 条，超出淘汰最早一半；空结果不写入 |
| D1 `poster_urls` | `type\|title\|english\|year`（`posterMediaKey()`） | 无过期；空结果不落库（导入路径会「种子化」写入） |
| isolate LRU | 同上（`posterCache` Map） | `found` 24h / `throttled` 15s / `absent` 24h；上限 2000 条，按 LRU 淘汰 |
| Edge Cache | `https://poster-cache.art-rank.internal/` + `posterMediaKey` 的截断 SHA-256（128 bit） | 与 isolate 相同的 TTL 规则，跨 isolate/机房共享 |

失败上报：图片 `onError` 时上报到 `/api/poster-errors/client`，同一 URL 不重复上报。

### 5.4 详情获取策略

作品详情（简介、元数据）获取优先级（`worker/index.ts` 三个 detail 路由 + `worker/media.ts fetchContentIntro`）：

1. **豆瓣官方详情页 v:summary** — detail 路由 Step 2：由搜索得到的 subject 链接直达详情页，零歧义（`content_source=douban`）；
2. **维基百科消歧打分择优** — 并行发起「限定标题精确查询（中/英，如「泰坦尼克号 (1997年电影)」）+ 裸标题 + 搜索」多路；候选按「首句类型声明一致 +3 / 类型词 +2 / 年份 +2 / 标题相关 +1 / 限定命中 +6」打分，消歧义页（"也可以指"等）直接剔除；zh 请求带 `variant=zh-cn`，标题与摘要统一简体后做匹配；搜索候选必须真的提到作品名（标题或摘要含作品名）——榜单/合集页即使通篇像该类型词条也拒绝，宁缺毋滥；
3. **创作者组合搜索** — 如"三体 刘慈欣"；
4. **百度百科** — 兜底；**中文歌名（音乐详情）优先于维基**，因百科词条名通常就是歌名本身，对华语流行单曲覆盖远好于维基。传输按实测可达性排序：**anysearch 搜索**（`api.anysearch.com/mcp`，JSON-RPC `tools/call search`，取词条页结果摘要；服务端抓取绕开百度反爬，带 key 约 4s，`ANYSEARCH_API_KEY` secret 可选）→ **两路百度直连并行兜底**（开放 API 共享 demo appid 自 2026-09 起持续 `errno:6`；词条页对数据中心 IP 常下安全验证页，只读响应头部 96KB。直连失败是 IP 级且持续性的，带 isolate 级熔断：连续 3 次失败停探 1 小时）。音乐中文路径的维基落空后只重试 anysearch（换类型提示词查询，不重复直连）。命中结果进 isolate 级简介缓存（FIFO 200 条，TTL 24h，仅缓存成功值）。`/api/music/detail` 的 gdstudio 元数据与简介两步并行请求。

detail 路由接受 `year`/`creator` 参数辅助消歧（前端传作品已知元数据）。"其他"类别走 `worker/other.ts`（维基 opensearch + pageimages 取图，百科兜底）。

### 5.5 防限流机制

```
请求 → throttle(域名) → buildHeaders() → fetch()
                                                │
                           ┌────────────────────┘
                           │
                    403/418? ──→ cooldown(5s/10s/15s) → 重试(最多2次)
                    超时? ──→ 指数退避(1s/2s) → 重试
```

- UA 轮换：4 个 Edge 浏览器 UA
- 域名节流：同域名串行 + 最小间隔 800ms；`search.douban.com` 例外（200ms），图片 CDN 不受节流
- 冷却期：`upstream()` 在 403/418 后按尝试次数递增冷却（5s → 10s → 15s）；`searchCover()` 只对 `search.douban.com` 设 1.2s 短冷却并重试一次（避免一首歌触发 418 让同批次全部连坐）
- 重试退避：`retries = 2`（最多 3 次尝试），失败后等 1s → 2s；单次请求 15s 超时

---

## 6. 安全模型

### 6.1 HTTP 安全头

```typescript
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; " +
    "img-src 'self' data: https://*.doubanio.com https://m.media-amazon.com https://ia.media-imdb.com " +
    "https://image.tmdb.org https://*.music.126.net https://*.githubusercontent.com " +
    "https://upload.wikimedia.org https://thumb.wikimedia.org https://bkimg.cdn.bcebos.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com 'sha256-…'; " +
    "connect-src 'self' https://cloudflareinsights.com; font-src 'self' data:; " +
    "media-src 'self' https://*.music.126.net; object-src 'none'; base-uri 'self'; " +
    "frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
```

（`script-src` 里的内联脚本用固定 hash 放行，不启用 `unsafe-inline`；`img-src` 的白名单比 `/api/image` 代理更宽，额外放行 `*.githubusercontent.com`。）

### 6.2 输入验证

- 所有用户输入经过 `cleanString()` 清理（trim、长度、控制字符）
- JSON 请求体限制 48 KB（`MAX_REQUEST_BYTES`）
- 海报批量接口独立上限：300 条 / 128 KB（`MAX_POSTER_BATCH_ITEMS` / `MAX_POSTER_BATCH_BYTES`）
- 画像大小限制 512 KB
- 事件 payload 限制 2 KB，仅接受白名单字段（`EVENT_NAMES` + `EVENT_PAYLOAD_KEYS`）
- 同源检查：写入操作验证 Origin 头

### 6.3 图片代理白名单

`worker/media.ts` 的 `allowedImage()` 仅放行以下 host（正则精确匹配，不接受子域通配）：

- `img*.doubanio.com`（`img` + 任意数字）
- `m.media-amazon.com`
- `ia.media-imdb.com`
- `image.tmdb.org`
- `*.music.126.net`（网易云专辑封面）
- `upload.wikimedia.org` / `thumb.wikimedia.org`（其他类别维基图片）
- `bkimg.cdn.bcebos.com`（百度百科配图）

拒绝带凭据、非 80/443 端口或不在白名单的 host；`http:` 会被强制升级为 `https:`。返回非图片 content-type 时以 415 拒绝。

---

## 7. 构建与部署

### 7.1 构建流程

```bash
npm run build
# 等价于：tsc -b && vite build
# 输出到 dist/
```

### 7.2 部署配置

`wrangler.jsonc` 配置 Workers Static Assets 和 D1 绑定：

```jsonc
{
  "name": "film-sort",
  "main": "worker/index.ts",
  "compatibility_date": "2026-08-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": true
  },
  "observability": { "enabled": true },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "film-sort",
    "database_id": "…",              // 实际值见仓库内 wrangler.jsonc
    "migrations_dir": "migrations"
  }],
  "triggers": { "crons": ["0 3 * * 1"] }   // 每周一 03:00 UTC 清理
}
```

`run_worker_first: true` 让 Worker 先处理所有请求：`/api/*` 与 `/admin` 由 `route()` 应答，其余交给 `serveAssets()` 取静态资源；未命中且 `Accept` 含 `text/html` 时回退 `/`，因此 SPA 路由可直接刷新。

### 7.3 Git 集成

部署链路（CI、`npm run deploy`、Cloudflare 侧 Git 集成）见 `CLOUDFLARE.md`。

---

## 8. 测试

```bash
npm test              # vitest run，运行所有测试
npm run test:watch    # 监听模式
npm run check         # tsc -b --pretty false
npm run lint          # eslint（react-hooks/recommended + no-unused-vars=warn）
npm run format:check  # prettier --check（printWidth 100）
```

测试使用 Vitest（`vitest.config.ts` 只收集 `src/**`、`worker/**`、`shared/**` 下的 `*.test.ts`），当前 18 个测试文件、273 passed / 9 skipped，覆盖排序算法、画像比较/解析、集合导入、海报管线、限流窗口、批注白名单与 Worker 载荷校验。CI 步骤见 `OPTIMIZATION.md` §7.1。
