# Cloudflare Workers 部署

项目使用 Workers Static Assets 提供 Vite 的 `dist`，`worker/index.ts` 处理 `/api/*`。HTML 请求没有匹配到静态文件时回退到 `/index.html`，因此 `/#profile=...` 比较链接可以直接刷新。

## 最小部署

不配置 D1 时，排序、游客画像、导出、压缩比较链接和豆瓣接口都可用：

```bash
npm ci
npm run build
npx wrangler deploy
```

Cloudflare Git integration 可以设置 Build command 为 `npm run build`，Deploy command 为 `npx wrangler deploy`，Build output directory 为 `dist`。

部署前检查：

```bash
npm run check
npm test -- --run
npm run build
npx wrangler deploy --dry-run
```

## API

| 路径 | 说明 |
| --- | --- |
| `/api/health` | 返回 Worker 和 D1 状态 |
| `/api/stats` | 返回匿名完成数；无 D1 时返回不可用状态 |
| `/api/douban/top250?limit=50` | 读取豆瓣 Top250 候选，limit 为 2–250 |
| `/api/douban/suggest?q=...` | 读取豆瓣建议和电影海报 |
| `/api/posters?q=...&en=...&year=...` | 查询豆瓣、Top250、IMDb 后备海报 URL |
| `/api/image?url=...` | 代理已允许 host 的 HTTPS 图片 |
| `/api/auth/config` | 返回账号同步是否启用 |
| `/api/artwork/detail?kind=film|book|music&q=...` | 按需获取作品详情，供比较页详情弹层使用 |
| `/api/account/collections` | 已登录用户的私有榜单读取与保存 |
| `/api/insights` | 可选 AI 偏好解读，仅在用户主动点击后调用 |
| `/api/music/play?q=...` | 音乐试听搜索与链接解析代理，仅在详情弹层主动点击后调用 |
| `/api/challenges/:id` | 读取 D1 中的旧版挑战片单 |

海报允许 host：`img1/2/3/9.doubanio.com`、`m.media-amazon.com`、`ia.media-imdb.com`、`image.tmdb.org`。Worker 会拒绝非 HTTPS、带凭据或其他 host，避免把 `/api/image` 变成开放代理。

豆瓣和 IMDb 都可能返回验证页、超时或限流。Worker 将这类上游错误转换为 `502` 或空 `poster_urls`，不把 HTML 错误页面交给浏览器。

### 匿名事件

`POST /api/events` 只接受白名单事件和产品元数据：媒介、片单 ID、作品数量、Top N、比较次数、语言等。完整排名、作品标题、自由输入、联系方式和 IP 不会写入事件。没有 D1 时返回 `202`，不阻断前端流程。

## D1

创建数据库并应用迁移：

```bash
npx wrangler d1 create film-sort
npx wrangler d1 migrations apply film-sort --local
npx wrangler d1 migrations apply film-sort --remote
```

在 `wrangler.jsonc` 中取消注释 `d1_databases`，把 `database_id` 替换为真实值，binding 保持 `DB`。迁移包含匿名事件、账号画像、私有榜单、账户禁用状态和海报错误日志。

建议预览环境使用独立数据库。D1 没有自动清理策略，生产环境应按运营要求定期清理匿名事件，例如：

```sql
DELETE FROM analytics_events
WHERE created_at < datetime('now', '-180 days');
```

## Cloudflare Access 账号同步

账号同步是可选的。配置 Access 应用保护 `/api/account/*`，并将以下 Worker variables 写入环境：

- `ACCESS_TEAM_DOMAIN`：Access team domain，不带协议或尾部 `/`。
- `ACCESS_AUD`：应用的 Audience Tag。

`GET /api/account/login` 会跳转到 Cloudflare Access 登录页。读取和写入画像时，Worker 从 `cf-access-jwt-assertion` 验证 RS256 签名、`iss`、`aud`、`sub`、邮箱和过期时间；证书从 team domain 的 Access certs endpoint 缓存读取。

账号画像与单个私有榜单均限制为 512 KB；榜单包含 2–300 件作品。登录状态下，画像变更会在浏览器空闲时自动同步，并在切到后台、网络恢复或关闭页面时使用 `keepalive` 尝试发送最后一次保存。同步失败不会覆盖浏览器本地画像。

## 管理后台

`/admin` 由 `ADMIN_PASSWORD` 或 D1 中的管理员配置保护。管理员可以查看账户状态、禁用或恢复账户、重置密码、清理用户画像/私有榜单，以及导出并按媒介与错误类型查看海报失败日志。

```bash
npx wrangler secret put ADMIN_PASSWORD
```

不要把管理员密码、OAuth client secret 或 AI 服务密钥写入 `wrangler.jsonc`、前端代码或仓库。后续 AI 功能使用 `AI_API_KEY` 形式的 Cloudflare Secret。

可选 AI 配置：

```bash
npx wrangler secret put AI_API_KEY
npx wrangler secret put AI_API_URL
```

未配置 `AI_API_KEY` 时，前端隐藏 AI 结果并继续使用本地比较指标。AI 与音乐代理均有按 IP 的时间窗口限制，音乐上游使用 `music-api.gdstudio.xyz`，避免把第三方 API 直接暴露给浏览器。

## 安全与缓存

Worker 设置 CSP、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和 `nosniff`。豆瓣、海报查询和图片代理响应可在 Cloudflare Cache API 中缓存；账号、事件和挑战写入保持同源检查和 `no-store`。

如果线上遇到豆瓣限流，可降低前端 Top250 默认范围、延长缓存 TTL，或暂时关闭豆瓣入口。内置榜单和自定义导入不依赖外部服务。
