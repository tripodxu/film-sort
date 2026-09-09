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
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 请求流

1. 浏览器请求到达 Cloudflare Edge
2. 静态资源（JS/CSS/图片）由 Workers Static Assets 直接返回
3. `/api/*` 请求路由到 Worker 处理
4. HTML 请求未匹配静态文件时回退到 `/index.html`（SPA 路由）
5. Worker 按需查询 D1、外部 API 或内存缓存

---

## 2. 前端架构

### 2.1 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 框架 | React 19 | 成熟的 UI 框架，支持 Suspense/lazy |
| 构建 | Vite 6 | 快速 HMR，ES2022 输出 |
| 3D | Three.js | 首页光球效果 |
| 图标 | Lucide React | 轻量、风格统一 |
| 压缩 | fflate | 高性能压缩，用于分享链接编码 |
| 二维码 | qrcode | 比较链接二维码生成 |

### 2.2 文件结构

```
src/
├── main.tsx              # React 入口，StrictMode 挂载
├── App.tsx               # 主应用组件（~700行）
├── types.ts              # 旧版类型定义
├── styles.css            # 全局样式 + 响应式
├── components/
│   ├── Poster.tsx         # 海报组件
│   └── OrbScene.tsx       # 3D 光球场景
├── data/
│   ├── media.ts           # 媒介定义 + 内置榜单
│   └── catalog.ts         # 电影目录数据
└── lib/
    ├── ranking.ts         # 排序状态机
    ├── profile.ts         # 画像管理
    └── collections.ts     # 清单导入
```

### 2.3 状态管理

App.tsx 使用 React useState 管理所有状态，主要状态分组：

**路由状态**
- `view`: 当前视图（home / source / setup / sorting / profile / compare）
- `kind`: 当前媒介类型（film / book / music / other）
- 路由通过 `history.pushState` 和 `popstate` 事件实现，支持浏览器前进/后退

**排序状态**
- `ranking`: `RankingState` 对象，包含完整的排序机状态
- `collection`: 当前选中的作品集合
- `selected`: 已选中的作品 ID 列表
- `draft`: 排序草稿，自动保存到 localStorage

**用户状态**
- `profile`: 本地艺术人格画像
- `peer`: 对方的艺术人格画像
- `accountToken`: 登录 token
- `syncStatus`: 同步状态（idle / saving / saved / error）

**比较状态**
- `compareMode`: 比较模式（auto / manual）
- `compareActiveKind`: 当前比较维度
- `aiInsight`: AI 生成的解读文本

**弹窗状态**
- `showGuide`: 使用说明弹窗显示状态，首次访问自动弹出（检查 `art-rank:guide-dismissed`）
- `showTech`: 技术说明弹窗显示状态，从使用说明弹窗进入
- `accountOpen`: 账号弹窗
- `cloudConflict`: 数据冲突弹窗
- `detailWork`: 作品详情弹窗
- `compareRankDetail`: 比较排名详情弹窗
- `peerRankPickOpen`: 选择对方榜单弹窗

### 2.4 数据持久化

| 数据 | Key | 存储 | 大小限制 |
|------|-----|------|----------|
| 画像 | `art-rank:library:v2` | localStorage | 512 KB |
| 草稿 | `art-rank:draft:v2` | localStorage | — |
| 对方画像 | `art-rank:peer:v2` | localStorage | 512 KB |
| 账号 token | `art-rank:account-token` | localStorage | — |
| 会话 ID | `art-rank:session:v1` | localStorage | — |
| 列布局 | `art-rank:cols` | localStorage | — |
| 年轮布局 | `art-rank:rings-layout` | localStorage | — |
| 使用说明已关闭 | `art-rank:guide-dismissed` | localStorage | — |

### 2.5 分享链接编码

分享链接使用 fflate 压缩 + Base64URL 编码：

```
JSON → strToU8 → compressSync → Base64URL → /encounter?payload=<encoded>
```

解码时限制最大 512 KB，防止恶意链接。短码链接（8位十六进制）通过 D1 存储和检索。

---

## 3. 排序算法

### 3.1 核心数据结构

```typescript
interface RankingState {
  version: 2;
  seed: string;                    // 随机种子
  topN: number;                    // 保留前 N 名
  sourceIds: string[];             // 所有候选作品 ID
  shuffledIds: string[];           // 种子洗牌后的顺序
  rankedIds: string[];             // 已排序的作品
  pendingIds: string[];            // 待排序的作品
  deferredIds: string[];           // 暂放的作品
  skippedIds: string[];            // 略过的作品
  outsideTopIds: string[];         // 超出 TopN 的作品
  activeInsertion: ActiveInsertion | null;  // 当前二分插入状态
  phase: "ranking" | "verification" | "complete";
  verificationQueue: VerificationTask[];   // 验证任务队列
  pairEvidence: PairEvidence[];            // 偏好证据记录
  preferenceEdges: PreferenceEdge[];       // 偏好有向边
  cycleEvents: CycleEvent[];               // 偏好回环事件
  decisionLog: RankingDecision[];          // 决策日志（用于撤销）
  completed: boolean;
}
```

### 3.2 二分插入排序

每个候选作品通过以下流程插入已排序列表：

1. 取出下一个候选作品（考虑冷却机制）
2. 与已排序列表的中位数比较
3. 根据结果缩小搜索范围（左半或右半）
4. 重复直到 low >= high，确定插入位置
5. 将作品插入，超出 topN 的移入 outsideTopIds

```
已排序: [A, B, C, D, E]  候选: X

第1次: X vs C (中位数) → X > C → low=3, high=5
第2次: X vs D → X < D → low=3, high=3
插入: [A, B, C, X, D, E]
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

### 3.6 撤销

撤销通过重放决策日志实现：

```typescript
function undoLastAction(state: RankingState): RankingState {
  let restored = createRankingState(state.sourceIds, { seed, topN });
  for (const decision of state.decisionLog.slice(0, -1)) {
    restored = replayDecision(restored, decision);
  }
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

interface RankedArtwork {
  id: string;
  title: string;
  rank: number;
  creator?: string;
  year?: number;
  subtitle?: string;
  posterUrls?: string[];
}
```

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

**比较指标**
| 指标 | 计算方式 |
|------|----------|
| 作品重合度 | 共同作品数 / 并集作品数 × 100 |
| 加权偏好一致 | 基于 1/rank 权重的偏好一致性 |
| 顺序一致率 | 序对一致数 / 总序对数 × 100 |
| Top 3 共识 | 双方 Top 3 中共同作品数 |
| 名次距离 | 平均名次差 / 最大名次 × 100 |
| 冠军一致 | 双方第1名是否相同 |

---

## 5. 后端架构

### 5.1 Worker 路由

`worker/index.ts` 是入口文件，实现路由分发：

```typescript
async function route(request: Request, env: Env): Promise<Response> {
  // /api/health → 健康检查
  // /api/events → 分析事件
  // /api/stats → 公开统计
  // /api/posters → 海报解析
  // /api/image → 图片代理
  // /api/douban/* → 豆瓣接口
  // /api/movie|book|music/* → 搜索/详情
  // /api/account/* → 用户接口
  // /api/admin/* → 管理接口
  // /api/share → 短链接
  // /api/insights → AI 解读
  // /api/auth/config → 认证配置
  // 其他 → 静态资源或 SPA 回退
}
```

### 5.2 数据库 Schema

**analytics_events** — 匿名分析事件
```sql
CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**user_accounts** — 用户账户
```sql
CREATE TABLE user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  disabled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**user_sessions** — 会话管理
```sql
CREATE TABLE user_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  expires_at TEXT NOT NULL
);
```

**user_profiles_v2** — 用户画像 + 批注
```sql
CREATE TABLE user_profiles_v2 (
  user_id INTEGER PRIMARY KEY REFERENCES user_accounts(id),
  profile TEXT NOT NULL,
  notes TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**user_oauth** — OAuth 关联
```sql
CREATE TABLE user_oauth (
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
```

**user_collections** — 云端清单
```sql
CREATE TABLE user_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  items TEXT NOT NULL,
  item_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**poster_errors** — 海报错误日志
```sql
CREATE TABLE poster_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  media_type TEXT NOT NULL,
  error TEXT NOT NULL,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**api_logs** — API 调用日志
```sql
CREATE TABLE api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER,
  source TEXT,
  error TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**admin_sessions / admin_config** — 管理员会话和配置

**challenge_sets** — 旧版挑战片单（遗留）

### 5.3 海报解析策略

海报获取按优先级尝试多个来源：

**电影**
1. 豆瓣 suggest API（`img` 字段）
2. search.douban.com 搜索
3. Top250 索引缓存
4. IMDb suggestion API（精确匹配）

**书籍**
1. 豆瓣 suggest API（`pic` 字段）
2. search.douban.com 搜索
3. Top250 索引缓存

**音乐**
1. search.douban.com 搜索
2. Top250 索引缓存

每个来源返回的 URL 会生成多个 CDN 镜像变体（img1-img9.doubanio.com），前端按顺序尝试加载。

**海报缓存策略（前端 Poster 组件）**：
- **一级缓存**：模块级 `Map<string, Promise<string[]>>`（内存，最快，页面刷新丢失）
- **二级缓存**：`sessionStorage`（`art-rank:poster-cache` key，跨组件和页面刷新共享）
- **初始化**：组件挂载时 `useState` 初始化函数直接读取缓存，避免已加载海报的黑屏闪烁
- **失败上报**：图片 `onError` 时上报到 `/api/poster-errors/client`，同一 URL 不重复上报

### 5.4 详情获取策略

作品详情（简介、元数据）获取优先级：

1. **Wikipedia 中文** — 直查标题 + 类型限定词搜索
2. **Wikipedia 英文** — 同上
3. **创作者组合搜索** — 如"三体 刘慈欣"
4. **百度百科** — 最后兜底

元数据（评分、导演、出版社等）从豆瓣详情页或搜索结果解析。

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
- 域名节流：同域名间隔 800ms
- 冷却期：限流后递增冷却（5s → 10s → 15s）
- 指数退避：1s → 2s

---

## 6. 安全模型

### 6.1 HTTP 安全头

```typescript
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: https:; ...",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
```

### 6.2 输入验证

- 所有用户输入经过 `cleanString()` 清理（trim、长度、控制字符）
- JSON 请求体限制 48 KB
- 画像大小限制 512 KB
- 事件 payload 限制 2 KB，仅接受白名单字段
- 同源检查：写入操作验证 Origin 头

### 6.3 图片代理白名单

仅允许以下域名的图片通过代理：
- `img1/2/3/9.doubanio.com`
- `m.media-amazon.com`
- `ia.media-imdb.com`
- `image.tmdb.org`

拒绝非 HTTPS、带凭据或其他 host 的请求。

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
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": true
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "film-sort",
    "migrations_dir": "migrations"
  }]
}
```

`run_worker_first: true` 确保 Worker 先处理请求，未匹配时回退到静态资源。

### 7.3 Git 集成

Cloudflare Git integration 配置：
- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Build output directory: `dist`

---

## 8. 测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
```

测试使用 Vitest，覆盖排序算法、画像解析和集合导入的核心逻辑。
