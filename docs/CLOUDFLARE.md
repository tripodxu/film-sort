# Cloudflare Workers 部署

项目使用 Workers Static Assets 提供 Vite 的 `dist`，`worker/index.ts` 处理 `/api/*`。`wrangler.jsonc` 的两个绑定是 `ASSETS`（assets，`directory: ./dist`）与 `DB`（D1，`database_name: film-sort`，`migrations_dir: migrations`），`compatibility_date` 为 `2026-08-01`，`observability.enabled` 为 `true`，cron 触发为 `0 3 * * 1`（每周一 03:00 UTC）。`run_worker_first: true`，HTML 请求未匹配静态文件时回退 `/index.html`，因此 `/myself`、`/plaza/25`、`/share/<code>` 等 SPA 路由可直接刷新。

## 部署方式（重要）

`.github/workflows/ci.yml` 在 push 到 `main`（以及 `docs/**`）和 PR 到 `main` 时依次执行：

```bash
npm ci
npm run check         # tsc -b
npm run lint          # eslint
npm run format:check  # prettier --check
npm test -- --run
npm run build
```

CI **只做检查，不部署**（步骤清单详见 `OPTIMIZATION.md` §7.1）。

部署走 `wrangler`：

```bash
npm run deploy   # = npm run build && wrangler d1 migrations apply film-sort --remote && wrangler deploy
```

`npm run deploy` 已把远端迁移包含在内（迁移脚本必须幂等，`IF NOT EXISTS`；历史教训见 `migrations/0017` 注释），不要把 `wrangler d1 migrations apply` 再当成部署后的独立步骤。

> 若在 Cloudflare Dashboard 启用了 Workers Builds / Git integration，`git push` 到 `main` 即可触发部署，日常发布不必手动跑 `wrangler deploy`。该集成的 Build/Deploy command 在 Dashboard 上配置，仓库内没有对应配置文件，无法从代码核实。

本地调试：

```bash
npm ci
npm run build
npx wrangler dev --port 8787
```

## D1

```bash
npx wrangler d1 create film-sort
npx wrangler d1 migrations apply film-sort --local
npx wrangler d1 migrations apply film-sort --remote
```

`wrangler.jsonc` 的 `d1_databases` binding 保持 `DB`。`migrations/` 下现有 23 个迁移文件（编号 0001–0022，其中 0008 有两支），覆盖：匿名事件 + 挑战片单、旧版画像表、API 日志 + 管理会话/配置、账户体系（user_accounts/sessions/oauth/exchanges）、画像 v2 + 批注、云端清单（0021 重建为 1000 件上限）、分享短链、广场（帖子/点赞/留言/楼中楼/编辑历史/性能索引）、海报错误日志、Cookie 保险库、管理审计、海报地址侧表（0022）。

清理策略：Worker cron（每周一 03:00 UTC）自动清理 90 天前 `analytics_events`/`api_logs`、180 天前 `poster_errors`、过期的 `admin_sessions`/`user_sessions`/`oauth_exchanges`/`shared_links`。也可在 `/admin` 数据页签手动清理。

## 密钥（wrangler secret，勿写入仓库/前端）

| Secret | 用途 | 不配置时 |
|---|---|---|
| `ADMIN_PASSWORD` | `/admin` 登录（优先于 DB hash） | 用首次登录写入的 DB hash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | 隐藏该登录入口 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth | 隐藏该登录入口 |
| `AI_API_KEY` | 内置 AI 通道密钥（`worker/ai.ts`）；`AI_API_URL`/`AI_MODEL`/`AI_PROTOCOL` 是 **vars**（见 `wrangler.jsonc`），不是 secret | 未配 key 时用户仍可在网页端自带 API | AI 按钮提示「服务端未配置」，用户自带 API 通道不受影响 |
| `COOKIE_ENC_KEY` | 覆盖 Cookie 保险库密钥（64 位十六进制 = AES-256）；**生产建议配置 secret**，避免密钥与密文同落 D1 | 首次使用时自动生成并存入 `admin_config('cookie_enc_key')`（仅适合开发/过渡） |
| `MUSIC_PROXY_URL` / `MUSIC_PROXY_KEY` | 音乐上游代理（`worker/gdstudio.ts`） | 直连上游 API |
| `ANYSEARCH_API_KEY` | anysearch 搜索服务 key（`api.anysearch.com`，简介的百度百科传输）；缺省走匿名额度（限速更低） | 仍可用，但匿名额度按 CF 出口 IP 共享计，高峰可能命中限速 |

生产环境应配置 `COOKIE_ENC_KEY` wrangler secret，使密钥与 `user_cookie_vault` 密文分离；未配置时首次使用会自动生成 AES-256 密钥存入 `admin_config('cookie_enc_key')`（密钥与密文同库，仅作过渡）。网易云/豆瓣授权 Cookie 以 AES-GCM 加密（不落明文，断开即删）。

## 账号体系（现行）

邮箱密码（PBKDF2-SHA256 10 万次迭代——workd 平台上限，见 worker/account.ts；存量无盐 SHA-256 登录时透明升级）+ Google/GitHub OAuth（state 存 HttpOnly Cookie 防 CSRF；回调换取一次性 `oauth_exchanges` code，前端 `POST /api/account/oauth/exchange` 换 token，**会话 token 不进 URL**）。30 天会话存 `user_sessions`。画像与云端清单各 ≤512KB；登录态下画像防抖自动云同步，切后台/断网/关页用 `keepalive` 补发；同步失败不覆盖本地。

> 旧版 Cloudflare Access JWT 账号同步方案（`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`）已废弃，Env 中仅存类型声明、无消费代码。

## API 概览

完整清单见 [API.md](./API.md)。分组：

- **豆瓣数据**：`/api/douban/{top250,books/top250,music/top250,suggest,books/suggest}`、`/api/{movie,book,music}/{list,detail}`（详情豆瓣官方简介优先→维基消歧打分→百度百科）、`/api/other/{list,detail}`（其他类别维基）、`/api/artwork/detail`、`/api/posters`、`/api/posters/batch`、`/api/image`、`POST /api/poster-errors/client`
- **导入**：`/api/import/{doulist,douban-list,netease,netease/mine}`（登录 + 8 次/10 分钟）
- **连接**：`/api/netease/*`、`/api/douban/*`（扫码/Cookie/status/disconnect/user-playlists 按 UID 浏览全部歌单含收藏，登录 + 120/10 分钟）
- **广场**：`/api/plaza/posts*`、`/api/comments/:id`
- **账号**：`/api/account/*`
- **分享/挑战**：`POST /api/share`、`GET /api/share/:code`、`/api/challenges*`
- **其他**：`/api/health`、`/api/stats`、`POST /api/events`、`/api/insights`、`/api/music/{play,lyric}`、`/admin` + `/api/admin/*`

图片代理白名单 host 见 `ARCHITECTURE.md` §6.3（`worker/media.ts` 的 `allowedImage()` 是唯一实现）。

## 限流与安全

- **两级限流**（`worker/index.ts` 的 `allowUpstreamRequest`）：先过 isolate 级窗口（键 `bucket:ip`，`RATE_WINDOW_MS` = 10 分钟，上界 5000 条 + 惰性清扫，见 `worker/rateWindow.ts`），再过 Edge Cache 计数（键 `https://rate-limit.art-rank.internal/<bucket>/<ip>`，`max-age=600`），后者让预算跨 isolate 可见。配额按 bucket：auth 30 / ai 8 / music_play 12 / music_lyric 12 / import 8 / netease 120 / douban 120 / other 20 / events 120 / posters 60 / share 30 / challenge 30。
- 安全头：CSP（img 白名单、script 含 cloudflareinsights 与 beacon hash）、`X-Frame-Options: DENY`、`frame-ancestors 'none'`、COOP、nosniff、referrer、permissions-policy。
- 写接口同源校验（`assertSameOrigin`）；`POST /api/events` 事件名 + payload 键双白名单，不落 IP/标题/自由文本。
- 边缘缓存：`fetch` 包装层只对 `GET /api/douban/top250`、`/api/douban/suggest`、`/api/posters`、`/api/image` 做 `caches.default` 读写（响应自带 TTL：top250 `max-age=900`、suggest `max-age=3600`、posters `86400`/空结果 `300`、image `86400`）；详情与列表接口通过响应头 `max-age=86400`/`3600` 交给 CDN；账号/广场/事件 `no-store`。服务端海报另有两级缓存与 D1 `poster_urls` 侧表，见 `ARCHITECTURE.md` §5.3。

## 上游限流应对

豆瓣/网易云/维基都可能返回验证页、超时或风控（如网易云扫码 8821/-462）。Worker 统一转 502/空结果并带冷却（douban 域 403/418 → 5–15s 域名冷却 + 800ms 最小间隔节流）；扫码被拒时前端有「粘贴 Cookie 连接」兜底。内置榜单、自定义导入、排序、比较、导出均不依赖外部服务，可完全离线使用。
