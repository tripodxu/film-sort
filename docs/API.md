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

影视详情。简介来源优先级：**豆瓣官方详情页 v:summary（零歧义）→ 维基百科（限定标题 + 消歧打分择优）→ 百度百科**。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name / title | string | 是* | 电影标题（与 url 二选一） |
| url | string | 否 | 豆瓣 subject 链接，精确定位条目 |
| year | string | 否 | 年份，用于构造维基限定标题（如「泰坦尼克号 (1997年电影)」）消歧 |
| creator | string | 否 | 导演/主演，用于在豆瓣搜索多结果中挑选最匹配条目 |

**响应：**
```json
{
  "status": true,
  "msg": "ok",
  "time": "0s",
  "data": {
    "title": "龙猫 となりのトトロ",
    "pic": "https://img9.doubanio.com/...",
    "rating": "9.2",
    "year": "1988",
    "类型": "动画/奇幻/冒险",
    "制片国家/地区": "日本",
    "片长": "86分钟",
    "content_intro": "《龙猫》（日語：となりのトトロ）是一部由吉卜力工作室…",
    "content_source": "douban"
  }
}
```

**content_source 取值：** `douban`（豆瓣官方简介，优先） / `zhwiki` / `enwiki` / `baike`

**消歧机制**（`worker/media.ts fetchContentIntro`）：并行发起「限定标题精确查询（中/英）+ 裸标题查询 + 搜索」多路，候选按「首句类型声明一致 +3 / 类型词 +2 / 年份 +2 / 标题相关 +1 / 限定命中 +6，消歧义页 -1 剔除」打分取最优。

### GET /api/book/detail

书籍详情。参数和响应格式同上，额外字段：`作者`, `出版社`, `出版年`, `页数`, `定价`, `ISBN`, `tags`, `author_intro`。

### GET /api/music/detail

音乐详情。参数和响应格式同上，额外字段：`表演者`, `流派`, `专辑类型`, `介质`, `发行时间`, `songs`。

### GET /api/other/list

「其他」类别搜索（游戏/艺术/建筑等非影书音作品），走维基百科。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 关键词（≤80 字符），先 opensearch 取候选标题再批量取摘要+图片 |

**响应：** `{ "status": true, "data": [{ "id": "wiki-zh-…", "title": "纪念碑谷 (游戏)", "subtitle": "解谜游戏", "year": 2014, "poster_url": "https://upload.wikimedia.org/…", "content_intro": "…", "content_source": "zhwiki" }] }`

中文落空自动降级英文维基。IP 限流 20 次/10 分钟。

### GET /api/other/detail

「其他」类别详情。参数 `name`（≤120 字符）。中文精确标题直查 → 英文 → 百度百科 abstract 兜底。

### GET /api/artwork/detail

统一作品详情入口。`kind` ∈ `film|book|music|other`，`q` 为标题。film/book/music 走豆瓣 subject 详情；other 走维基。

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

## 广场

### GET /api/plaza/posts

获取广场帖子列表（公开，无需登录）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| limit | number | 否 | 每页数量，默认 20，最大 50 |
| kind | string | 否 | 按媒介筛选：`film` / `book` / `music` / `other` |

**响应：**
```json
{
  "posts": [
    {
      "id": 1,
      "user_id": 5,
      "post_type": "ranking",
      "kind": "film",
      "collection_title": "我的华语电影 Top 10",
      "items": [...],
      "notes": null,
      "item_count": 10,
      "like_count": 24,
      "comment_count": 5,
      "is_public": 1,
      "created_at": "2025-01-15T...",
      "updated_at": "2025-01-15T...",
      "nickname": "影迷小王"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 156
}
```

### GET /api/plaza/posts/:id

获取单个帖子详情，包含留言列表。

**响应：**
```json
{
  "post": {
    "id": 1,
    "user_id": 5,
    "post_type": "ranking",
    "kind": "film",
    "collection_title": "我的华语电影 Top 10",
    "items": [
      { "id": "...", "title": "花样年华", "rank": 1, "creator": "王家卫", "year": 2000 }
    ],
    "notes": "{\"work:film:xxx\":\"这是一部...\"}",
    "item_count": 10,
    "like_count": 24,
    "comment_count": 5,
    "is_public": 1,
    "created_at": "2025-01-15T...",
    "nickname": "影迷小王"
  },
  "comments": [
    {
      "id": 1,
      "post_id": 1,
      "user_id": 8,
      "content": "很棒的榜单！",
      "created_at": "2025-01-16T...",
      "nickname": "书虫小李"
    }
  ]
}
```

### POST /api/plaza/posts

发布帖子到广场。需 Bearer Token。

**请求体：**
```json
{
  "post_type": "ranking",
  "kind": "film",
  "collection_title": "我的华语电影 Top 10",
  "items": [
    { "id": "...", "title": "花样年华", "rank": 1, "creator": "王家卫", "year": 2000 }
  ],
  "notes": "{\"work:film:xxx\":\"这是一部...\"}",
  "is_public": true
}
```

**约束：** `post_type` 必填（`ranking` 或 `profile`），`items` 不能为空数组，`collection_title` 最长 200 字符，`notes` 最长 2000 字符。

**响应：** `201`
```json
{ "id": 42, "stored": true }
```

### PUT /api/plaza/posts/:id

编辑自己的帖子。需 Bearer Token + 帖子所有权。

**请求体：** 同 POST，所有字段可选（未传则保留原值）。支持修改标题、描述、批注和排序（通过 `items` 传入新顺序）。

**响应：**
```json
{ "ok": true }
```

**错误：**
- `401` — `authentication_required`
- `403` — `forbidden`（非帖子作者）
- `404` — `post_not_found`

### DELETE /api/plaza/posts/:id

删除自己的帖子（同时删除关联的点赞和留言）。需 Bearer Token + 帖子所有权。

**响应：**
```json
{ "ok": true }
```

### POST /api/plaza/posts/:id/like

点赞或取消点赞（toggle 机制）。需 Bearer Token。

- 如未点赞 → 点赞，返回 `{ "liked": true }`
- 如已点赞 → 取消点赞，返回 `{ "liked": false }`

**响应：**
```json
{ "liked": true }
```

### GET /api/plaza/posts/:id/comments

获取帖子的留言列表（按时间正序，最多 100 条）。

**响应：**
```json
{
  "comments": [
    {
      "id": 1,
      "post_id": 1,
      "user_id": 8,
      "content": "很棒的榜单！",
      "created_at": "2025-01-16T...",
      "nickname": "书虫小李"
    }
  ]
}
```

### POST /api/plaza/posts/:id/comments

发表留言。需 Bearer Token。

**请求体：**
```json
{ "content": "很棒的榜单！" }
```

**约束：** 内容最长 500 字符，不能为空，不能包含控制字符。

**响应：** `201`
```json
{ "id": 5, "stored": true }
```

### DELETE /api/comments/:id

删除自己的留言（同时更新帖子的 comment_count）。需 Bearer Token + 留言所有权。

**响应：**
```json
{ "ok": true }
```

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

---

## 补充端点（2026-09 功能簇）

### PUT /api/plaza/posts/:id（编辑扩展）

除标题/描述/批注/排序外，请求体可带 `edits` 数组记录本次操作明细（服务端写入 `plaza_post_edits`，含时间戳）：

```json
{ "description": "改一下", "items": [ ... ], "item_count": 10,
  "edits": [{ "action": "reorder", "detail": "把《X》移到第 2 位" }] }
```

`action` ∈ `reorder|add|remove|sync|meta|hide|restore`（≤40 字符），`detail` ≤300。最多 50 条/次。仅作者；未提供字段用 COALESCE 保留原值。

### GET /api/plaza/posts/:id/edits

获取帖子编辑历史（**仅作者**，≤200 条，倒序）。返回 `{ "edits": [{ "id", "action", "detail", "created_at" }] }`。

### POST /api/plaza/posts/:id/visibility

作者隐藏/恢复自己的帖子。请求体 `{ "is_public": false }`。隐藏后仅作者自己在列表/详情可见，并写入一条 `hide`/`restore` 编辑历史。

### DELETE /api/plaza/posts/:id（删除扩展）

作者删帖时以 batch 原子清理 `plaza_post_edits` → `plaza_comments` → `plaza_likes` → `plaza_posts`（编辑历史有外键，必须先删）。

---

## 分享短链

### POST /api/share

创建分享短链。需同源。请求体：`{ "profile": <ArtisticProfile>, "notes"?: {...}, "expires_days"?: 7|30|90|365 }`（默认 30 天，profile ≤512KB）。

**响应：** `{ "code": "ab12CD34", "url": "https://…/share/ab12CD34", "compareUrl": "…", "expires_at": "…" }`

### GET /api/share/:code

读取分享内容（公开，无需登录）。过期返回 404。响应：`{ "profile", "notes", "expires_at" }`。

> cron 每周一清理过期短链。

---

## 外部数据导入（均需 Bearer Token + IP 限流 8 次/10 分钟）

> **分批导入**：`/api/import/doulist`、`/api/import/douban-list`、`/api/import/netease` 均支持 `offset`（起点，默认 0）与 `limit`（本批条数，默认 300，上限 300）窗口参数，响应额外返回 `listTotal`（清单全量，未知为 null）、`hasMore`、`nextOffset`（下一批绝对游标，去重/解析失败不漂移）。前端导入引擎按游标循环拉取，单批 300 条、最多 20 批，配合右上角「设置」的**单次导入上限**（100/300/500/1000，localStorage `art-rank:import-cap`，默认 300）与进度条；超过上限时再次点击导入可从 `nextOffset` 续抓。画像/云端清单条目上限 1000。

### GET /api/import/doulist?url=

导入豆瓣豆列（`douban.com/doulist/<id>`）。新旧版式双解析，按标签行提取创作者。已连接豆瓣时携带 Cookie（私有豆列可抓）。

### GET /api/import/douban-list?url=

**统一豆瓣导入入口**，自动识别三类链接：
- `doulist/<id>` → 豆列
- `m.douban.com/subject_collection/<ID>` → 豆瓣书影音清单（rexxar JSON，公开无需登录）
- `{movie|book}.douban.com/mine?status=wish|collect|doing` → 我的想看/已看/在观（需已连接豆瓣，否则提示先连接）。HTML 解析 2026 版结构（电影 `div.item.comment-item` / 书籍 `li.subject-item`），分页参数 `start`。详见 DOUBAN_API.md。

**响应：** `{ "works": [ImportedWork…], "total", "listTotal", "hasMore", "nextOffset", "kind": "subject_collection|mine|doulist" }`

### GET /api/import/netease?url=

导入网易云歌单（`playlist?id=` 或纯 ID，公开接口）。已连接时带 Cookie 可导入私有歌单。

> **上游接口（2026-09 起）**：旧 `api/playlist/detail` 已要求登录（匿名返回 `code 20001`），改用分层链。Cloudflare 海外出口常被网易云匿名风控（开放接口静默返回空、weapi 单发可通但连发限流），故每层带退避重试与分片节流：
> 1. `GET music.163.com/api/v6/playlist/detail?id=&n=1000&s=0` → `playlist.trackIds` 全量曲目 ID（v6 的 `tracks` 仅带前 ~10 首）
> 2. 空则降级 `POST music.163.com/weapi/v6/playlist/detail/`（AES-CBC+RSA 加密，重试 2 次、间隔 900ms）
> 3. 曲目批量：`POST music.163.com/api/v3/song/detail`（表单 `c=[{"id":1},…]`，每片 ≤300 个），空则降级 `weapi/v3/song/detail/`；分片间 700ms 节流
>
> 全部失败时回退 detail 自带的前几首 `tracks`。带连接 Cookie 时私有歌单也可导入。测试用例：`5204302550`（我喜欢的音乐，9 首）、`66873341`（收藏的英文老歌，129 首）。

### GET /api/import/netease/mine

我的网易云歌单列表（需已扫码/Cookie 连接）。同样走 `neteaseUserPlaylists`（分层降级 + 收藏识别）。返回 `{ "playlists": [{ id, name, track_count, cover, special, subscribed }], "blocked", "uid" }`（special=我喜欢的音乐，subscribed=收藏的他人歌单；uid 供前端预填「按 UID 浏览」框）。

### GET /api/netease/user-playlists?uid=

按用户 ID 浏览**任意用户**的全部歌单（含其收藏的）。分层策略：
1. 开放接口 `api/user/playlist?uid=&limit=1000`（本机/住宅 IP 匿名可用；已连接时带 Cookie）
2. 空结果自动降级 weapi `/weapi/user/playlist/`
3. 两层都拿不到 → `{ playlists: [], blocked: true, msg: "…连接账号后重试" }`（网易云常对 Cloudflare 数据中心出口做匿名限制）

返回 `{ "playlists": [{ id, name, track_count, cover, special, subscribed }], "total", "blocked" }`。收藏歌单识别：匿名响应 `subscribed` 恒为 null，按 `creator.userId ≠ 被查 uid` 判定。`uid` 须为 1–13 位纯数字，否则 400。前端入口：「音乐 → 我的清单 → 输入用户 ID/主页链接 → 浏览全部歌单 → 点选导入」。

---

## 网易云连接（需登录，IP 限流 120 次/10 分钟）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/netease/qr/issue` | 签发扫码二维码。开放接口优先、weapi 兜底。返回 `{ unikey, qr_value, ttl }`（ttl 秒） |
| GET | `/api/netease/qr/poll?unikey=` | 轮询状态 `{ state: waiting\|scanned\|confirmed\|expired\|risk, error?, nickname?, avatarUrl? }`。803 成功时从 Set-Cookie 提取 MUSIC_U(+__csrf) 加密入库；风控码返回 risk 由前端连续容忍 |
| GET | `/api/netease/status` | `{ connected, account: { nickname, avatarUrl } \| null }`（10 分钟内存缓存） |
| POST | `/api/netease/cookie` | 粘贴 Cookie 连接。体 `{ cookie }`（含 MUSIC_U 或纯值），校验真实可用后入库 |
| POST | `/api/netease/disconnect` | 断开并删除加密 Cookie |

## 豆瓣连接（需登录，IP 限流 120 次/10 分钟）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/douban/qr/issue` | 签发二维码。`accounts.douban.com/j/mobile/login/qrlogin_code`，服务端代理下载二维码图转 data URL。返回 `{ code, qr_image, ttl }` |
| GET | `/api/douban/qr/poll?code=` | 轮询 `qrlogin_status`，`login_status` pending→scan→login→expired；login 时从 Cookie 罐提取 `dbcl2`(+ck) 入库 |
| GET | `/api/douban/status` | `{ connected, account: { nickname, avatarUrl } \| null }` |
| POST | `/api/douban/cookie` | 粘贴 Cookie 连接（体 `{ cookie }`，含 dbcl2），`/mine/` 重定向校验有效后入库 |
| POST | `/api/douban/disconnect` | 断开并删除 |

> Cookie 保险库：`user_cookie_vault(user_id, provider, data_encrypted)`，AES-GCM 加密，密钥首次使用自动生成存 `admin_config('cookie_enc_key')`。provider ∈ `netease|douban`。

---

## 管理接口补充

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/accounts/:id/detail` | 用户完整数据（画像/批注/清单/会话/OAuth/广场数） |
| GET | `/api/admin/plaza/posts` | 广场帖子管理列表（含隐藏、可筛选搜索、评论数校正） |
| GET | `/api/admin/plaza/posts/:id` | 帖子完整详情（含全部评论与作者邮箱） |
| POST | `/api/admin/plaza/posts/:id/visibility` | 管理员隐藏/恢复任意帖子 |
| DELETE | `/api/admin/plaza/comments/:id` | 管理员删评论（连删直接回复，按实际数修正计数） |
| POST | `/api/admin/reset` | 分级重置（analytics/plaza/shares/accounts 四档，需 confirm=RESET + 密码重验） |
| GET | `/api/admin/audit` | 审计日志列表 |
| POST | `/api/admin/change-password` | 修改管理密码 |
| POST | `/api/admin/sessions/revoke-all` | 强制所有管理会话下线 |
| POST | `/api/admin/links/clean-expired` | 立即清理过期短链 |
