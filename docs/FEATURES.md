# ART/RANK 功能总文档（FEATURES）

> 本文档是**已实现功能的全量清单与回归基线**：每条功能标注入口路径与后端端点。任何重构/UI 改版后，逐条走查本文档即完成回归验证。
> 端点的请求/响应细节见 `API.md`；算法与架构细节见 `ARCHITECTURE.md`；优化历史见 `OPTIMIZATION.md`。
> 最后更新：2026-09-18

## 0. 路由总表（SPA，History API）

| 路径 | 视图 | 说明 |
|---|---|---|
| `/` | Home | 首页：选维度、继续草稿、品味年轮 |
| `/catalog/source` | Source | 清单来源（精选/我的清单/豆瓣精选） |
| `/catalog/setup` | Setup | 勾选作品 + TopN + 种子 |
| `/catalog/sorting` | Sorting | 1v1 取舍排序 |
| `/myself` | Profile | 我的文化索引（榜单管理/导出/发布） |
| `/encounter` | Compare | 相遇比较（粘贴对方链接/JSON） |
| `/share/:code` | Share | 分享只读页（服务端短码） |
| `/plaza` | Plaza | 广场列表 |
| `/plaza/:id` | PlazaPost | 广场帖子详情 |
| `/admin` | （内嵌 HTML） | 管理看板，不在 SPA 路由内 |

`?lang=en` 切英文（全站内置双语 t()）；`?payload=`/`#profile=` 导入画像；`?oauth_code=` OAuth 回调。

---

## 1. 排序引擎

| 功能 | 入口 | 实现 |
|---|---|---|
| 四媒介维度选择（电影/书籍/音乐/其他） | 首页 medium 胶囊 | `App.chooseKind` |
| 主动式二分插入排序（中位数对手 + 区间收敛） | `/catalog/sorting` | `lib/ranking.ts createRankingState/getCurrentComparison/choosePreferred` |
| 键盘 A/D、←/→、1/2 快捷选择 | 排序页 | `App.tsx` keydown |
| 撤销（O(1) 快照栈，上限 500）/ 略过 / 暂放 | 排序页底部工具 | `undoLastAction/skipWork/deferWork` |
| 偏好回环检测（A>B>C>A）+ 二次确认 | 排序页 evidence 条 | `recordPreference/recordCycleConfirmation` |
| 验证阶段（终局少量反证对局） | 排序尾段 | `startVerification` |
| 草稿自动保存/恢复 | 首页「继续」 | `art-rank:draft:v2` |
| 精选清单（`data/catalog.ts` 32 份内置片单，另含书籍/音乐/其他内置清单）+ 搜索 | Source/精选 | `data/media.ts getCollectionsByKind` |
| 豆瓣 Top250 拉取（电影/书/音乐，25–250 可选） | Source/豆瓣精选 | `/api/douban/*/top250` |
| 即搜即加（输入→候选→点选带海报加入） | Source/我的清单 | `searchWorks` → `/api/{movie,book,music}/list`；other → `/api/other/list` |
| 批量导入 TXT/JSON/粘贴（2–1000 件，去重；文件 ≤512 KB） | Source/我的清单/批量 | `lib/collections.importCollection` |

## 2. 画像（我的文化索引 /myself）

| 功能 | 入口 | 实现 |
|---|---|---|
| 多榜单画像（同媒介多榜） | 画像页 | `lib/profile.ts` v2 |
| 榜单切换胶囊条（横向滚动，媒介色激活） | 画像顶部 dim-chip | `ProfileView` |
| 手动调整（拖拽 + 上下移，实时名次） | 榜单动作栏「手动调整」 | `reorderRanking` + ReorderList |
| 编辑作品（增删 + 豆瓣/维基搜索添加） | 「编辑作品」 | WorkEditor + `/api/*/list`、`/api/other/list` |
| 改名 / 重新排序 / 分享 / 比较 / 删除榜单（⋯ 菜单 + 红色确认条） | 动作栏 + ⋯ | `renameRank/deleteRank` |
| 三级批注：画像 / 榜单 / 作品（全屏玻璃阅读器） | 各「批注」按钮 | `lib/notes.ts`，`art-rank:notes` |
| 作品详情弹窗（海报/简介/评分；音乐可试听、看歌词[含译文]） | 点海报 | `openArtworkDetail` → `/api/*/detail`、`/api/other/detail`、`/api/music/play`、`/api/music/lyric` |
| 导出 JSON / TXT / MD / CSV（BOM+防注入）/ PNG | 右侧导出面板 | `profileText` / `lib/exportPng.renderProfilePng` |
| PNG 五版式：编辑/领奖台/拼贴/胶片/极简 | 导出格式=PNG 时版式切换器 | `exportLayout` 状态 |
| PNG 主题感知（采样当前 data-theme 配色，2x 高清） | 同上 | `exportPng.samplePalette` |
| 品味年轮（首页，row/col 两布局，就地改名/删除） | 首页 | `HomeView` |
| 导入画像 JSON（校验+合并） | 首页/比较页 | `importProfile` |

## 3. 比较（相遇 /encounter）

| 功能 | 入口 | 实现 |
|---|---|---|
| 对方画像导入：比较链接 / 分享短码 / JSON 文件 | 比较输入区 | `importPeerFromUrl/importProfile` |
| 自动模式（全维度）/ 手动模式（勾选榜单） | 模式切换 | `compareProfiles/compareDimensions` |
| 指标：重合度、顺序一致率(剔并列)、加权偏好、名次距离、Spearman、冠军一致、Top3 | 指标区 | `profile.ts compareDimensions` |
| Kendall τ-b（含并列）、Top-5 Jaccard、年代偏好、综合共识评分(五因子加权 0-100 + 判词) | 共识圆环 hero + 折叠「更多指标」 | 同上 + `consensusScore` |
| 每指标 ? 悬浮解释 | metric-help 图标 | CompareView |
| 共同作品表（来源榜单徽章、名次可点进榜单详情、排序切换） | 比较页 | `RankingDetail` 弹窗 |
| 最大分歧表 / 共同偏好 / 分歧轴 | 比较页 | `disagreements/commonPreference/divergence` |
| AI 文化解读 | 「生成解读」 | `/api/insights` |
| 用对方作品重新排序（选对方榜单） | 底部动作 | `createFromPeer` + PeerRankPick |

## 4. 分享

| 功能 | 入口 | 实现 |
|---|---|---|
| 比较链接（服务端短码 `/encounter?payload=<code>`） | 「复制比较链接」 | `POST /api/share` → `compareUrl` |
| 分享短链（服务端 8–12 位码）+ 有效期 7/30/90/365 天 | 「分享链接」弹窗 | `POST /api/share`、`GET /api/share/:code` |
| 二维码 | 「复制比较链接」生成后出现在导出面板 | qrcode 动态 import |
| 单榜单分享/比较 | 榜单动作栏 | `shareSingleRanking` |
| 分享查看页（只读 + 比较/用其排序/批注展示） | `/share/:code` | ShareView |
| cron 每周一清理过期短链 | — | scheduled handler |

## 5. 广场（/plaza）

| 功能 | 入口 | 实现 |
|---|---|---|
| 发布榜单/完整画像到广场（描述可选、粒子动效） | 画像页「发布」 | `POST /api/plaza/posts` |
| 列表：最新/最热排序、媒介筛选、关键词搜索、无限滚动、2/3/4 列 | /plaza | `GET /api/plaza/posts` |
| 帖子详情：点赞、嵌套留言回复、用其排序、与我比较 | /plaza/:id | like/comments 端点 |
| 作者编辑：改序/增删（拖拽）、改描述、画像帖同步 | 「编辑榜单/编辑信息」 | `PUT /api/plaza/posts/:id` |
| 编辑历史（remove/add/reorder/sync/meta/hide/restore + 服务端时间戳，仅作者可见） | 「编辑历史」 | `GET /api/plaza/posts/:id/edits` |
| 「最后编辑于」公开标记 | 帖子头 | `edit_count/last_edited_at` |
| 隐藏/恢复（作者自助，隐藏后仅自己可见） | 「隐藏/恢复」 | `POST /api/plaza/posts/:id/visibility` |
| 作者删除（级联清 edits/comments/likes） | 「删除」二次确认 | `DELETE /api/plaza/posts/:id` |
| 「与曾经的我比较」（自己的帖） | 按钮文案切换 | `is_author` 服务端判定 |
| 已发布榜单变更后的「同步到广场」提示 | 画像页横幅 | `syncPlazaPost` + `art-rank:plaza-links` |
| 列表瘦身（服务端只回前 3 件 + 计数） | — | json_extract/json_each |

## 6. 外部数据导入与账号连接

| 功能 | 入口 | 实现 |
|---|---|---|
| 豆瓣豆列导入（新旧版式双解析，创作者标签提取，offset/limit 分批） | Source 粘贴链接 | `/api/import/doulist`、`/api/import/douban-list` |
| 豆瓣清单导入（m.douban.com/subject_collection/XXX，rexxar JSON，分批） | 同一输入框自动识别 | `/api/import/douban-list` |
| 我的豆瓣「想看/已看/想读/已读」导入（需连接，2026 版结构解析，分批可破 300） | 一键按钮 / mine 链接 | `{movie,book}.douban.com/mine` 解析 |
| 分批导入引擎 + 进度条：单批 300、按 nextOffset 游标续抓，右上角「设置」调单次上限（100/300/500/1000，localStorage） | 导入时进度条 + 齿轮菜单 | `useSorting.runBatchedImport` |
| 已导入清单：折叠▾ + 全选/取消勾选 + 内部滚动（420px）+ 仅保存不排序（按导入顺序存榜单，不进比较） | 清单区 | `saveCustomWorks` |
| 网易云按 UID 浏览全部歌单（含收藏，主流程）：输入用户 ID/主页链接 → 列全部歌单 → 点选导入；开放接口→weapi 分层降级，被风控时 blocked 引导连接 | 「浏览歌单」输入框 | `/api/netease/user-playlists?uid=` |
| 网易云歌单导入（公开链接即可；私有需连接；v6+v3 分层链，开放接口→weapi 降级+退避+节流+分批，旧 detail 已要求登录） | Source 粘贴 | `/api/import/netease` |
| 网易云「我的歌单」浏览（含收藏，special=我喜欢的音乐） | 折叠区「连接我的网易云账号（扫码 / 粘贴 Cookie）」→「浏览我的全部歌单（含收藏）」（填充主列表） | `/api/import/netease/mine` |
| 网易云扫码连接（开放接口优先 + weapi 兜底 + Cookie 罐 + 倒计时换码≤2 次 + 风控连续 3 次降级） | 「扫码连接网易云」 | `/api/netease/qr/*` |
| 豆瓣扫码连接（qrlogin_code/status，dbcl2 入库，服务端代理二维码图） | 「扫码连接豆瓣」 | `/api/douban/qr/*` |
| 粘贴 Cookie 连接（校验凭证真实可用才入库；扫码风控的兜底） | 弹窗内/「粘贴 Cookie 连接」 | `POST /api/netease/cookie`、`/api/douban/cookie` |
| Cookie 保险库（AES-GCM 加密，密钥存 admin_config；断开即删） | 「断开连接」 | `user_cookie_vault` 表 |
| 其他类别数据：维基搜索/详情/图片（pageimages）+ 百度百科兜底 | other 媒介搜索框/详情 | `/api/other/list`、`/api/other/detail`、`/api/artwork/detail?kind=other` |
| 海报解析与代理（豆瓣/IMDb/网易云 CDN/维基；音乐网易云直出优先、豆瓣兜底；失败上报 poster_errors） | 全站 Poster 组件 | `/api/posters`、`/api/posters/batch`、`/api/image`、`/api/poster-errors/client` |
| 导入封面写入侧表（豆列/豆瓣清单/网易云歌单导入时顺带写 `poster_urls`） | — | `worker/import.ts seedImportedPosterUrls` |
| 简介消歧（豆瓣 v:summary 优先 → 维基打分择优[限定标题/年份/类型声明/消歧页拒绝] → 百度百科） | 作品详情 | `fetchContentIntro` |

## 7. 账号与云同步

| 功能 | 入口 | 实现 |
|---|---|---|
| 邮箱注册/登录（PBKDF2，legacy SHA-256 透明升级） | 顶栏账号 | `/api/account/register,login` |
| Google/GitHub OAuth（一次性 code 交换，token 不进 URL） | 账号弹窗 | `/api/account/oauth/*` |
| 画像+批注云同步（防抖自动 + 手动 + keepalive 退出前） | 同步状态点 | `GET/PUT /api/account/profile` |
| 冲突处理（增量合并/用云端） | 登录时弹窗 | `mergeProfiles` |
| 云端清单（保存/列表/删除，kind 含 other） | Source | `/api/account/collections` |
| 昵称设置/修改 | 账号弹窗 | `PUT /api/account/nickname` |
| 退出登录（清会话+本地 token） | 账号弹窗 | `POST /api/account/logout` |
| 禁用态（disabled_at 拒绝登录） | — | user_accounts |

## 8. 主题系统（2026-09-13 新增）

| 功能 | 入口 | 实现 |
|---|---|---|
| 六主题：现代(默认深色)/复古纸感/极简/简约/古典/赛博朋克 | 顶栏调色板下拉 | `lib/theme.ts` + `[data-theme]` 变量块 |
| 全量设计令牌（--bg/--text/--accent/--surface-*/--line…，color-mix 派生） | — | `styles.css :root` |
| 选择持久化 + 首帧防闪烁 + theme-color 同步 | 自动 | `art-rank:theme`、`src/main.tsx` 首帧前置应用 |
| PNG 导出跟随当前主题 | 导出 | `exportPng.samplePalette` |

## 9. 管理看板（/admin，ADMIN_PASSWORD 或 DB hash 登录）

| 页签 | 功能 | 端点 |
|---|---|---|
| 概览 | 统计卡/Chart.js 图（14 天趋势、媒介分布环形图）/API 日志/错误/事件/系统状态/海报错误卡（近 7 天聚合 + CSV 导出） | `/api/admin/dashboard`、`/api/admin/poster-errors*` |
| 用户 | 列表、画像查看抽屉、禁用/恢复、重置密码、删画像/清单、删除账户(级联) | `/api/admin/accounts*` |
| 广场 | 筛选/搜索/分页、隐藏/恢复、删除、评论管理 | `/api/admin/plaza/*` |
| 数据 | 存储统计、日志清理、过期短链清理、分级重置(四档,密码重验)、审计日志、改密、全端退登 | `/api/admin/reset,audit,logs/clean,links/clean-expired,change-password,sessions/revoke-all` |

## 10. 横切能力

- 埋点：`POST /api/events`（16 事件白名单 + payload 键白名单 + 同源校验）；`GET /api/stats` 公开聚合。
- 限流：10 分钟窗、按 IP（`allowUpstreamRequest` 的桶上限）：auth 30 / share 30 / challenge 30 / ai 8 / music_play 12 / music_lyric 12 / import 8 / netease 120 / douban 120 / posters 60 / other 20（海报失败上报为 120）/ events 120。音乐试听与歌词是两个独立桶，命中缓存时不计额度。
- 安全头：CSP（img 白名单含 doubanio/amazon/imdb/tmdb/126.net/github/wikimedia/bkimg）、COOP、nosniff、X-Frame DENY、写接口 CSRF（assertSameOrigin）。
- 边缘缓存：`/api/douban/top250`、`/api/douban/suggest`、`/api/posters`、`/api/image`；GET 详情 86400s。
- cron：每周一清 90 天前日志/180 天前海报错误/过期会话与短链。
- 无障碍：焦点陷阱（引导）、aria-modal/tablist/menu 语义、reduced-motion、触屏 :active。
- PWA：manifest + network-first SW（仅生产域名注册）。
- 性能：首页 3D 光球由 `src/components/DeferredOrb.tsx` 托管——空闲时（`requestIdleCallback`，2s 上限）才加载；`saveData` 或 2G 网络不加载，保留 CSS 兜底背景。
- 质量门：CI（`.github/workflows/ci.yml`）依次跑 check / lint / format:check / test / build；本地对应 `npm run lint|format|format:check`。

## 回归走查清单（改版后必查）

1. 首页→选维度→精选/搜索/批量导入→TopN→排序（键盘+撤销+回环提示）→完成落画像
2. 画像：切换胶囊、改名/删除(⋯+确认条)、手动调整拖拽、编辑作品增删搜、三级批注、点海报详情
3. 导出：JSON/TXT/MD/CSV/PNG × 五版式 × 至少 2 主题
4. 比较：贴对方链接→共识圆环+全指标+悬浮解释→共同/分歧表→点名次进详情→AI 解读→用对方排序
5. 分享：短链+有效期、二维码、/share 页、比较链接
6. 广场：发布→列表(排序/筛选/搜索/滚动)→点赞/评论/回复→作者编辑/历史/隐藏/删除→与曾经的我比较→同步提示
7. 导入：豆列/subject_collection/mine(连接后一键)/网易云按 UID 浏览全部歌单(含收藏)点选导入/网易云直链/other 维基搜索带海报；分批进度条+右上角设置调单次上限(100~1000)+清单折叠/全选/仅保存不排序
8. 账号：注册/登录/OAuth/同步/冲突弹窗/退出清数据
9. 主题：六主题切换、刷新持久化、PNG 跟随
10. /admin 四页签各一操作
