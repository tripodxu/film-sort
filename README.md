# ART/RANK

ART/RANK 把“从看过、读过、听过的作品里排出自己的 Top N”拆成连续的 1v1 取舍。你只需要在两件作品之间选一次，最后得到一份可保存、可导出、可和朋友比较的艺术人格画像。

项目地址：[github.com/tripodxu/film-sort](https://github.com/tripodxu/film-sort)

当前实现使用 React、Vite、TypeScript、Three.js 和 Cloudflare Workers Static Assets：排序和游客画像在浏览器中完成，Three.js 渲染首页的实时艺术光球，Worker 提供同源豆瓣接口、海报代理、匿名事件和可选的 D1 账号画像同步。

## 功能

- 电影、书籍、音乐、其他作品四种媒介，数据模型可继续扩展。
- 游客模式直接开始；登录入口使用 Cloudflare Access，未配置时仍可完整使用本地功能。
- 内置榜单、自定义 TXT / JSON 清单、电影豆瓣 Top250。
- 每次显示两张作品卡片；电影优先使用豆瓣原图、豆瓣 Top250 索引图和 IMDb 备用图，并通过 Worker 代理允许的图片源。
- 点击卡片或按 `A / D / ← / → / 1 / 2` 取舍；支持撤销、略过、暂放。
- 状态栏显示比较次数、处理进度和预计剩余次数；排序草稿自动保存在浏览器。
- 每种媒介保留一份画像，可合并导出全部维度为 JSON、TXT、Markdown、CSV 或 PNG。
- 导入朋友的 JSON 或打开比较链接，查看作品重合度、Top 5 共同作品、顺序一致率和最大名次分歧。
- 极简玻璃态界面，以实时 3D 光球、粒子与低密度胶囊控件构成首页；响应式支持桌面和手机，并遵循减少动态效果设置。

登录功能只负责把画像同步到自己的 D1 记录，不会改变本地排序逻辑。没有 Cloudflare Access 和 D1 时，画像仍会保存在浏览器 `localStorage`。

## 本地运行

要求 Node.js 18 或更高版本。

```bash
npm ci
npm run dev
```

打开 Vite 输出的地址。要使用完整的 Worker 路由和静态资源回退：

```bash
npm run worker:dev
```

常用检查：

```bash
npm run check
npm test -- --run
npm run build
```

## 使用流程

1. 首页选择电影、书籍、音乐或其他。
2. 选择内置榜单、自定义导入，或电影豆瓣 Top250；自定义清单支持每行、逗号、顿号、分号和竖线分隔，也支持包含 `title`、`creator`、`year`、`posterUrls` 的 JSON 数组。
3. 设置 Top N、榜单名称和可选的顺序口令。可在开始前取消候选作品。
4. 在二选一卡片中点击更偏好的一项，或用键盘快捷键完成选择。纠结时使用“暂放”，误选时使用“撤销”。
5. 排序完成后画像会自动保存到浏览器。画像页顶部可以切换媒介，右侧可以改名和导出。
6. 点击“比较画像”导入对方 JSON，或使用“复制比较链接”生成压缩链接和二维码。没有自己的画像时，页面会引导你用同一批作品创建；已有画像则直接计算共同媒介。

详细的操作、导入格式和故障处理见 [`docs/USAGE.md`](docs/USAGE.md)。

## Cloudflare Workers 部署

最小部署不需要 D1：

```bash
npm ci
npm run build
npx wrangler deploy
```

`wrangler.jsonc` 已将 `dist` 绑定为 Static Assets，`worker/index.ts` 处理 `/api/*`，未匹配到静态文件的 HTML 请求会回退到首页，因此比较链接可直接刷新。

### 豆瓣与海报接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/douban/top250?limit=50` | 读取 2–250 部豆瓣 Top250 作品 |
| `GET` | `/api/douban/suggest?q=星际穿越` | 获取豆瓣电影建议和海报 |
| `GET` | `/api/posters?q=星际穿越&en=Interstellar&year=2014` | 组合豆瓣原图、Top250 索引、IMDb 备用 URL |
| `GET` | `/api/image?url=<允许的 HTTPS 图片 URL>` | Worker 代理豆瓣、IMDb、TMDB 海报，避免浏览器跨域和失效 host |

豆瓣可能返回安全验证页或限制请求。此时接口返回 `502`，前端会保留清晰提示并建议使用内置榜单；排序、导出和比较不依赖豆瓣接口。

### D1 与账号同步

创建并绑定 D1 后执行迁移：

```bash
npx wrangler d1 create film-sort
npx wrangler d1 migrations apply film-sort --local
npx wrangler d1 migrations apply film-sort --remote
```

把返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases`。D1 启用后，匿名统计和挑战链接可持久化，画像同步还需要配置 Cloudflare Access：

- `ACCESS_TEAM_DOMAIN`：例如 `team-name.cloudflareaccess.com`。
- `ACCESS_AUD`：Access 应用的 Audience Tag。
- 用 Cloudflare Access 保护 `/api/account/*`，Worker 会验证 `cf-access-jwt-assertion` 的签名、发行方、audience、过期时间和用户主体。

画像只按 Access 用户的 `sub` 存储；浏览器端不会接触 D1 凭据。完整 API、数据留存和部署检查见 [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md)。

## 目录

```text
src/
├── App.tsx                 # 页面状态、排序流程、画像、比较和导出
├── components/Poster.tsx   # 豆瓣 / IMDb / TMDB 海报回退与 Worker 代理
├── data/media.ts           # 跨媒介类型和内置榜单
├── lib/ranking.ts          # 可序列化的二分插入排序状态机
├── lib/profile.ts          # 画像校验、合并、比较和文本导出
└── lib/collections.ts      # 自定义 TXT / JSON 清单校验
worker/
├── index.ts                # Worker 路由、静态资源回退和匿名 API
├── media.ts                # 豆瓣、Top250、IMDb 和海报代理
└── account.ts              # Cloudflare Access JWT 与 D1 画像同步
migrations/                 # D1 表结构迁移
docs/                       # 使用和部署说明
```

## 隐私边界

- 游客画像、排序草稿和匿名 session id 只保存在当前浏览器。
- 分析事件只发送片单规模、媒介、语言和比较次数，不发送完整排名、作品标题、用户输入或联系方式。
- 主动导出的 JSON、分享链接和二维码会包含排名作品；分享前请确认内容适合传播。
- D1 不自动清理数据，生产部署应按需要制定匿名事件和分享记录的留存周期。

## 许可证

当前仓库未声明开源许可证。公开发布前请补充许可证，并确认远程海报资源的使用范围。
