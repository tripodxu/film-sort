# ART/RANK

ART/RANK 把"从看过、读过、听过的作品里排出自己的 Top N"拆成连续的 1v1 取舍。你只需要在两件作品之间选一次，最后得到一份可保存、可导出、可和朋友比较的艺术人格画像。

项目地址：[github.com/tripodxu/film-sort](https://github.com/tripodxu/film-sort)

## 功能概览

### 排序引擎
- 电影、书籍、音乐、其他作品四种媒介，每种媒介可创建多个独立榜单。
- 主动式二分插入排序：每个候选作品通过与已排序列表中位数比较，逐步缩小插入范围（O(n log n)）。
- 支持撤销、左右独立略过/暂放按钮。
- 排序完成后可随时"重新排序"，从已有榜单重新开始。
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
- **详情接口**：电影使用 search.douban.com 搜索结果（绕过反爬）；书籍/音乐直接抓取详情页。
- 防限流机制：Edge UA 轮换、请求节流、自动重试、全局冷却期。
- 海报解析不到或浏览器加载失败都会记录到 `poster_errors` 表，后台可按来源聚合并导出 CSV。

### 用户系统
- 邮箱 + 密码注册/登录，昵称必填。
- Google / GitHub OAuth 登录，自动获取昵称。
- 登录后可同步画像到云端，支持改昵称。
- 关闭网页时自动同步（`pagehide` + `visibilitychange` + `keepalive`）。
- Token 有效期 30 天，存储在 localStorage。

### 管理后台 (`/admin`)
- 密码通过 `ADMIN_PASSWORD` 环境变量设定。
- 仪表盘：访问统计、14天趋势图、媒介分布饼图。
- 用户账户管理：查看、筛选、禁用/恢复、删除画像或云端清单、删除账户、重置密码。
- D1 存储统计：各表行数。
- 海报错误记录：查看和导出 CSV。
- API 调用日志：最近调用和错误记录。
- 缓存策略说明。

### 比较与导出
- 导入对方 JSON 或生成压缩链接和二维码。
- 计算作品重合度、加权偏好、Top 3 共识、顺序一致率和最大名次分歧；可请求 AI 生成跨媒介解读。
- **两种比较模式**：自动合并（同媒介多榜单合并比较）和指定榜单（手动勾选参与比较的榜单）。
- **共同作品表格**：可按我的顺序或对方顺序排列（交换按钮切换）；排名可点击打开榜单详情弹窗。
- **来源榜单标签**：自动合并模式下显示最高排名的来源榜单名称，多榜单作品显示 "+N" 提示。
- **选择对方榜单重排序**：支持从对方所有榜单中选择任意一个进行排序，自动检测重名并加后缀。
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

### UI/UX
- 榜单选择页：便利贴卡片布局，2/3/4 列可切换。
- 海报果冻悬停动画。
- 海报按原始比例显示，不裁剪。
- 极简玻璃态界面，3D 光球首页。
- 响应式支持桌面和手机（4 断点：1300px / 800px / 600px / 540px）。

## 项目架构

```text
src/
├── App.tsx                    # 主应用：状态管理、路由、所有视图
├── components/
│   ├── Poster.tsx             # 海报组件：API 解析 + 图片代理 + 错误上报
│   └── OrbScene.tsx           # Three.js 首页光球
├── data/
│   ├── media.ts               # 媒介类型定义、内置榜单（电影/书籍/音乐/其他）
│   └── catalog.ts             # 电影目录数据
├── lib/
│   ├── ranking.ts             # 排序状态机（二分插入、环检测、冷却、验证阶段）
│   ├── profile.ts             # 画像解析、合并、重命名、删除、比较、导出
│   └── collections.ts         # 自定义清单导入
├── styles.css                 # 全局样式（含果冻卡片、响应式断点）
└── types.ts                   # 类型定义

worker/
├── index.ts                   # Worker 路由、D1 绑定、管理后台、海报错误日志
├── media.ts                   # 豆瓣/书籍/音乐 API、海报解析、防限流
├── account.ts                 # 用户注册/登录/OAuth、管理员账户管理
└── imdb-posters.json          # IMDb 海报手动映射表

migrations/
├── 0001_initial.sql           # analytics_events, challenge_sets
├── 0002_user_profiles.sql     # user_profiles
├── 0003_api_logs.sql          # api_logs, admin_sessions, admin_config
├── 0004_user_accounts.sql     # user_accounts, user_sessions, user_profiles_v2, user_oauth
├── 0005_oauth_table.sql       # user_oauth
├── 0006_nickname.sql          # user_accounts.nickname
├── 0007_poster_errors.sql     # poster_errors
├── 0008_user_collections.sql  # 云端清单
└── 0008_disabled_at.sql       # 账户禁用字段

docs/
├── USAGE.md                   # 用户操作说明
├── CLOUDFLARE.md              # 部署与 API 文档
└── DOUBAN_API.md              # 豆瓣 API 接口文档
```

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
| GET | `/api/artwork/detail?kind=&q=` | 比较页作品详情（已弃用，前端改用上方三个独立接口） |
| POST | `/api/insights` | 生成画像比较解读（需配置 AI Secret） |
| GET | `/api/music/play?q=` | 音乐试听地址代理 |
| POST | `/api/poster-errors/client` | 记录浏览器端海报加载失败 |

### 用户接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/account/register` | 注册（email, password, nickname） |
| POST | `/api/account/login` | 登录 |
| POST | `/api/account/logout` | 退出 |
| GET | `/api/account/profile` | 读取画像 |
| PUT | `/api/account/profile` | 保存画像 |
| PUT | `/api/account/nickname` | 修改昵称 |
| GET | `/api/account/providers` | 可用 OAuth 提供商 |
| GET | `/api/account/oauth/:provider` | 发起 OAuth |
| GET | `/api/account/oauth/callback` | OAuth 回调 |

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

## 本地运行

```bash
npm ci
npm run dev          # Vite 开发服务器（仅前端）
npm run worker:dev   # Worker + 静态资源（推荐）
npm run check        # TypeScript 检查
npm test             # 测试
npm run build        # 构建
```

## 部署

```bash
npm ci
npm run build
npx wrangler login
npx wrangler d1 create film-sort
# 记下 database_id，填入 wrangler.jsonc
npx wrangler d1 migrations apply film-sort --remote
npm run deploy
```

环境变量（Settings → Variables and Secrets）：
- `ADMIN_PASSWORD`：管理员后台密码
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`：Google OAuth
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`：GitHub OAuth
- `AI_API_KEY`：AI 解读服务 Secret
- `AI_API_URL`：可选，自定义 Anthropic 兼容接口地址

## 已知限制

- `movie.douban.com` 详情页被反爬拦截（302→sec.douban.com），电影详情改用 search.douban.com 搜索结果。
- `music.douban.com` 无 suggest API，音乐封面依赖 Top250 索引和搜索。
- 豆瓣可能随时调整反爬策略，需要持续监控。

## 隐私

- 游客数据只在浏览器 localStorage。
- 分析事件不含作品标题或用户信息。
- 分享链接包含排名作品，请确认后传播。
