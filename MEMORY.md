# MEMORY — ART/RANK 项目长期记忆

> **格式约定：最新记录在最上面，逐条向下为更早。** 新记录请插到对应区块的第一行，不要追加到文件末尾。
> 本文件是**跨会话、跨 agent 共享**的项目长期记忆（git 可追踪）。单会话的过程记录写 `.workbuddy/memory/YYYY-MM-DD.md`。
> 完整演化脉络见 [`docs/memory/TIMELINE.md`](docs/memory/TIMELINE.md)；决策理由见 [`docs/memory/DECISIONS.md`](docs/memory/DECISIONS.md)。

最后更新：2026-09-29

---

## 0. 项目身份（恒定事实，不随迭代变化）

| 项 | 值 |
|----|----|
| 产品名 | ART/RANK（内部包名 `film-sort`） |
| 定位 | 个人文化索引 —— 用连续 1v1 取舍排出电影/书籍/音乐/其他作品的 Top N，产出可保存、可导出、可比较的「艺术人格画像」 |
| 仓库 | `git@github.com:tripodxu/film-sort.git`（私有） |
| 线上 | `sort.logicc.top` |
| 技术栈 | React 19 + TypeScript + Vite（前端 SPA） / Cloudflare Workers + D1 + KV-free（后端全在 Worker） / Vitest + ESLint + Prettier |
| 规模 | 536 commits（2026-09-06 → 2026-09-29，24 天，单人开发）；`worker/` + `src/` + `shared/` ≈ 39,600 行 TS/TSX；25 个 D1 migration |
| 关键约束 | **全站零自建服务器**，所有能力必须能在 Cloudflare Workers（workerd）运行时内跑起来 |

---

## 1. 活跃记录（最近 7 天，最新在最上）

### 2026-09-30 · 「其他」维度封面/详情错配修复（pageprops.page_image + 年份消歧）

T-20260930-02：用户清单（动物森友会 2020 / Inside 2016 / Journey 2012）三类错配——大角鸮照片 / 消歧页(1999) / Dodge 汽车。三条根因都记进了 PITFALLS 2.8–2.11：**pageimages 对非自由封面恒空，但 pageprops.page_image 有值**（补一次 imageinfo 换 URL）；**文件列表 files[0] 兜底必然错配**（字母序巧合，删掉）；**opensearch 有盲区**（改 gsrsearch + 评分，`(video game)` 不是标题而是 redirect 到乐团页）。**年份是消歧最硬信号**——用户清单格式「标题 - 品类 (年)」，给年份就优先摘述命中年份的条目。

### 2026-09-29 · 「其他」维度取图管线攻坚（维基主图直取 + 标题变体）

- T-20260928-07 的后续迭代（`82d7581` `d3c5e4e` `7334442`）：other 维度无豆瓣 / 网易云结构化源，取图完全走维基；维基打分依赖类型词表，other 恰无词表可依 → **取图顺序重排为「条目主图直取优先」**（infobox 封面即作品本体，最强信号）。
- **维基标题变体（空格 / 全角冒号差异）不是重定向** —— `wikiPageImageAny` 按变体逐一查询；主图条目选择先剥分隔符再比较，全角冒号页名不再漏配。
- 经验沉淀：EPISODES E-20260929 / DECISIONS D-20260929-01 / PITFALLS 2.7。

### 2026-09-28 · 优化冲刺 P1–P5 全部完成，Phase 6–8 待办

- **P1 移动端滑动选择**：`src/lib/swipe.ts` 纯函数 `decideSwipe(dx,dy,threshold=56)` + 容器级单一 pointer 处理器；仅 `pointerType !== 'mouse'` 启用；`touch-action: pan-y`；拖动改 transform 走 ref 不进 state；`prefers-reduced-motion` 跳过跟随位移。commit `8017364`/`ad8e735`。
- **P2 OG 卡片**：`worker/og.ts` 对 `/share/:code`、`/plaza/:id` 的 HTML 注入 og:/twitter: 元数据；用户可控文本先转义；异常降级为无 OG 普通 SPA。commit `dca3ab0`/`cf9b837`。
- **P3 品味相似度**：`src/lib/similarity.ts`（Jaccard 重合 + 共同作品顺序一致度，`workIdentity` 口径与落库管线一致）；共同 <3 件不渲染（低于即噪声）。commit `bcdaabb`。
- **P4 路由拆包**：五个大视图改 `React.lazy`，index chunk 1072→964 KB（gzip 307→279）。commit `82b5b2d`。
- **P5 Jev 辅助模式**：`/api/ai/jev-pick` 二选一，**置信 ≥0.8 才自动落位**并标「AI 代判 · 置信 NN%」；键控竞态守卫丢弃迟到响应——**绝不覆盖用户真实选择**；开关默认关。commit `50e46df`。
- **Jev Phase 1（AI 快排）**：`/api/ai/jev/test` + `/api/ai/jev-rank` 两端点（限流桶 `ai_jev_test 5` / `ai_jev 10` 次每 10 分钟），准备页第三种成榜方式「AI 快排」。**Jev 集成四原则**（后续所有 AI 接入都要遵守）：① key 不内置，用户自填存 localStorage，worker 不落盘；② 只做**决策**不做生成，生成类继续走 OpenAI 兼容通道；③ 每个接入点必须有降级路径，主链路永不依赖；④ 非关键路径先行。
- **移动端顶栏抢救**：`overflow-x` 隐式裁剪下拉（设置菜单改锚 topbar）、≤540px 收导航（修复匿名「广场」被 `:last-child` 误伤）、≤360px 紧凑档、触屏 tooltip 关闭。
- **UI 现代化 P0–P4**（`docs/PLAN-ui-modernization.md` v3）：editorial 双主题 → aurora 极光主题（含 ribbon 光球特效）→ gallery 数据画廊（Bento 画像页 + 卡片墙）→ P4 收尾（主题菜单分组 + `--ev-*` 全局景深 + 11 主题新基线）；旧主题截图零差异回归，均线上实机验证。
- **T-20260928-07 报障两批**：「其他」维度接入 wiki 海报管线（上线以来无封面）、other 详情超时 20s→30s、AI 点评按档位放宽截断（2500/5000/9000 字符）。
- **当前状态**：P1–P5 ✅（均线上验证）；P6（相遇页预测分歧）已实现待线上复核；P7（Wrapped 年度报告）/ P8（PWA 离线）⬜ 未开始；全部计划见 `docs/PLAN-OPTIMIZATION-SPRINT.md`。

### 2026-09-27 · 全量审查缺陷清零 + 排序交互收尾

- `7f89afc` 全量审查缺陷清零（3 high / 4 medium / 4 low），产出 P2 打磨待办池。
- `5ae91cb` 移动端 Hero 抢救 + 图标/令牌纪律排查；`b5d984f` 重排行 grid 溢出 / 移动端比较页堆叠 / 广场工具栏折行 / i18n 缺口；`a1dc142` `6f3aa8a` 名次墨块生产环境换行与重排行 grid 渲染修复。

### 2026-09-25 · P0/P1 安全加固 + 插件系统（主题包 / 光球特效 / 分类清缓存）

- `worker/outbound.ts` 统一出站策略：精确 host 白名单 + manual redirect 逐跳复核 + 响应字节上限（修 SSRF）。
- 插拔主题包规范 `docs/THEME-PACKS.md` + 光球特效注册表 `docs/ORB-EFFECTS.md`，内置第 7 主题「纸上擂台」、三种开场特效。
- migration 0024 `qr_transactions` / 0025 `runtime_indexes`。全量回归 376 tests。

### 2026-09-22 · UI 全站焕新「夜间档案馆」（功能零变更）

- 六主题人格化、Token 体系 L1/L2、圆角 21→5 档、阴影 36→2 级、玻璃两级制、`--text-3` 对比度 74%→78%（WCAG AA）。
- 建立了 **270 张截图 × 2 轮零差异** 的视觉回归方法（详见 `docs/memory/EPISODES.md`）。

---

## 2. 项目稳定结构（架构快照）

```
src/           前端 SPA：App.tsx（路由+全局状态编排）
  views/       HomeView / SetupView / SortingView / ProfileView / CompareView /
               PlazaView / PlazaPostView / ShareView / SourceView
  components/  Poster / ArtworkDetail / RankingDetail / AiConfigDialog / ThemeSwitcher /
               OrbScene（Three.js 光球）/ FocusTrap / ErrorBoundary ...
  lib/         ranking.ts（排序+比较算法） / profile.ts / profileSync.ts / notes.ts /
               exportPng.ts / aiInsight.ts / typesafe.ts / similarity.ts / swipe.ts /
               theme.ts + themeRegistry.ts / layout.ts / useAuth / useSorting / useRouter
worker/        Cloudflare Worker：index.ts 为路由总入口
  ai.ts  media.ts  douban.ts  doubanlist.ts  netease.ts  gdstudio.ts  other.ts
  plaza.ts  import.ts  account.ts  verification.ts  mailer.ts  og.ts  typesafe.ts
  audit.ts  cachePurge.ts  qrTransactions.ts  outbound.ts  payloadGuard.ts  rateWindow.ts
shared/        前后端共享：storedItem.ts（落库白名单唯一出口）
migrations/    0001 → 0025，D1 schema
scripts/       ui-shot.mjs / ui-diff.mjs / ui-contrast.mjs / ui-audit.mjs / ui-normalize.mjs
```

**三条不可绕过的主链路**（改任何一处都要跑通）：
1. 清单 → 1v1 排序 → 画像（`SetupView` → `SortingView` → `ProfileView`）
2. 画像 → 分享短链 → 对方查看/比较（`POST /api/share` → `/share/:code` → `CompareView`）
3. 画像 → 发布广场 → 点赞/留言/编辑（`plaza.ts`）

---

## 3. 硬性约束（违反即返工，写在代码里也写在这里）

| # | 约束 | 原因 |
|---|------|------|
| C1 | PBKDF2 迭代上限 **100,000** | workerd（含 `nodejs_compat` 的 `node:crypto`）拒绝 >100k；600k 会让注册/改密/重置全线崩溃。哈希格式自带 iterations，将来可平滑上调 |
| C2 | 出站 fetch 必须走 `worker/outbound.ts` 的 `fetchBounded` | 精确 host 白名单 + 逐跳 redirect 复核 + 字节上限，防 SSRF |
| C3 | 图片来源判定唯一入口是 `worker/media.ts` 的 `allowedImage()` | 白名单只认 `img*.doubanio.com`、`m.media-amazon.com`、`ia.media-imdb.com`、`image.tmdb.org`、`*.music.126.net`、`upload\|thumb.wikimedia.org`、`bkimg.cdn.bcebos.com` |
| C4 | 海报 URL **绝不能写进 `items`** | 150 首歌的画像曾因 posterUrls 超 512KB 导致云端读取/广场发布失败；统一走 `poster_urls` 侧表，`shared/storedItem.ts` 落库白名单是唯一出口 |
| C5 | 用户 API Key（AI / Jev）只存浏览器 localStorage，worker 不落盘 | 已在 README 与代码注释中承诺 |
| C6 | 管理后台动态内容渲染前必须 HTML 转义 | 存储型 XSS（审计 P0-3） |
| C7 | 522/418 等上游失败必须区分「网络失败」与「预算耗尽」 | 曾把网络失败误报为限流，导致音乐服务假死 |
| C8 | 邮件生产环境缺配置必须 **fail-closed** | 不允许静默降级到开发兜底 |
| C9 | 验证码 / OAuth exchange 必须一次性消费 | 重放风险（审计修复） |
| C10 | 视觉改动走 270 张截图对比，且**构建期间不得截图** | `dist` 重建会让 ENOENT 杀死整轮 capture（204/270 惨案） |

---

## 4. 协作约定（人与 agent 共用）

- **提交规范**：Conventional Commits 中文描述，`feat/fix/docs/chore/style/refactor/perf/test/ci/ops`；同一提交可并列 `feat(...)` + `fix(...)`。历史中格式曾不统一（`fix:` 与 `fix` 并存），新提交统一带冒号。
- **五道门禁**（CI 与本地一致，缺一不可）：`npm run check` → `npm run lint` → `npm run format:check` → `npm test` → `npm run build`。
- **发布节奏**：本地改完 → 提交 → 推送 → Cloudflare 自动部署 → **到 `sort.logicc.top` 线上实机验证** → 再进下一个 Phase。「未线上验证不标 ✅」是本项目铁律。
- **文档同步**：功能变更必须同步 `README.md` / `docs/API.md` / `docs/FEATURES.md` / `docs/USAGE.md`；过时文档移入 `docs/archive/` 并加「已过时」横幅，不直接删。
- **详细约定与踩坑档案**：[`docs/agents/CONVENTIONS.md`](docs/agents/CONVENTIONS.md)、[`docs/agents/PITFALLS.md`](docs/agents/PITFALLS.md)。

---

## 5. 当前待办焦点（按优先级）

1. `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 6–8（Jev 预测分歧 / Wrapped 年度报告 / PWA 离线）
2. `docs/ROADMAP.md` 的 Jev Phase 2（维基消歧 Choice）、Phase 3（广场 Noul 护栏）
3. P2 打磨待办池（2026-09-27 全量审查遗留项）
