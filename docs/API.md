# API 接口参考

ART/RANK 后端 API 完整参考。所有接口由 Cloudflare Worker 处理，路径前缀 `/api`。

---

## 通用说明

- **基础 URL**：`https://your-domain.com/api`
- **响应格式**：JSON（`Content-Type: application/json; charset=utf-8`）
- **认证方式**：Bearer Token（`Authorization: Bearer <token>`）
- **请求限制**：请求体最大 48 KB
- **错误格式**：`{ "error": "error_code", "msg": "人类可读信息" }`

### HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 202 | 已接受（异步处理） |
| 302 | 重定向（OAuth） |
| 400 | 请求参数错误 |
| 401 | 需要认证 |
| 403 | 权限不足或跨域拒绝 |
| 404 | 资源不存在 |
| 405 | 方法不允许 |
| 409 | 资源冲突（如邮箱已注册） |
| 413 | 请求体过大 |
| 415 | 不支持的 Content-Type |
| 502 | 上游请求失败 |
| 503 | 服务不可用 |

---

## 健康检查

### GET /api/health

检查 Worker 和 D1 状态。

**响应：**
```json
{
  "ok": true,
  "storage": "d1"
}
```

---

## 统计

### GET /api/stats

获取公开统计数据。

**缓存**：`public, max-age=60`

**响应：**
```json
{
  "available": true,
  "completed_total": 1234,
  "completed_today": 56,
  "average_comparisons": 42.5
}
```

---

## 分析事件

### POST /api/events

记录匿名分析事件。

**请求体：**
```json
{
  "event_name": "ranking_completed",
  "session_id": "random-session-id-16chars",
  "payload": {
    "lang": "zh",
    "mode": "film",
    "item_count": 10,
    "top_k": 5,
    "comparison_count": 28
  }
}
```

**允许的事件名：**
`visit`, `list_opened`, `list_selected`, `sorting_started`, `comparison_made`, `ranking_completed`, `poster_downloaded`, `share_copied`, `result_viewed`, `qr_viewed`, `home_content_rendered`, `experiment_exposed`, `heavy_config_viewed`, `default_start_clicked`, `sorting_scope_reduced`, `result_share_prompt_clicked`

**允许的 payload 字段：**
- 字符串：`app_version`, `challenge_id`, `experiment_id`, `lang`, `list_id`, `mode`, `source`, `template_id`, `utm_campaign`, `utm_medium`, `utm_source`, `variant_id`
- 数字：`comparison_count`, `item_count`, `top_k`

**响应：** `202`
```json
{ "accepted": true, "stored": true }
```

---

## 海报

### GET /api/posters

获取作品的海报/封面 URL。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 作品标题 |
| en | string | 否 | 英文名（默认同 q） |
| type | string | 否 | `movie` / `book` / `music`（默认 movie） |
| year | number | 否 | 年份 |

**响应：**
```json
{
  "poster_urls": [
    "https://img9.doubanio.com/view/photo/s_ratio_poster/public/xxx.webp",
    "https://img2.doubanio.com/view/photo/s_ratio_poster/public/xxx.webp"
  ]
}
```

返回多个 CDN 镜像 URL，前端按顺序尝试加载。

**各类型获取策略：**

| 类型 | 来源1 | 来源2 | 来源3 | 来源4 |
|------|-------|-------|-------|-------|
| movie | suggest API | search.douban.com | Top250 索引 | IMDb |
| book | suggest API | search.douban.com | Top250 索引 | — |
| music | search.douban.com | Top250 索引 | — | — |

### POST /api/poster-errors/client

浏览器端海报加载失败上报。

**请求体：**
```json
{
  "title": "龙猫",
  "type": "film",
  "error": "image_load_failed"
}
```

**响应：** `202`
```json
{ "stored": true }
```

---

## 图片代理

### GET /api/image

代理访问允许域名的图片，避免浏览器跨域和 Referer 限制。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 图片 URL |

**允许的 host：**
- `img1/2/3/9.doubanio.com`
- `m.media-amazon.com`
- `ia.media-imdb.com`
- `image.tmdb.org`

**响应：** 图片二进制流，`Cache-Control: public, max-age=86400`

---

## 豆瓣 Top250

### GET /api/douban/top250

获取电影 Top250 榜单。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | number | 否 | 返回数量，2-250，默认 50 |

**响应：**
```json
{
  "source": "douban",
  "total": 50,
  "works": [
    {
      "id": "douban-1291560",
      "title": "龙猫",
      "year": 1988,
      "poster_url": "https://img9.doubanio.com/..."
    }
  ]
}
```

### GET /api/douban/books/top250

获取书籍 Top250 榜单。参数同上。

### GET /api/douban/music/top250

获取音乐 Top250 榜单。参数同上。

---

## 豆瓣 Suggest

### GET /api/douban/suggest

电影搜索建议。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |

**响应：**
```json
{
  "works": [
    {
      "id": "douban-1291560",
      "title": "龙猫",
      "year": 1988,
      "poster_url": "https://img9.doubanio.com/..."
    }
  ]
}
```

### GET /api/douban/books/suggest

书籍搜索建议。参数同上。返回 `pic` 字段作为封面。

---

## 搜索列表

### GET /api/movie/list

影视搜索。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词 |
| page | number | 否 | 页码，默认 1，每页 15 条 |

**响应：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "1.069s",
  "data": [
    {
      "cover_link": "https://movie.douban.com/subject/1291560/",
      "cover": "https://img9.doubanio.com/...",
      "rating": "9.2",
      "title": "龙猫",
      "year": "1988",
      "country": "日本",
      "type": ["动画", "奇幻", "冒险"],
      "duration": "86分钟",
      "actors": ["宫崎骏", "日高范子"]
    }
  ]
}
```

### GET /api/book/list

书籍搜索。参数同上。

**响应 data 字段：**
```json
{
  "cover_link": "...",
  "cover": "...",
  "rating": "9.4",
  "title": "活着",
  "author": "余华",
  "press": "作家出版社",
  "date": "2012-8",
  "price": "28.00元"
}
```

### GET /api/music/list

音乐搜索。参数同上。

**响应 data 字段：**
```json
{
  "cover_link": "...",
  "cover": "...",
  "rating": "9.5",
  "title": "范特西",
  "subtitle": "Fantasy",
  "artist": "周杰伦",
  "date": "2001-09-14",
  "album": "专辑",
  "medium": "CD",
  "schools": "流行"
}
```

---

## 作品详情

### GET /api/movie/detail

影视详情。优先通过 Wikipedia 获取简介。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 电影标题 |

**响应：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "1.2s",
  "data": {
    "title": "龙猫 となりのトトロ",
    "pic": "https://img9.doubanio.com/...",
    "rating": "9.2",
    "类型": "动画/奇幻/冒险",
    "制片国家/地区": "日本",
    "片长": "86分钟",
    "content_intro": "My Neighbor Totoro is a 1988 Japanese animated fantasy film...",
    "content_source": "enwiki"
  }
}
```

**content_source 取值：** `zhwiki` / `enwiki` / `baike`

### GET /api/book/detail

书籍详情。参数和响应格式同上，额外字段：`作者`, `出版社`, `出版年`, `页数`, `定价`, `ISBN`, `tags`。

### GET /api/music/detail

音乐详情。参数和响应格式同上，额外字段：`表演者`, `流派`, `专辑类型`, `介质`, `发行时间`, `songs`。

---

## 音乐试听

### GET /api/music/play

搜索音乐试听链接。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |

**响应：**
```json
{
  "playUrl": "https://..."
}
```

---

## AI 解读

### POST /api/insights

生成画像比较解读。需要配置 `AI_API_KEY`。

**请求体：**
```json
{
  "summary": "film: mine=龙猫, 千与千寻; theirs=霸王别姬, 花样年华\nbook: ..."
}
```

**响应：**
```json
{
  "insight": "你们在电影品味上有显著重合..."
}
```

**限流：** 每 IP 10 分钟内限制调用次数。

---

## 用户认证

### POST /api/account/register

注册新用户。

**请求体：**
```json
{
  "email": "user@example.com",
  "password": "secure123",
  "nickname": "影迷小王"
}
```

**响应：** `200`
```json
{
  "token": "hex-token-64chars",
  "expires": "2025-02-15T...",
  "email": "user@example.com",
  "nickname": "影迷小王"
}
```

**错误：**
- `400` — `invalid_email` / `invalid_password` / `invalid_nickname`
- `409` — `email_exists`

### POST /api/account/login

用户登录。

**请求体：**
```json
{
  "email": "user@example.com",
  "password": "secure123"
}
```

**响应：** 同注册。

**错误：**
- `401` — `invalid_credentials`
- `403` — `account_disabled`

### POST /api/account/logout

退出登录。需 Bearer Token。

### GET /api/account/providers

列出可用的 OAuth 提供商。

**响应：**
```json
{
  "providers": [
    { "id": "google", "name": "Google" },
    { "id": "github", "name": "GitHub" }
  ]
}
```

### GET /api/account/oauth/:provider

发起 OAuth 流程。重定向到提供商授权页面。

支持的 provider：`google`, `github`

### GET /api/account/oauth/callback

OAuth 回调。自动创建或关联用户，重定向到前端带 token。

---

## 用户画像

### GET /api/account/profile

获取当前用户的画像。

**响应：**
```json
{
  "email": "user@example.com",
  "nickname": "影迷小王",
  "profile": { "version": 2, "profileId": "...", ... },
  "updatedAt": "2025-01-15T..."
}
```

### PUT /api/account/profile

保存画像。请求体为完整的 profile JSON 对象，最大 512 KB。

**响应：**
```json
{ "stored": true }
```

### PUT /api/account/nickname

修改昵称。

**请求体：**
```json
{ "nickname": "新昵称" }
```

---

## 云端清单

### GET /api/account/collections

获取当前用户的所有云端清单。

**响应：**
```json
{
  "collections": [
    {
      "id": 1,
      "kind": "film",
      "title": "我的电影清单",
      "description": "",
      "item_count": 10,
      "items": [...],
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### POST /api/account/collections

保存新的云端清单。

**请求体：**
```json
{
  "kind": "film",
  "title": "我的电影清单",
  "description": "",
  "items": [
    { "title": "龙猫", "year": 1988 },
    { "title": "千与千寻", "year": 2001 }
  ]
}
```

**限制：** 2-300 件作品，总大小 512 KB。

### DELETE /api/account/collections/:id

删除指定的云端清单。

---

## 管理接口

所有管理接口需要 Bearer Token（通过 `/api/admin/login` 获取）。

### POST /api/admin/login

管理员登录。

**请求体：**
```json
{ "password": "admin-password" }
```

**响应：**
```json
{
  "token": "hex-token-64chars",
  "expires": "2025-01-22T..."
}
```

### GET /api/admin/dashboard

获取仪表盘数据，包含：概览统计、14天趋势、媒介分布、最近事件、API 日志、API 错误、用户列表、存储统计、海报错误。

### GET /api/admin/accounts

获取用户列表（最近 50 个）。

### DELETE /api/admin/accounts/:id

删除用户及其所有数据（会话、OAuth、画像、清单）。

### POST /api/admin/accounts/:id/disable

禁用用户账户并结束其所有会话。

### POST /api/admin/accounts/:id/restore

恢复被禁用的用户账户。

### DELETE /api/admin/accounts/:id/profile

删除用户画像。

### DELETE /api/admin/accounts/:id/collections

删除用户所有云端清单。

### POST /api/admin/accounts/:id/reset-password

重置用户密码并使其所有会话失效。

### GET /api/admin/poster-errors

查询海报错误记录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| days | number | 否 | 查询天数，默认 7 |
| limit | number | 否 | 返回数量，默认 200，最大 1000 |

### GET /api/admin/poster-errors/export

导出海报错误为 CSV 文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| days | number | 否 | 查询天数，默认 30 |
| token | string | 是 | 管理员 token（URL 参数） |

### POST /api/admin/logs/clean

清理日志。

**请求体：**
```json
{
  "table": "all",
  "action": "delete_7d"
}
```

**table 取值：** `all` / `api_logs` / `analytics_events` / `poster_errors`

**action 取值：** `delete_all` / `delete_7d` / `keep_24h` / `delete_24h` / `keep_1h` / `delete_1h`
