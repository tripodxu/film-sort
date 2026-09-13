# Cloudflare Workers 部署

项目使用 Workers Static Assets 提供 Vite 的 `dist`，`worker/index.ts` 处理 `/api/*`。`run_worker_first: true`，HTML 请求未匹配静态文件时回退 `/index.html`，因此 `/myself`、`/plaza/25`、`/share/<code>` 等 SPA 路由可直接刷新。

## 部署方式（重要）

**推送到 main 即由 Cloudflare 自动部署**（Workers Builds / Git integration：Build command `npm run build`，Deploy command 留空或 `npx wrangler deploy`，Output `dist`）。日常发布只需 `git push`，**不要手动跑 `wrangler deploy`**。

本地调试：

```bash
npm ci
npm run build
npx wrangler dev --port 8787
```

提交前检查：

```bash
npm run check      # tsc
npm test -- --run
npm run build
```

> D1 迁移仍需手动应用（与部署解耦）：`npx wrangler d1 migrations apply film-sort --remote`。迁移脚本必须幂等（`IF NOT EXISTS`），历史教训见 migrations/0017 注释。

## D1

```bash
npx wrangler d1 create film-sort
npx wrangler d1 migrations apply film-sort --local
npx wrangler d1 migrations apply film-sort --remote
```

`wrangler.jsonc` 的 `d1_databases` binding 保持 `DB`。迁移 0001–0020 覆盖：匿名事件、挑战片单、账户体系（user_accounts/sessions/oauth/exchanges）、画像 v2 + 批注、云端清单、分享短链、广场（帖子/点赞/留言/楼中楼/编辑历史）、海报错误日志、Cookie 保险库、管理审计、性能索引、账户禁用态。

清理策略：Worker cron（每周一 03:00 UTC）自动清理 90 天前 `analytics_events`/`api_logs`、180 天前 `poster_errors`、过期的 `admin_sessions`/`user_sessions`/`oauth_exchanges`/`shared_links`。也可在 `/admin` 数据页签手动清理。

## 密钥（wrangler secret，勿写入仓库/前端）

| Secret | 用途 | 不配置时 |
|---|---|---|
| `ADMIN_PASSWORD` | `/admin` 登录（优先于 DB hash） | 用首次登录写入的 DB hash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | 隐藏该登录入口 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth | 隐藏该登录入口 |
| `AI_API_KEY` / `AI_API_URL` | 比较页 AI 解读（Anthropic 兼容端点） | 前端隐藏 AI 按钮，本地指标照常 |

Cookie 保险库密钥无需配置：首次使用时自动生成 AES-256 密钥存入 `admin_config('cookie_enc_key')`，网易云/豆瓣授权 Cookie 以 AES-GCM 加密存 `user_cookie_vault`（不落明文，断开即删）。

## 账号体系（现行）

邮箱密码（PBKDF2-SHA256 10 万次迭代；存量无盐 SHA-256 登录时透明升级）+ Google/GitHub OAuth（state 存 HttpOnly Cookie 防 CSRF；回调换取一次性 `oauth_exchanges` code，前端 `POST /api/account/oauth/exchange` 换 token，**会话 token 不进 URL**）。30 天会话存 `user_sessions`。画像与云端清单各 ≤512KB；登录态下画像防抖自动云同步，切后台/断网/关页用 `keepalive` 补发；同步失败不覆盖本地。

> 旧版 Cloudflare Access JWT 账号同步方案（`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`）已废弃，Env 中仅存类型声明、无消费代码。

## API 概览

完整清单见 [API.md](./API.md)。分组：

- **豆瓣数据**：`/api/douban/{top250,books/top250,music/top250,suggest,books/suggest}`、`/api/{movie,book,music}/{list,detail}`（详情豆瓣官方简介优先→维基消歧打分→百度百科）、`/api/other/{list,detail}`（其他类别维基）、`/api/artwork/detail`、`/api/posters`、`/api/image`
- **导入**：`/api/import/{doulist,douban-list,netease,netease/mine}`（登录 + 8 次/10 分钟）
- **连接**：`/api/netease/*`、`/api/douban/*`（扫码/Cookie/status/disconnect/user-playlists 按 UID 浏览全部歌单含收藏，登录 + 120/10 分钟）
- **广场**：`/api/plaza/posts*`、`/api/comments/:id`
- **账号**：`/api/account/*`
- **分享/挑战**：`POST /api/share`、`GET /api/share/:code`、`/api/challenges*`
- **其他**：`/api/health`、`/api/stats`、`POST /api/events`、`/api/insights`、`/api/music/play`、`/admin` + `/api/admin/*`

图片代理白名单 host：`img{1-9}.doubanio.com`、`m.media-amazon.com`、`ia.media-imdb.com`、`image.tmdb.org`、`*.music.126.net`、`upload/thumb.wikimedia.org`、`bkimg.cdn.bcebos.com`；拒绝非 HTTPS/带凭据/其他 host。

## 限流与安全

- 内存滑窗（10 分钟，按 `cf-connecting-ip`）：auth 30 / ai 8 / music 12 / import 8 / netease 120 / douban 120 / other 20。
- 安全头：CSP（img 白名单、script 含 cloudflareinsights 与 beacon hash）、`X-Frame-Options: DENY`、`frame-ancestors 'none'`、COOP、nosniff、referrer、permissions-policy。
- 写接口同源校验（`assertSameOrigin`）；`POST /api/events` 事件名 + payload 键双白名单，不落 IP/标题/自由文本。
- 边缘缓存（`caches.default`）：top250/suggest/posters/image/music-play；账号/广场/事件 `no-store`；详情响应 `max-age=86400`。

## 上游限流应对

豆瓣/网易云/维基都可能返回验证页、超时或风控（如网易云扫码 8821/-462）。Worker 统一转 502/空结果并带冷却（douban 域 403/418 → 5–15s 域名冷却 + 800ms 最小间隔节流）；扫码被拒时前端有「粘贴 Cookie 连接」兜底。内置榜单、自定义导入、排序、比较、导出均不依赖外部服务，可完全离线使用。
