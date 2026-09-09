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

### 用户系统

- 邮箱 + 密码注册/登录，昵称必填。
- Google / GitHub OAuth 登录，自动获取昵称。
- 登录后可同步画像到云端，支持改昵称。
- 关闭网页时自动同步（`pagehide` + `visibilitychange` + `keepalive`）。
- Token 有效期 30 天，存储在 localStorage。
- 云端清单管理：登录用户可保存、查看、删除自定义清单。

### 管理后台 (`/admin`)

- 密码通过 `ADMIN_PASSWORD` 环境变量设定。
- 仪表盘：访问统计、14天趋势图、媒介分布饼图。
- 用户账户管理：查看、筛选、禁用/恢复、删除画像或云端清单、删除账户、重置密码。
- D1 存储统计：各表行数。
- 海报错误记录：查看和导出 CSV。
- API 调用日志：最近调用和错误记录。
- 日志清理：支持按时间范围批量清理 API 日志、分析事件和海报错误。
- 缓存策略说明。

### 比较与导出

- 导入对方 JSON 或生成压缩链接和二维码。
- 计算作品重合度、加权偏好、Top 3 共识、顺序一致率和最大名次分歧；可请求 AI 生成跨媒介解读。
- **两种比较模式**：自动合并（同媒介多榜单合并比较）和指定榜单（手动勾选参与比较的榜单）。
- **共同作品表格**：可按我的顺序或对方顺序排列（交换按钮切换）；排名可点击打开榜单详情弹窗。
- **来源榜单标签**：自动合并模式下显示最高排名的来源榜单名称，多榜单作品显示 "+N" 提示。
- **选择对方榜单重排序**：支持从对方所有榜单中选择任意一个进行排序，自动检测重名并加后缀。
- **分享单个榜单**：在「我的文化索引」页面，每个榜单旁有「分享此榜单」按钮，生成仅包含该榜单的比较链接。
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

- 右上角固定工具栏：中英文切换、GitHub 项目链接（图标按钮，点击跳转仓库）、登录/同步按钮。
- GitHub 图标使用 Lucide `Github` 图标，hover 显示 tooltip。

### UI/UX

- 榜单选择页：便利贴卡片布局，2/3/4 列可切换。
- 海报果冻悬停动画。
- 海报按原始比例显示，不裁剪。
- 极简玻璃态界面，3D 光球首页（Three.js）。
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

# 应用数据库迁移
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
│   └── 0009_shared_links.sql      # 共享链接短码
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

---

## 安全

- Content-Security-Policy、X-Frame-Options、Referrer-Policy、Permissions-Policy 全开。
- 图片代理仅允许 `doubanio.com`、`media-amazon.com`、`media-imdb.com`、`tmdb.org` 四类 host。
- 分析事件仅收集产品元数据，不含作品标题或用户信息。
- 分享链接包含排名作品，请确认后传播。
- OAuth state 参数使用 HttpOnly Cookie。

---

## 已知限制

- `movie.douban.com` 详情页被反爬拦截（302→sec.douban.com），电影详情改用 search.douban.com 搜索结果。
- `music.douban.com` 无 suggest API，音乐封面依赖 Top250 索引和搜索。
- 豆瓣可能随时调整反爬策略，需要持续监控。
- 画像大小限制 512 KB，单榜单 2-300 件作品。

---

## 许可

私有项目。
