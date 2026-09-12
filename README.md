# ART/RANK

**你的个人文化索引 — 在两件作品之间，找到你真正想留下的那一个。**

ART/RANK 把"从看过、读过、听过的作品里排出自己的 Top N"拆成连续的 1v1 取舍。你只需要在两件作品之间选一次，最后得到一份可保存、可导出、可和朋友比较的艺术人格画像。

项目地址：[github.com/tripodxu/film-sort](https://github.com/tripodxu/film-sort)

---

## 功能概览

### 排序引擎

- **四种媒介**：电影、书籍、音乐、其他作品，每种媒介可创建多个独立榜单。
- **主动式二分插入排序**：每个候选作品通过与已排序列表中位数比较，逐步缩小插入范围，时间复杂度 O(n log n)。
- **可恢复的排序状态**：支持撤销、左右独立略过/暂放按钮，排序草稿自动保存到浏览器 localStorage。
- **偏好回环检测**：记录 A→B→C→A 的偏好循环，首次出现安排复测，多次一致时保留为"真实张力"。
- **验证阶段**：排序完成后自动复测少量相近取舍，让结果更贴近直觉。
- **键盘快捷键**：`A`/`←`/`1` 选择左侧，`D`/`→`/`2` 选择右侧。
- 前三名显示 🥇🥈🥉 奖牌。

### 品味年轮（Taste Rings）

- 按维度分组展示所有已完成的榜单，支持 Row/Col 两种布局切换。
- 每个榜单支持内联重命名和删除（macOS 风格 🟡🔴 圆点按钮）。
- 维度卡片在初始状态也会显示随机缓存的海报图。
- 支持清除本地所有缓存数据。

### 豆瓣与海报系统

- **电影**：suggest API + Top250 索引 + search.douban.com 搜索 + IMDb 备用。
- **书籍**：suggest API（`pic` 字段）+ Top250 索引 + search.douban.com 搜索。
- **音乐**：Top250 索引 + search.douban.com 搜索（无 suggest API）。
- **详情接口**：优先通过 Wikipedia（中英文）和百度百科获取内容简介；元数据从豆瓣搜索结果和详情页补充。
- **防限流机制**：Edge UA 轮换、请求节流（同域名间隔 800ms）、自动重试（指数退避）、全局冷却期。
- 海报解析不到或浏览器加载失败都会记录到 `poster_errors` 表，后台可按来源聚合并导出 CSV。

### 外部导入（登录用户）

自定义清单来源页提供三种导入方式（均按当前媒介加入「已添加作品」区，可增删后载入排序并自动存云端清单）：

- **即搜即加**：输入标题回车，豆瓣搜索候选（电影/书籍/音乐三类全启用）以海报+元数据点选加入；无匹配可仅以标题加入；原批量 TXT/JSON 导入折叠为高级入口。
- **豆瓣豆列**：粘贴 `douban.com/doulist/` 链接，Worker 端分页抓取整份豆列（最多 300 条，含标题/创作者/年份/评分/海报），按条目链接自动识别媒介；非当前媒介的作品会提示切换媒介后重导。
- **网易云歌单**：音乐媒介粘贴歌单链接或 ID，抓取歌名/歌手/专辑封面（上限 300 首）；专辑封面经图片代理加载（`music.126.net` 已入白名单）。

**网易云扫码连接**：音乐媒介可「扫码连接网易云」——用网易云音乐 App 扫二维码授权后，可浏览并一键导入自己的歌单（含「我喜欢的音乐」）。授权 Cookie 仅提取 `MUSIC_U` 并以 **AES-GCM 加密**存于 D1（绝不落明文，密钥存服务端配置），可随时断开并删除。豆瓣无公开扫码/OAuth 接口且详情页有反爬限制，故不支持豆瓣账号连接，请用豆列链接方式导入。

- 导入接口仅登录用户可用；`/api/import/*` IP 限流 8 次/10 分钟，扫码轮询独立限流。

### 用户系统

- 邮箱 + 密码注册/登录，昵称必填。
- Google / GitHub OAuth 登录，自动获取昵称。
- 登录后可同步画像到云端，支持改昵称。
- 关闭网页时自动同步（`pagehide` + `visibilitychange` + `keepalive`）。
- Token 有效期 30 天，存储在 localStorage。
- 云端清单管理：登录用户可保存、查看、删除自定义清单。

### 管理后台 (`/admin`)

密码通过 `ADMIN_PASSWORD` 环境变量或 D1 `admin_config` 表设定（可在数据页签修改 DB 密码）。看板分四个页签：

- **概览**：访问统计、14天趋势图、媒介分布饼图、API 调用与错误记录、海报失败与聚合、最近用户事件、系统状态。
- **用户**：账户列表（禁用/恢复、删除画像或云端清单、删除账户、重置密码），「查看」打开用户数据抽屉——完整画像渲染（各维度榜单奖牌排名+海报缩略图）、全部批注、云端清单、活跃会话数与 OAuth 绑定。
- **广场（最高管理权限）**：全量帖子列表（含隐藏帖），按媒介筛选、按标题/昵称/邮箱搜索、分页；支持查看完整详情（榜单内容+全部评论）、隐藏/恢复帖子、删除任意帖子（原子清理评论与点赞）与任意评论（连同回复并修正计数）。
- **数据**：D1 全表存储统计、会话与链接管理（强制下线全部用户、清理过期分享链接、修改管理密码）、日志清理、分级数据重置与管理操作审计日志。

**分级数据重置**（全部不可恢复，三重防护）：`analytics`（运行数据）/ `plaza`（广场内容）/ `shares`（分享短链）/ `accounts`（全部账户及用户内容，最高危）。执行需精确输入确认短语 `RESET` 并重新验证管理员密码；所有重置与危险操作均写入审计日志。建议重置前用 `wrangler d1 export` 备份。

**审计日志**：删除账户、禁用/恢复、重置密码、删帖/隐藏、数据重置、强退用户、改密等管理操作全部记录时间、操作类型、详情与来源 IP，在数据页签可查。

**管理权限边界**：管理员可查看用户画像与批注内容（画像查看仅限管理后台），用于内容治理与用户支持；部署者应妥善保管 `ADMIN_PASSWORD`。

### 广场（Plaza）

- 登录用户可发布两种内容到广场：**单个榜单**（`post_type: ranking`）或**完整画像**（`post_type: profile`，包含全部榜单与批注），支持添加描述文字。
- 广场是公共信息流，支持按媒介筛选（全部/电影/书籍/音乐/其他）、**关键词搜索**（榜单标题/作者昵称）、最新与最热排序（服务端 SQL 排序，最热按全量点赞数），卡片显示相对时间戳（刚刚/N分钟前/天数/日期）与画像/榜单类型徽章。
- 每个帖子显示前三名海报、榜单名称、发布者昵称、点赞数和留言数、批注数量。
- 其他用户可以点赞（toggle，登录后显示已赞状态）、留言（最长 500 字）、用对方榜单排序或发起比较。
- 留言支持回复其他评论，形成嵌套讨论（缩进显示）。
- **作者专属编辑**：自己的榜单帖可「编辑榜单」——调整顺序、增删作品（手动添加，支持「标题 - 创作者（年份）」解析）；保存后生成差异编辑记录（remove/add/reorder），帖子显示「最后编辑于 X（N 次）」公开标记，作者可展开查看完整编辑历史（每步操作带服务端时间戳）。自己的帖子「与我比较」自动变为「与曾经的我比较」——用帖子内容与当前画像比较，看到现在的自己 vs 当年发布的自己。
- 我的榜单在文化索引页支持「编辑作品」（逐条移除、手动批量添加、豆瓣搜索添加），保存后自动重编排名并云端同步；已发布广场的榜单会出现「同步到广场」一键更新提示。
- 列表接口为瘦身响应（仅前三名作品与批注数量，`json_extract` 提取），配置 kind+created_at 与 like_count 排序索引，前端支持无限滚动加载，可平滑支撑大量帖子。
- 发布者可删除自己的帖子和留言；删除操作均为原子批量执行。

### 查看分享（`/share/:code`）

- 直接打开分享链接时进入查看页面，展示对方榜单/画像内容（含批注）。
- 可选择「用此榜单排序」或「与我比较」。
- 页面底部提供「复制分享链接」按钮，随时复制当前链接转发给其他人。
- 分享链接支持选择有效期（7/30/90/365 天，生成时选择，到期自动失效），查看页显示失效日期。
- 未登录用户会看到「如何创建自己的分享链接」操作指引。
- 长批注自动截断显示，点击「展开全文」查看完整内容。
- 在「相遇」页面粘贴链接的行为不变，仍直接进入比较界面。

### 链接类型说明

| 按钮 | 链接格式 | 行为 |
|------|----------|------|
| **比较链接** | `/encounter?payload=<8位短码>` | 对方打开直接进入比较界面 |
| **分享链接** | `/share/<8位短码>` | 对方打开进入查看页面，展示榜单内容 |

两种链接在「我的文化索引」和「相遇」页面均可生成，均包含批注数据。画像整体（多维度）分享按钮位于「我的文化索引」页面右上角（「分享链接」胶囊按钮，与「添加画像批注」并排），单个榜单的分享/比较链接在该榜单标题行操作区。「比较链接」按钮复制的是 `/encounter?payload=<短码>` 比较链接（对方打开直接进入比较界面），「分享链接」按钮复制的是 `/share/<短码>` 查看链接。

### 比较与导出

- 导入对方 JSON 或生成压缩链接和二维码。
- 计算作品重合度、加权偏好、Top 3 共识、顺序一致率和最大名次分歧；可请求 AI 生成跨媒介解读。
- **两种比较模式**：自动合并（同媒介多榜单合并比较）和指定榜单（手动勾选参与比较的榜单）。
- **共同作品表格**：可按我的顺序或对方顺序排列（交换按钮切换）；排名可点击打开榜单详情弹窗。
- **来源榜单标签**：自动合并模式下显示最高排名的来源榜单名称，多榜单作品显示 "+N" 提示。
- **榜单海报点击详情**：比较界面点击榜单海报区域可打开该榜单的完整排名详情弹窗（与共同作品表格中点击排名相同）。
- **单榜单前三名竖排展示**：总榜单数为1的那一方，布局为「榜单名称 | 前三名竖排居中（🥇🥈🥉 + 海报） | Top N」；多方保持单个榜首海报。各自独立判断。
- **选择对方榜单重排序**：支持从对方所有榜单中选择任意一个进行排序，自动检测重名并加后缀。
- **分享单个榜单**：在「我的文化索引」页面，每个榜单旁有「分享此榜单」按钮，生成仅包含该榜单的比较链接。
- **批注系统**：文化索引页面支持三个层级的批注——画像整体（胶囊按钮「添加画像批注」）、榜单标题（胶囊按钮「添加批注」）、单个作品（行内便签图标）。有批注时按钮高亮 accent 色并显示文字。登录状态下批注随画像自动同步云端。分享链接、广场帖子详情、比较详情弹窗均支持批注展示（长批注截断后点击弹窗查看完整内容）。广场发布时只包含该榜单相关的批注。导出（TXT/MD/CSV/JSON）均自动包含批注内容。页面刷新或重新登录时自动从云端恢复批注。
- **统一榜单详情（RankingDetail 组件）**：分享查看页、比较界面的榜单详情弹窗、广场帖子详情三处共用同一详情组件——标题区（媒介/TOP N 眉标 + 榜单级批注）、金银铜牌排名列表、作品级批注、点击海报打开作品详情弹窗，交互与视觉完全一致。比较界面的榜单详情弹窗仅展示对应一侧（我的/对方）的批注；从弹窗内打开批注全文或作品详情时按层级堆叠，关闭上层后回到榜单详情。
- **统一作品详情（ArtworkDetail 组件）**：所有「作品海报」点击入口（文化索引、分享页、广场帖子、比较详情）都打开同一个作品详情弹窗（海报、元数据、简介、音乐试听）；所有「榜单海报」点击入口（比较界面双方榜单行、广场卡片、分享链接）都进入对应的榜单详情。规则：榜单海报 → 榜单详情，作品海报 → 作品详情。
- **批注数据隔离**：通过 `/share/:code` 打开他人分享时，对方的批注只存入 `peerNotes`（会话级状态），绝不写入本地批注（`art-rank:notes`），也不会被同步到自己的云端画像。从分享页点击「与我比较」后，对方批注会保留并显示在比较详情弹窗中。
- **批注阅读器（Amado 风格）**：批注编辑/查看弹窗采用 1060×880 大尺寸毛玻璃阅读器面板（backdrop blur 28px + 饱和度增强），等宽字体大写标题 + 衬线正文排版，海报模糊背景，底部悬浮胶囊工具栏，右下角取景框角标，移动端自动全屏。
- **榜单详情弹窗优化**：共同作品和比较界面点击排名打开的详情弹窗，前三名显示金银铜牌奖牌；每个作品显示批注（📝）；点击海报可打开作品详情。
- 导出格式：JSON、TXT、Markdown、CSV、PNG（三种布局：Editorial / Collage / Minimal）。
- 点击作品可查看详情弹窗（海报、评分、元数据）；音乐支持试听。

### URL 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 清单 | 首页，媒介选择入口 |
| `/catalog/source` | 选择来源 | 内置榜单 / 自定义 / 豆瓣 |
| `/catalog/setup` | 配置排序 | Top N、候选作品筛选 |
| `/catalog/sorting` | 排序中 | 1v1 取舍界面 |
| `/encounter` | 相遇 | 与他人比较 |
| `/encounter?payload=<code>` | 相遇 | 通过分享链接导入对方索引 |
| `/myself` | 我的文化索引 | 已完成的榜单和画像 |
| `/share/:code` | 查看分享 | 查看他人分享的榜单/画像 |
| `/plaza` | 广场 | 公共信息流，浏览和互动 |
| `/plaza/:id` | 广场帖子详情 | 单个帖子详情 + 留言 |

- 所有页面支持浏览器前进/后退、直接输入路径访问、书签收藏。
- `?lang=en` 参数在页面切换时保留。

### 使用引导

- 首次访问自动弹出使用说明弹窗，展示 5 步快速上手指南。
- 底部按钮：「知道了」关闭弹窗 / 「不再显示」写入 localStorage 后不再自动弹出。
- 首页右下角固定 `?` 帮助按钮，随时可调出使用说明。
- 使用说明内可进入「技术说明」弹窗，包含 4 个可折叠板块：
  - 排序算法：二分插入、冷却机制、偏好回环检测、验证阶段、撤销
  - 比较算法：维度合并、贪心匹配、6 项比较指标
  - 海报与详情 API：三级来源策略、Wikipedia/百度百科详情获取、防限流机制
  - 数据存储：游客 localStorage、登录用户 D1 同步、分享链接编码
- 技术说明底部提供 GitHub 项目链接。

### 导航栏

- 右上角固定工具栏：中英文切换、广场入口、GitHub 项目链接（图标按钮，点击跳转仓库）、用户按钮（未登录显示「登录/同步」，已登录显示「同步/退出」）。
- GitHub 图标使用 Lucide `Github` 图标，hover 显示 tooltip。

### UI/UX

- 榜单选择页：便利贴卡片布局，2/3/4 列可切换。
- 海报果冻悬停动画。
- 海报按原始比例显示，不裁剪。
- 极简玻璃态界面，3D 光球首页（Three.js）。
- 发布到广场弹窗（玻璃面板 + 关闭按钮）、广场评论表单、手动排序拖拽反馈（拖拽中半透明、accent 色插入位置指示线）均具备完整样式，并支持 `prefers-reduced-motion`。
- 响应式支持桌面和手机（4 断点：1300px / 800px / 600px / 540px）。
- 支持 `prefers-reduced-motion` 无障碍设置。
- 支持中英文双语切换。

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 本地开发

```bash
# 安装依赖
npm ci

# 仅前端开发服务器（Vite HMR）
npm run dev

# 前端 + Worker 完整环境（推荐）
npm run worker:dev

# TypeScript 类型检查
npm run check

# 运行测试
npm test

# 构建生产版本
npm run build
```

### 部署到 Cloudflare

```bash
# 安装依赖并构建
npm ci
npm run build

# 登录 Cloudflare
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create film-sort
# 记下 database_id，填入 wrangler.jsonc

# 应用数据库迁移（0015 OAuth / 0016 审计 / 0017 海报 source / 0018 广场索引 / 0019 编辑历史 / 0020 Cookie 保险库）
npx wrangler d1 migrations apply film-sort --remote

# 部署
npm run deploy
```

### 环境变量

在 Cloudflare Dashboard → Settings → Variables and Secrets 中配置：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ADMIN_PASSWORD` | 否 | 管理员后台密码 |
| `GOOGLE_CLIENT_ID` | 否 | Google OAuth 客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 否 | Google OAuth 客户端密钥 |
| `GITHUB_CLIENT_ID` | 否 | GitHub OAuth 客户端 ID |
| `GITHUB_CLIENT_SECRET` | 否 | GitHub OAuth 客户端密钥 |
| `AI_API_KEY` | 否 | AI 解读服务密钥 |
| `AI_API_URL` | 否 | 自定义 Anthropic 兼容接口地址 |

> 不要把密钥写入 `wrangler.jsonc`、前端代码或仓库。

---

## 项目架构

```text
film-sort3/
├── src/                           # 前端源码（React + TypeScript）
│   ├── App.tsx                    # 主应用：状态管理、路由、所有视图组件
│   ├── main.tsx                   # React 入口
│   ├── types.ts                   # 旧版类型定义（Movie, FilmList 等）
│   ├── styles.css                 # 全局样式（含果冻卡片、响应式断点）
│   ├── content-intro.test.ts      # 测试文件
│   ├── components/
│   │   ├── Poster.tsx             # 海报组件：API 解析 + 图片代理 + 错误上报
│   │   └── OrbScene.tsx           # Three.js 首页 3D 光球
│   ├── data/
│   │   ├── media.ts               # 媒介类型定义、内置榜单（电影/书籍/音乐/其他）
│   │   └── catalog.ts             # 电影目录数据（详细电影列表）
│   └── lib/
│       ├── ranking.ts             # 排序状态机（二分插入、环检测、冷却、验证阶段）
│       ├── profile.ts             # 画像解析、合并、重命名、删除、比较、导出
│       └── collections.ts         # 自定义清单导入解析
│
├── worker/                        # Cloudflare Worker 后端
│   ├── index.ts                   # Worker 路由、D1 绑定、管理后台、海报错误日志
│   ├── media.ts                   # 豆瓣/书籍/音乐 API、海报解析、防限流、Wikipedia/百度百科
│   ├── account.ts                 # 用户注册/登录/OAuth、管理员账户管理、云端清单
│   └── plaza.ts                   # 广场接口（帖子 CRUD、点赞、留言）
│   └── imdb-posters.json          # IMDb 海报手动映射表
│
├── migrations/                    # D1 数据库迁移
│   ├── 0001_initial.sql           # analytics_events, challenge_sets
│   ├── 0002_user_profiles.sql     # user_profiles
│   ├── 0003_api_logs.sql          # api_logs, admin_sessions, admin_config
│   ├── 0004_user_accounts.sql     # user_accounts, user_sessions, user_profiles_v2, user_oauth
│   ├── 0005_oauth_table.sql       # user_oauth
│   ├── 0006_nickname.sql          # user_accounts.nickname
│   ├── 0007_poster_errors.sql     # poster_errors
│   ├── 0008_user_collections.sql  # 云端清单
│   ├── 0008_disabled_at.sql       # 账户禁用字段
│   ├── 0009_shared_links.sql      # 共享链接短码
│   ├── 0011_plaza.sql             # 广场帖子、点赞、留言
│   ├── 0015_oauth_exchange.sql    # OAuth 一次性 code 交换
│   ├── 0016_admin_audit.sql       # 管理操作审计日志
│   ├── 0017_poster_errors_source.sql # poster_errors 补充 source 列
│   ├── 0018_plaza_perf.sql        # 广场排序/筛选索引
│   ├── 0019_plaza_post_edits.sql  # 广场帖子编辑历史
│   └── 0020_cookie_vault.sql      # 外部平台 Cookie 加密保险库
│
├── docs/                          # 文档
│   ├── ARCHITECTURE.md            # 技术架构文档
│   ├── API.md                     # API 接口参考
│   ├── USAGE.md                   # 用户操作说明
│   ├── OPTIMIZATION.md            # 优化路线图
│   ├── CLOUDFLARE.md              # Cloudflare 部署文档
│   └── DOUBAN_API.md              # 豆瓣 API 接口文档
│
├── package.json                   # 项目配置
├── tsconfig.json                  # TypeScript 根配置
├── tsconfig.app.json              # 前端 TS 配置
├── tsconfig.worker.json           # Worker TS 配置
├── vite.config.ts                 # Vite 构建配置
├── vitest.config.ts               # Vitest 测试配置
├── wrangler.jsonc                 # Cloudflare Workers 配置
└── index.html                     # HTML 入口
```

### 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 19 |
| 构建工具 | Vite | 6 |
| 3D 渲染 | Three.js | 0.185 |
| 图标库 | Lucide React | 0.468 |
| 压缩库 | fflate | 0.8 |
| 二维码 | qrcode | 1.5 |
| 后端运行时 | Cloudflare Workers | — |
| 数据库 | Cloudflare D1 (SQLite) | — |
| 静态资源 | Workers Static Assets | — |
| 类型检查 | TypeScript | 5.7 |
| 测试框架 | Vitest | 2.1 |
| 部署工具 | Wrangler | 4.35 |

---

## API 端点

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/stats` | 公开统计 |
| GET | `/api/posters?q=&en=&type=&year=` | 海报 URL（movie/book/music） |
| GET | `/api/image?url=` | 图片代理 |
| GET | `/api/douban/top250?limit=` | 电影 Top250 |
| GET | `/api/douban/books/top250?limit=` | 书籍 Top250 |
| GET | `/api/douban/music/top250?limit=` | 音乐 Top250 |
| GET | `/api/douban/suggest?q=` | 电影 suggest |
| GET | `/api/douban/books/suggest?q=` | 书籍 suggest |
| GET | `/api/book/list?key=&page=` | 书籍搜索 |
| GET | `/api/movie/list?key=&page=` | 影视搜索 |
| GET | `/api/music/list?key=&page=` | 音乐搜索 |
| GET | `/api/book/detail?name=` | 书籍详情（Wikipedia 优先） |
| GET | `/api/movie/detail?name=` | 影视详情（Wikipedia 优先） |
| GET | `/api/music/detail?name=` | 音乐详情（Wikipedia 优先） |
| POST | `/api/insights` | 生成画像比较解读（需 AI_API_KEY） |
| GET | `/api/music/play?q=` | 音乐试听地址代理 |
| POST | `/api/poster-errors/client` | 浏览器端海报加载失败上报 |
| POST | `/api/share` | 创建分享短链（可选 expires_days：7/30/90/365 天，返回 url/compareUrl/expires_at） |
| GET | `/api/share/:code` | 获取分享内容（profile + notes + expires_at） |
| GET | `/api/import/doulist?url=` | 导入豆瓣豆列（登录用户，IP 限流） |
| GET | `/api/import/netease?url=` | 导入网易云歌单（登录用户，支持连接 Cookie 导入私有歌单） |
| GET | `/api/import/netease/mine` | 我的网易云歌单列表（需扫码连接） |
| GET | `/api/netease/qr/issue` | 生成网易云扫码登录二维码（登录用户） |
| GET | `/api/netease/qr/poll?unikey=` | 轮询扫码状态 waiting/scanned/confirmed/expired |
| GET | `/api/netease/status` | 网易云连接状态 |
| POST | `/api/netease/disconnect` | 断开网易云连接并删除加密 Cookie |

### 用户接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/account/register` | 注册 |
| POST | `/api/account/login` | 登录 |
| POST | `/api/account/logout` | 退出 |
| GET | `/api/account/profile` | 读取画像 |
| PUT | `/api/account/profile` | 保存画像 |
| PUT | `/api/account/nickname` | 修改昵称 |
| GET | `/api/account/providers` | 可用 OAuth 提供商 |
| GET | `/api/account/oauth/:provider` | 发起 OAuth |
| GET | `/api/account/oauth/callback` | OAuth 回调 |
| GET | `/api/account/collections` | 获取云端清单 |
| POST | `/api/account/collections` | 保存云端清单 |
| DELETE | `/api/account/collections/:id` | 删除云端清单 |

### 广场接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plaza/posts?page=&limit=&kind=&sort=&q=` | 获取广场帖子列表（分页、媒介筛选、最新/最热服务端排序、关键词搜索；瘦身响应仅含前三名与批注数、is_author） |
| GET | `/api/plaza/posts/:id` | 获取单个帖子详情（含留言、编辑计数/最后编辑时间、当前用户 is_author/liked_by_me） |
| POST | `/api/plaza/posts` | 发布帖子到广场（ranking 榜单 / profile 画像，需登录） |
| PUT | `/api/plaza/posts/:id` | 编辑自己的帖子（标题/描述/批注/排序 + edits 操作明细，需登录 + 所有权） |
| GET | `/api/plaza/posts/:id/edits` | 获取帖子编辑历史（仅作者） |
| DELETE | `/api/plaza/posts/:id` | 删除自己的帖子（需登录 + 所有权） |
| POST | `/api/plaza/posts/:id/like` | 点赞/取消点赞（需登录） |
| GET | `/api/plaza/posts/:id/comments` | 获取留言列表 |
| POST | `/api/plaza/posts/:id/comments` | 发表留言（需登录） |
| DELETE | `/api/comments/:id` | 删除自己的留言 |

### 管理接口（需 ADMIN_PASSWORD）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 管理员登录 |
| GET | `/api/admin/dashboard` | 仪表盘数据 |
| GET | `/api/admin/accounts` | 用户列表 |
| DELETE | `/api/admin/accounts/:id` | 删除用户 |
| POST | `/api/admin/accounts/:id/reset-password` | 重置密码 |
| POST | `/api/admin/accounts/:id/disable` | 禁用账户 |
| POST | `/api/admin/accounts/:id/restore` | 恢复账户 |
| DELETE | `/api/admin/accounts/:id/profile` | 删除用户画像 |
| DELETE | `/api/admin/accounts/:id/collections` | 删除用户云端清单 |
| GET | `/api/admin/poster-errors?days=7` | 海报错误查询 |
| GET | `/api/admin/poster-errors/export?days=30` | 海报错误 CSV 导出 |
| POST | `/api/admin/logs/clean` | 日志清理 |
| GET | `/api/admin/plaza/posts` | 广场帖子管理列表（含隐藏帖、可筛选搜索） |
| GET | `/api/admin/plaza/posts/:id` | 帖子完整详情（含全部评论与作者邮箱） |
| DELETE | `/api/admin/plaza/posts/:id` | 删除任意帖子（原子清理评论与点赞） |
| POST | `/api/admin/plaza/posts/:id/visibility` | 隐藏/恢复帖子 |
| DELETE | `/api/admin/plaza/comments/:id` | 删除任意评论（含其回复并修正计数） |
| GET | `/api/admin/accounts/:id/detail` | 用户完整数据（画像/批注/清单/会话/OAuth） |
| POST | `/api/admin/reset` | 分级数据重置（需确认短语 RESET + 管理员密码重验） |
| GET | `/api/admin/audit` | 管理操作审计日志 |
| POST | `/api/admin/change-password` | 修改管理后台密码（仅 DB 密码模式） |
| POST | `/api/admin/sessions/revoke-all` | 强制下线全部用户 |
| POST | `/api/admin/links/clean-expired` | 清理过期分享链接 |

---

## 缓存策略

| 数据 | 存储位置 | 过期时间 |
|------|----------|----------|
| 海报/图片 | Edge Cache | 24 小时 |
| 搜索结果 | Edge Cache | 1 小时 |
| 详情页 | Edge Cache | 24 小时 |
| Top250 索引 | Worker 内存 Map | 15 分钟 |
| 海报错误 | D1 持久化 | 永久 |
| API 日志 | D1 持久化 | 永久 |
| 用户画像 | D1 持久化 | 永久 |
| 排序草稿 | 浏览器 localStorage | 手动清除 |

**PWA 缓存更新策略**：Service Worker 对页面导航请求采用 network-first（部署新版本后立即生效，离线时回退缓存的 index.html），对带 hash 的静态资源采用 cache-first；缓存版本号升级（`art-rank-v2`）时自动清理旧缓存。开发环境（localhost）不注册 Service Worker，避免缓存住未带 hash 的源码模块导致热更新失效。

---

## 安全

- Content-Security-Policy、X-Frame-Options、Referrer-Policy、Permissions-Policy 全开。
- 用户与管理后台密码采用 PBKDF2-SHA256 加盐哈希（10 万次迭代，存储格式 `pbkdf2$<iterations>$<salt>$<hash>`），恒定时间比较；旧的无盐 SHA-256 哈希在登录成功时自动透明升级。
- 管理后台（/admin）所有动态内容（用户邮箱/昵称、海报标题、API 路径、事件 payload 等）渲染前统一 HTML 转义，防止存储型 XSS。
- 图片代理仅允许 `doubanio.com`、`media-amazon.com`、`media-imdb.com`、`tmdb.org` 四类 host。
- 分析事件仅收集产品元数据，不含作品标题或用户信息。
- 分享链接包含排名作品，请确认后传播。
- OAuth 回调强制校验发起时写入的 HttpOnly Cookie state（CSRF 防护）；登录成功后通过一次性 code（5 分钟有效、用后即焚，存于 `oauth_exchanges` 表）交换会话 token，30 天 token 不再出现在重定向 URL 和浏览器历史。
- 管理后台所有危险操作（数据重置/删帖/删户/改密等）写入 `admin_audit` 审计日志（时间/操作/详情/来源 IP）；数据重置需确认短语 + 密码双重验证，并受 IP 限流保护。
- 外部平台（网易云）授权 Cookie 以 AES-GCM 加密存储于 `user_cookie_vault`（加密密钥存服务端配置，不与数据同源暴露），仅用于用户本人歌单导入，断开即删。

---

## 已知限制

- `movie.douban.com` 详情页被反爬拦截（302→sec.douban.com），电影详情改用 search.douban.com 搜索结果。
- `music.douban.com` 无 suggest API，音乐封面依赖 Top250 索引和搜索。
- 豆瓣可能随时调整反爬策略，需要持续监控。
- 画像大小限制 512 KB，单榜单 2-300 件作品。

---

## 许可

私有项目。
