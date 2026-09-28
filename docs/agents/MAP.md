# MAP — 任务 → 文件路由表

> **本文件是整个 agent 文档体系的核心。** 目的：让每个 agent 只读「与任务相关的那一两个文件」，而不是通读 39,600 行代码或 515 条 commit。
> 用法：先在 §1 找到你的任务类型 → 跳到对应小节 → 只打开列出的文件。
> 行号会漂移，**以符号名 / 路由字符串为准**，行号仅作初次定位的提示。

---

## 0. 全局速查（10 秒定位）

| 我想找… | 去这里 |
|---------|--------|
| 某个 API 端点怎么实现的 | `worker/index.ts` 路由表（约 1822 行起，`if (url.pathname === ...)` 链） |
| 某路由的业务逻辑 | 按前缀找对应模块：`/api/plaza/*`→`worker/plaza.ts`、`/api/netease/*`→`worker/netease.ts`、`/api/douban/*`→`worker/douban.ts`+`doubanlist.ts`、`/api/import/*`→`worker/import.ts`、`/api/account/*`→`worker/account.ts` |
| 前端页面 | `src/views/*.tsx`（路由在 `src/lib/useRouter.ts` + `src/App.tsx`） |
| 全局状态 / 事件编排 | `src/App.tsx`（2539 行，改动前先确认是否被 `useAuth` / `useSorting` / `useRouter` 接管） |
| 样式与主题 | `src/styles.css`（1286 行，全令牌化） |
| 数据库表结构 | `migrations/0001..0025` + `docs/ARCHITECTURE.md` 的 Schema 节 |
| 「什么能落库」 | `shared/storedItem.ts` —— **唯一出口** |
| 排序 / 比较算法 | `src/lib/ranking.ts`（1210 行） |
| 历史决策理由 | `docs/memory/DECISIONS.md` |
| 这个功能什么时候加的 | `docs/memory/TIMELINE.md`（按日倒序） |

---

## 1. 任务类型索引

| § | 任务类型 | 主要负责目录 |
|---|----------|-------------|
| §2.1 | 排序 / 比较算法 | `src/lib/ranking.ts`、`src/lib/useSorting.ts` |
| §2.2 | 前端视图 / 交互 / 路由 | `src/App.tsx`、`src/views/` |
| §2.3 | 视觉 / 主题 / 响应式 | `src/styles.css`、`src/lib/theme*.ts`、`scripts/ui-*.mjs` |
| §2.4 | Worker 接口 / 新增 API | `worker/index.ts` + 业务模块 |
| §2.5 | 数据库 / migration | `migrations/`、`shared/` |
| §2.6 | 外部平台接入（豆瓣/网易云/维基/音乐） | `worker/media.ts` 等 |
| §2.7 | AI（点评 / Jev / TypeSafe） | `worker/ai.ts`、`worker/typesafe.ts`、`src/lib/aiInsight.ts` |
| §2.8 | 管理后台 | `worker/index.ts` 的 `/api/admin/*`、`/admin` |
| §2.9 | 构建 / 部署 / CI | `vite.config.ts`、`wrangler.jsonc`、`.github/workflows/` |
| §2.10 | 测试 | 就近 `*.test.ts` + `vitest.config.ts` |

---

## 2. 分区详图

### §2.1 排序 / 比较算法

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/lib/ranking.ts` | 1210 | 排序引擎（简易/经典/精确三模式）、比较指标（Kendall τ-b、Top-5 Jaccard、年代偏好、共识评分）、插入定位、回环检测 |
| `src/lib/useSorting.ts` | 911 | 排序状态机：草稿、撤销、略过/暂放、Jev 代判挂钩、竞态守卫 |
| `src/views/SortingView.tsx` | 330 | 对战界面（duel card）、键盘快捷键、滑动手势接入 |
| `src/lib/swipe.ts` | — | 纯函数 `decideSwipe(dx, dy, threshold=56)`，滑动判定可单测 |
| `src/views/CompareView.tsx` | 1155 | 比较界面 + 三档深度 |

**改这里前必读**：`docs/agents/PITFALLS.md` §3（异步覆盖与撤销一致性）、`docs/USAGE.md` 的排序三模式章节。

---

### §2.2 前端视图 / 交互 / 路由

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/App.tsx` | 2539 | 全局状态与事件编排；大视图已 `React.lazy` 拆包 |
| `src/lib/useRouter.ts` | 81 | URL 路径路由（`/`、`/encounter`、`/profile`、`/share/:code`、`/plaza/:id`、`/admin`） |
| `src/lib/useAuth.ts` | 545 | 登录态、云同步、会话代际 |
| `src/views/SetupView.tsx` | 208 | 准备页（自行排序 / 仅保存不排序 / AI 快排三个动作） |
| `src/views/SourceView.tsx` | 1780 | 来源与导入页（最大的视图） |
| `src/views/ProfileView.tsx` | 1276 | 我的文化索引（品味年轮、榜单管理） |
| `src/views/CompareView.tsx` | 1155 | 比较 |
| `src/views/PlazaView.tsx` / `PlazaPostView.tsx` | 457 / 1172 | 广场列表 / 帖子详情 |
| `src/views/ShareView.tsx` | 235 | 分享查看页 |
| `src/views/HomeView.tsx` | 472 | 首页 |
| `src/components/` | — | `Poster`、`ArtworkDetail`、`RankingDetail`、`AiConfigDialog`、`ThemeSwitcher`、`OrbScene`（Three.js）、`FocusTrap`、`ErrorBoundary`、`ExpandableNote`、`SettingsMenu` |

**改这里前必读**：`docs/agents/CONVENTIONS.md` §2（React Hook 约定 —— 历史上有两处 Hook 违规与三处 Hook 提取回归）。

---

### §2.3 视觉 / 主题 / 响应式

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/styles.css` | 1286 | 全令牌化样式（545 var / 194 color-mix）；圆角 5 档、间距 8px 阶梯、阴影 2 级 |
| `src/lib/theme.ts` | 54 | `data-theme` 切换与持久化 |
| `src/lib/themeRegistry.ts` | 383 | 插拔主题包注册表（规范见 `docs/THEME-PACKS.md`） |
| `src/lib/layout.ts` | — | `data-layout` 布局模式（与 theme 正交） |
| `src/lib/orbEffects/` | — | 开场光球特效注册表（规范见 `docs/ORB-EFFECTS.md`） |
| `scripts/ui-shot.mjs` / `ui-diff.mjs` | — | 截图 + 零依赖 PNG 比对 |
| `scripts/ui-contrast.mjs` / `ui-audit.mjs` / `ui-normalize.mjs` | — | 对比度扫描 / 审计 / 字面量归一化（dry-run 优先、幂等） |
| `docs/ui-baseline.json` / `docs/ui-contrast.json` | — | 冻结的基线与对比度档案 |

**改这里前必读**：`docs/agents/PITFALLS.md` §4（8 条视觉陷阱，含「构建期间禁止截图」）、`docs/memory/EPISODES.md` E-20260922。

---

### §2.4 Worker 接口 / 新增 API

**路由总表在 `worker/index.ts` 约 1822 行起**，是一条 `if (url.pathname === ...)` 链。新增端点时：

1. 在路由链里加分支；
2. 业务逻辑放独立模块（`worker/<domain>.ts`），保持 `index.ts` 只做路由与编排；
3. 请求体校验走 `worker/payloadGuard.ts`；
4. 限流走 `worker/rateWindow.ts`（各桶配额见 `docs/API.md`）；
5. 若涉及外部请求，必须走 `worker/outbound.ts` 的 `fetchBounded`；
6. 同步 `docs/API.md`。

| 模块 | 职责 |
|------|------|
| `worker/payloadGuard.ts` | 请求形状校验 |
| `worker/rateWindow.ts` | 限流窗口（Map 有上界 + 惰性清扫） |
| `worker/outbound.ts` | 出站请求统一策略（SSRF 防线） |
| `worker/og.ts` | `/share/:code`、`/plaza/:id` 的 OG 元注入 |
| `worker/cachePurge.ts` | 分类清缓存 |
| `worker/audit.ts` | 管理操作审计 |

---

### §2.5 数据库 / migration

- 迁移文件：`migrations/0001_initial.sql` → `0025_runtime_indexes.sql`。**新增迁移必须幂等可重复应用**（曾因非幂等导致远程迁移失败）。
- 共享契约：`shared/storedItem.ts`（落库字段白名单唯一出口，289 行）、`shared/storedNotes.ts`（批注语义：未提供=保留 / 显式空=清空）。
- Schema 说明：`docs/ARCHITECTURE.md`。
- 关键表：`user_profiles`、`user_accounts`、`user_collections`、`poster_urls`、`shared_links`、`plaza_posts`、`plaza_post_edits`、`plaza_comments`、`plaza_likes`、`api_logs`、`poster_errors`、`admin_audit`、`user_cookie_vault`、`oauth_bindings`、`oauth_exchanges`、`verification_codes`、`qr_transactions`、`user_sessions`。

**硬约束**：D1 单行 512KB → 画像里绝不能塞海报 URL 数组（见 `PITFALLS.md` §3）。

---

### §2.6 外部平台接入

| 模块 | 平台 | 要点 |
|------|------|------|
| `worker/media.ts` | 海报与详情统一层 | `allowedImage()` 是图片来源唯一判定处；海报降级链 Wiki → 网易云 → gd-proxy |
| `worker/douban.ts` | 豆瓣搜索 / Top250 / 详情 | 反爬：Edge UA 轮换、同域 800ms 节流、指数退避、全局冷却 |
| `worker/doubanlist.ts` | 豆列 / 想看已看导入 | 豆瓣改版频繁，解析器需兼容新旧版式 |
| `worker/netease.ts` | 网易云歌单 / 扫码登录 | weapi 分层降级 + 分片 + 退避；Cookie 保险库 AES-GCM |
| `worker/gdstudio.ts` | 音乐试听 / 歌词 | 播放链与歌词缓存；翻唱检测 |
| `worker/other.ts` | 维基「其他」类别 | pageimages + 百度百科兜底 |
| `worker/import.ts` | 分批导入引擎 | offset 游标、单批 300、进度、上限可调 |
| `worker/qrTransactions.ts` | 扫码事务 | 凭证只写发起账户（migration 0024） |

**改这里前必读**：`docs/agents/PITFALLS.md` §2（四类故障现象相同但解法完全不同）、`docs/DOUBAN_API.md`、`docs/memory/EPISODES.md` E-20260916 / E-20260913。

---

### §2.7 AI（点评 / Jev / TypeSafe）

| 文件 | 职责 |
|------|------|
| `worker/ai.ts` | AI 点评：内置 CF 模型 + 用户自定义双通道四协议（Chat Completions / Responses / Anthropic Messages / Gemini Native） |
| `worker/typesafe.ts` | Jev（TypeSafe System One）REST 客户端：入参校验、30s 超时、错误映射 |
| `src/lib/aiInsight.ts` | 前端 AI 点评客户端 |
| `src/lib/typesafe.ts` | 前端 Jev 配置与请求（key 只存 localStorage） |
| 端点 | `/api/ai/test`、`/api/ai/models`、`/api/insights`、`/api/ai/jev/test`、`/api/ai/jev-rank`、`/api/ai/jev-pick` |
| 限流桶 | `ai_jev_test` 5 / `ai_jev` 10 / `ai_jev_pick` 60（次/10 分钟） |

**四原则**（`docs/memory/DECISIONS.md` D-20260928-01）：key 不内置 / 只做决策不做生成 / 必须可降级 / 非关键路径先行。
**后续计划**：`docs/ROADMAP.md`（Phase 2 维基消歧 Choice、Phase 3 广场 Noul 护栏）。

---

### §2.8 管理后台

- 页面：`worker/index.ts` 的 `GET /admin`（服务端渲染 HTML，内联脚本要小心模板转义）。
- 接口：`/api/admin/*`（dashboard / accounts / plaza / reset / audit / logs / poster-errors / cache / sessions / links / change-password）。
- 规则：所有动态内容渲染前 HTML 转义；危险操作写 `admin_audit`；分级数据重置需确认短语 `RESET` + 密码重验。

---

### §2.9 构建 / 部署 / CI

| 文件 | 说明 |
|------|------|
| `vite.config.ts` | 前端构建；大视图 `React.lazy` 拆包 |
| `wrangler.jsonc` | Worker + D1 + ASSETS 配置；内置 AI 的非敏感 vars（URL/MODEL/PROTOCOL） |
| `.github/workflows/ci.yml` | `check` → `lint` → `format:check` → `test` → `build`（Node 22） |
| `package.json` | `deploy` = build + `wrangler d1 migrations apply ... --remote` + `wrangler deploy` |
| `docs/CLOUDFLARE.md` | 部署与环境变量说明 |

**发布节奏**：提交 → 推送 → Cloudflare 自动部署 → **到 sort.logicc.top 线上验证**。

---

### §2.10 测试

- 框架 Vitest（`vitest.config.ts`），测试就近放置：`src/lib/*.test.ts`、`worker/*.test.ts`、`shared/*.test.ts`。
- 代表性大测试：`src/lib/profile.test.ts`（763 行）、`ranking.test.ts`（475）、`aiInsight.test.ts`（373）、`worker/plazaIntegrity.test.ts`、`worker/outbound.test.ts`。
- 契约类测试是本项目特色：`outbound.test.ts`（出站安全契约）、`payloadGuard`、`plazaPayload`、`typesafe.test.ts`、`typesafe`(worker) —— 安全与形状契约优先用单测锁死。

---

## 3. 文档索引（哪份文档回答什么问题）

| 文档 | 回答什么 | 什么时候不用读 |
|------|----------|----------------|
| `AGENTS.md` | 入口与路由 | —— |
| `MEMORY.md` | 项目背景、硬约束、当前进度 | —— |
| `README.md` | 功能全貌、API 速览、缓存/安全策略 | 只想改一个文件时 |
| `CHANGELOG.md` | 近期交付了什么 | 需要历史脉络时改读 TIMELINE |
| `docs/ARCHITECTURE.md` | 架构、模块结构、Schema | 只做局部改动时 |
| `docs/API.md` | 全部端点与参数 | 不改接口时 |
| `docs/FEATURES.md` | 功能回归基线（改功能后对照） | —— |
| `docs/USAGE.md` | 用户视角操作指南 | —— |
| `docs/CLOUDFLARE.md` | 部署与环境变量 | 不部署时 |
| `docs/DOUBAN_API.md` | 豆瓣接口策略 | 不碰豆瓣时 |
| `docs/THEME-PACKS.md` / `ORB-EFFECTS.md` | 扩展点规范 | 不改主题/特效时 |
| `docs/ROADMAP.md` / `PLAN-*.md` | 在办与未来计划 | —— |
| `docs/memory/TIMELINE.md` | 什么时候做的 | 不需要历史时 |
| `docs/memory/DECISIONS.md` | 为什么这么做 | 不需要理由时 |
| `docs/memory/EPISODES.md` | 同类任务怎么打 | —— |
| `docs/agents/*.md` | 协作、约定、陷阱、角色、台账 | —— |
| `docs/archive/**` | **已过时**，只读不引用 | —— |

---

## 4. 反模式（不要这样做）

| ❌ 反模式 | ✅ 正确做法 |
|-----------|------------|
| 开工前通读 `src/App.tsx` 2539 行 | 先 `grep` 符号名，只读相关函数 |
| 通读 515 条 git log 了解背景 | 查 `docs/memory/TIMELINE.md` 或 `git log --grep=<关键词>` |
| 想当然地按 Node.js 能力写代码 | 平台能力在 workerd 上实测（PBKDF2 100k 教训） |
| 直接改 `styles.css` 的硬编码色值 | 先确认是否已提升为 token；新色必须走 token |
| 在多个地方判定"这个图片域名安全吗" | 只改 `allowedImage()` |
| 上线前只看单测通过 | 到 sort.logicc.top 实机验证 |
| 交接只写在对话里 | 写进 `docs/agents/TASK-LEDGER.md` 与 commit message |
