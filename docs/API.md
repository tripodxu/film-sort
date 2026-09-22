# API 接口参考

ART/RANK 后端 API 完整参考。所有接口由 Cloudflare Worker 处理，路径前缀 `/api`。

---

## 通用说明

- **基础 URL**：`https://your-domain.com/api`
- **响应格式**：JSON（`Content-Type: application/json; charset=utf-8`）
- **认证方式**：Bearer Token（`Authorization: Bearer <token>`）
- **错误格式**：`{ "error": "<code>" }`。多数接口附带人类可读的 `msg`；由 `HttpError` 抛出的通用错误（`invalid_field`、`json_required`、`payload_too_large` 等）字段名是 `message`
- **同源检查**：`POST /api/events`、`POST /api/poster-errors/client`、`POST /api/share`、`POST /api/challenges`、`/api/account/*` 的非 GET 请求校验 `Origin`，跨域写入返回 `403 cross_origin_forbidden`；`OPTIONS /api/*` 一律返回 `405`（不做 CORS）
- **安全响应头**：所有 JSON 响应都带 CSP / COOP / `X-Frame-Options` / `nosniff` / `Referrer-Policy` / `Permissions-Policy`，见 `ARCHITECTURE.md` §6.1

### 请求体上限

| 范围 | 上限 | 说明 |
|------|------|------|
| 通用 JSON 接口 | 48 KB | `Content-Type` 必须是 `application/json`，否则 `415 json_required` |
| `POST /api/posters/batch` | 128 KB | 且 `items` 最多 300 条（超出部分直接丢弃） |
| `PUT /api/account/profile`、`POST`/`PUT /api/plaza/posts`、`POST /api/share` | 512 KB | 画像/榜单 JSON 的编码上限同为 512 KB |
| `POST /api/events` | payload ≤2 KB | 字段必须在白名单内，否则 `400` |

### 限流

按 `限流桶:客户端 IP` 计数，窗口 10 分钟，超出返回 `429 { "error": "rate_limited" }`。命中缓存、不会回源上游的请求不计数（例如重播同一首歌的 `/api/music/play`）。

| 桶 | 覆盖接口 | 额度 | `retry-after` |
|----|----------|------|---------------|
| `events` | `POST /api/events` | 120 | 60 |
| `other` | `POST /api/poster-errors/client` | 120 | 60 |
| `other` | `GET /api/other/list`、`GET /api/other/detail` | 20 | 60 |
| `auth` | `POST /api/admin/reset`、`/api/admin/change-password`、`/api/admin/sessions/revoke-all` | 30 | 300 |
| `posters` | `POST /api/posters/batch` | 60 | 600 |
| `ai` | `POST /api/insights`（内置通道） | 8 | 600 |
| `ai_custom` | `POST /api/insights`（自定义通道） | 15 | 600 |
| `ai_test` | `POST /api/ai/test` | 5 | 600 |
| `ai_models` | `POST /api/ai/models` | 10 | 600 |
| `music_play` | `GET /api/music/play` | 12 | 600 |
| `music_lyric` | `GET /api/music/lyric` | 12 | 600 |
| `netease` | `/api/netease/*` | 120 | 60 |
| `douban` | `/api/douban/qr/*`、`/api/douban/status`、`/api/douban/cookie`、`/api/douban/disconnect` | 120 | 60 |
| `import` | `/api/import/*` | 8 | 600 |
| `share` | `POST /api/share` | 30 | 60 |
| `challenge` | `POST /api/challenges` | 30 | 60 |

### HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 202 | 已接受（异步处理） |
| 302 | 重定向（OAuth） |
| 400 | 请求参数错误 |
| 401 | 需要认证 |
| 403 | 权限不足、账户被禁用或跨域拒绝 |
| 404 | 资源不存在 |
| 405 | 方法不允许 |
| 409 | 资源冲突（如邮箱已注册） |
| 413 | 请求体过大 |
| 415 | 不支持的 Content-Type |
| 429 | 触发限流（见上表 `retry-after`） |
| 500 | 未捕获异常（`internal_error`） |
| 502 | 上游请求失败 |
| 503 | 服务不可用 |

---

## 健康检查

### GET /api/health

检查 Worker 与 D1 状态（`Cache-Control: no-store`）。

**响应：**
```json
{
  "ok": true,
  "version": "2.0.0",
  "timestamp": "2026-09-01T00:00:00.000Z",
  "checks": { "storage": "d1", "database": "ok" }
}
```

未绑定 D1 时 `checks.storage` 为 `disabled` 且不带 `checks.database`；`SELECT 1` 失败时 `checks.database` 为 `error`。

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

`session_id` 必须是 16–64 位 `[A-Za-z0-9_-]` 匿名标识（如随机串），否则 `400 invalid_session_id`；`event_name` 不在白名单内返回 `400 event_not_allowed`。`payload` 必须是对象（否则 `400 invalid_payload`），出现白名单外的字段直接 `400 private_payload_field`（不会静默丢弃）；字符串字段 ≤100 字符，数字字段须为 0–10000 的整数，编码后的 payload ≤2 KB（超出 `413`）。

**响应：** `202`
```json
{ "accepted": true, "stored": true }
```

未绑定 D1 或写入失败时同样返回 `202`，体为 `{ "accepted": false, "stored": false, "reason": "analytics_unavailable" }`。

---

## 海报

### GET /api/posters

获取作品的海报/封面 URL（单条解析）。无独立限流；响应进入 Edge Cache。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 作品标题（≤160 字符） |
| en | string | 否 | 英文名，用于 IMDb/维基检索（≤160 字符，默认空串，不回落 q） |
| type | string | 否 | `movie` / `book` / `music`（默认 movie） |
| year | number | 否 | 年份，须为 1800–2200 的整数 |

**响应：**
```json
{
  "poster_urls": [
    "https://img9.doubanio.com/view/photo/l/public/xxx.webp",
    "https://img2.doubanio.com/view/photo/s_ratio_poster/public/xxx.webp"
  ]
}
```

豆瓣 URL 会展开为多组 CDN 镜像（去掉 `s_ratio_poster` 的 `/l/` 大图 + 原始地址 + `img1`/`img2`/`img3`/`img9` 主机），前端按数组顺序尝试加载。缓存：有结果 `max-age=86400`，无结果 `max-age=300`。

**各类型获取策略**（前几档并行发起、按下表顺序合并成候选数组；候选全空时按最后一列逐级降级）：

| 类型 | 来源1 | 来源2 | 来源3 | 来源4 | 兜底链 |
|------|-------|-------|-------|-------|--------|
| movie | 豆瓣 suggest（`img`） | search.douban.com | Top250 索引 | IMDb suggestion | 维基 → 网易云/gd-proxy |
| book | 豆瓣 suggest（`pic`） | search.douban.com | Top250 索引 | — | 维基 → 网易云/gd-proxy |
| music | 网易云 CDN 直出 | search.douban.com | Top250 索引 | — | 维基 |

单条与批量接口都会先读 `poster_urls` 持久化侧表（命中即零回源）；解析彻底无结果时记一条 `poster_errors`（`source=single`）。

### POST /api/posters/batch

批量解析海报（一次可提交整份榜单）。限流桶 `posters`（60 次/10 分钟）；请求体上限 **128 KB**，`items` 最多 **300** 条，超出部分丢弃，单条不合法只跳过该条。

**请求体：**
```json
{
  "items": [
    { "title": "龙猫", "english": "My Neighbor Totoro", "year": 1988, "type": "movie" },
    { "title": "范特西", "type": "music" }
  ],
  "retry": false
}
```

- `type` 缺省或非法时按 `movie` 处理；`title` 非法（空、>160 字符、含控制字符）的条目被丢弃
- `retry: true` 只绕过「被上游限流」的负缓存（15 秒），正缓存与「确实没有」的负缓存（24 小时）仍生效；前端在每次页面加载的首次批量带上它，使「刷新 = 真重试」是确定的

**响应：**
```json
{
  "results": {
    "movie|龙猫|my neighbor totoro|1988": ["https://img9.doubanio.com/..."]
  },
  "keys": ["movie|龙猫|my neighbor totoro|1988"]
}
```

`keys` 与清洗后的条目一一对应、按位置对齐（同请求内重复条目只解析一次）；`results` 以 `type|title|english|year`（NFKC、去空白、小写）为键。空 `items`（或全部被丢弃）直接返回 `{ "results": {}, "keys": [] }`。缓存 `private, max-age=86400`（真正的 1 天缓存在服务端 L1/L2）。

**与单条接口的差异：** 批量多了独立限流桶、128 KB/300 条上限、`retry` 开关和 `results`/`keys` 结构；上游失败会批量写 `poster_errors`（`source=batch`，每请求最多 10 条），单条接口则写 `source=single`。

### POST /api/poster-errors/client

浏览器端海报加载失败上报（同源 + `other` 桶 120 次/10 分钟）。

**请求体：**
```json
{
  "title": "龙猫",
  "type": "film",
  "error": "image_load_failed"
}
```

`title` / `error` 经 `cleanString` 校验（≤160 / ≤80 字符、非空、无控制字符，违规返回 `400 invalid_field`）；`type` 必须 ∈ `film` / `book` / `music` / `other`，否则 `400 invalid_type`（落库时 `film` 写为 `movie`）。

**响应：** `202`
```json
{ "stored": true }
```

未绑定 D1 时返回 `202 { "stored": false }`。

---

## 图片代理

### GET /api/image

代理访问允许域名的图片，避免浏览器跨域和 Referer 限制。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 图片 URL |

- **白名单主机**：见 `ARCHITECTURE.md` §6.3（`img\d+.doubanio.com`、`*.music.126.net`、`upload|thumb.wikimedia.org`、`bkimg.cdn.bcebos.com`、`m.media-amazon.com`、`ia.media-imdb.com`、`image.tmdb.org`）
- 只接受 http(s)、无用户名/密码、端口为空或 80/443 的 URL；`http://` 统一升级为 `https://` 后回源
- **Referer 规则**：豆瓣域名（`*.douban.com` / `*.doubanio.com`）按类型带 `book.douban.com` / `music.douban.com` / `movie.douban.com` Referer，其余主机只带 UA 与 `Accept`
- 上游返回的 `Content-Type` 必须是 `image/jpeg|png|webp|avif`（含 `image/jpg`）

**响应：** 图片二进制流，`Cache-Control: public, max-age=86400`；URL 非法或不在白名单 `400`，上游不是图片 `415`，上游请求失败 `502`。

---

## 豆瓣 Top250

### GET /api/douban/top250

获取电影 Top250 榜单（`Cache-Control: public, max-age=900`）。

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

`limit` 非 2–250 的整数 → `400 invalid_limit`；上游不可用 → `502 douban_unavailable`。

### GET /api/douban/books/top250

获取书籍 Top250 榜单。参数同上。

### GET /api/douban/music/top250

获取音乐 Top250 榜单。参数同上。

---

## 豆瓣 Suggest

### GET /api/douban/suggest

电影搜索建议（`Cache-Control: public, max-age=3600`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词（≤80 字符，否则 `400 invalid_query`） |

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

> 上游失败时两个 suggest 接口返回 `502 { "error": "douban_unavailable", "works": [] }`。

---

## 搜索列表

### GET /api/movie/list

影视搜索。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词（≤80 字符） |
| page | number | 否 | 页码，默认 1，每页 15 条，有效范围 1–100 |

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

书籍搜索。参数同上（`key` ≤80、`page` 1–100）。

> 三个列表接口参数非法时返回 `400 { "status": false, "msg": "...", "data": null }`；豆瓣限流或抓取失败时**仍返回 `200`**，体里 `status: false`、`data: []`、`msg` 说明原因。成功响应 `Cache-Control: public, max-age=3600`。

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
| url | string | 否 | 豆瓣 subject 链接，精确定位条目（取其中的 subject id 精确匹配搜索结果） |
| creator | string | 否 | 导演/主演，用于在豆瓣搜索多结果中挑选最匹配条目（命中标题+创作者 +4，标题前缀匹配 +1） |

> 客户端传入的 `year` 当前**不被该路由读取**；用于维基限定标题消歧的年份取自豆瓣搜索结果里的 `year`。缺 `name`/`title`/`url` 时返回 `400`。

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

**消歧机制**（`worker/media.ts fetchContentIntro`）：并行发起「限定标题精确查询（中/英）+ 裸标题查询 + 搜索」多路，候选按打分取最优；搜索候选必须真的提到作品名（榜单/合集页即使通篇像音乐/电影词条也拒绝——宁缺毋滥）；百度百科经三级传输探测（开放 API → 词条页 meta → anysearch 搜索摘要），结果有 isolate 级 24h 缓存。完整评分规则见 `ARCHITECTURE.md` §5.4。

### GET /api/book/detail

书籍详情。参数和响应格式同上（额外支持 `creator`，在搜索多结果中按标题+作者择优；简介解析器读书籍详情页的 `div.intro`），额外字段：`作者`, `出版社`, `出版年`, `页数`, `定价`, `装帧`, `ISBN`, `dirs`, `tags`, `author_intro`。

### GET /api/music/detail

音乐详情。参数 `name`（≤120 字符，必填）、`creator`、`year`。歌曲导向（不查豆瓣）：

1. **gdstudio 搜索**（Step 1）：按歌名+歌手匹配单曲，返回 `matchedTitle` / `artist` / `album`；
2. **简介**（Step 2，`fetchContentIntro`）：**中文歌名优先百度百科**（对华语流行单曲覆盖远好于维基），未命中回落维基消歧打分，最后再试百科兜底。

| 字段 | 说明 |
|------|------|
| matchedTitle / artist / album | gdstudio 匹配到的曲目元数据（可能缺省） |
| content_intro / content_source | 同上；中文歌名命中百科时 `content_source=baike` |

> 三个详情路由的成功响应 `Cache-Control: public, max-age=86400`，未找到返回 `404`（`max-age=60`），缺 `name`/`title`/`url` 返回 `400`。

### GET /api/other/list

「其他」类别搜索（游戏/艺术/建筑等非影书音作品），走维基百科。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 关键词（≤80 字符），先 opensearch 取候选标题再批量取摘要+图片 |

**响应：** `{ "status": true, "data": [{ "id": "wiki-zh-…", "title": "纪念碑谷 (游戏)", "subtitle": "解谜游戏", "year": 2014, "poster_url": "https://upload.wikimedia.org/…", "content_intro": "…", "content_source": "zhwiki" }] }`

中文落空自动降级英文维基。限流桶 `other`（20 次/10 分钟）。空 `key` 或 >80 字符返回 `400 invalid_key`，上游失败 `502 wiki_unavailable`。

### GET /api/other/detail

「其他」类别详情。参数 `name`（或兼容 `title`，≤120 字符）。中文精确标题直查 → 英文 → 百度百科 abstract 兜底。限流桶 `other`（20 次/10 分钟）。

### GET /api/artwork/detail

统一作品详情入口（前端已不再调用）。`kind` ∈ `film|book|music|other`，`q` 为标题（≤120 字符）。`other` 走维基详情（失败为 `502 wiki_unavailable`）；其余先搜索取 subject 链接，再调用对应类型的豆瓣详情（film → `doubanMovieDetail`），失败为 `502 douban_unavailable`。响应为对应详情体并附加 `source_url`；参数非法 `400 invalid_query`，无匹配 `404 not_found`。

---

## 音乐试听与歌词

### GET /api/music/play

搜索音乐试听链接。限流桶 `music_play`（12 次/10 分钟，命中缓存不计数）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词（≤80 字符） |
| artist | string | 否 | 歌手，用于在多条候选里择优（≤80 字符） |

**响应：**
```json
{
  "track": { "id": "1", "name": "范特西", "artist": ["周杰伦"] },
  "playUrl": "https://...",
  "lyricId": "1",
  "isCover": false
}
```

`Cache-Control: no-store`。错误：上游限流 `429 music_upstream_limited`（`retry-after: 300`）；搜索失败 `502 music_search_failed`；无可用试听 `404 music_not_found`；异常 `502 music_unavailable`。

### GET /api/music/lyric

按歌名（+可选 `artist`，参数同 `play`）解析曲目后返回去掉时间轴的纯文本歌词。限流桶 `music_lyric`（12 次/10 分钟，命中缓存不计数）。

**响应：** `{ "title", "artist", "lyric", "tlyric"? }`（`max-age=86400`）；无歌词 `404 lyric_not_found`，其余错误同 `play`，异常为 `502 lyric_unavailable`。

---

## AI 解读

三个场景（榜单点评 / 画像点评 / 比较解读）共用 `POST /api/insights`；提示词由服务端模块拼装（指令与数据分离，见 `docs/PLAN-ai-insights.md` §6），前端只发送结构化数据。双通道：**内置**（CF 环境变量 `AI_API_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_PROTOCOL`）或**用户自带**（请求体带 `config` 三参数，经 Worker 转发，key 不落日志）。

### POST /api/insights

**请求体：**

```jsonc
{
  "scene": "ranking" | "profile" | "compare",
  "data": { /* 结构化场景数据，序列化后 ≤ 16 KB */ },
  "locale": "zh" | "en",                // 可选，默认 zh（仅影响输出语言）
  "length": "brief" | "standard" | "deep", // 可选，默认 standard（输出字数档位）
  "config": {                            // 可选。缺省 = 内置 env 通道
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-…",
    "model": "gpt-4o-mini",
    "protocol": "auto" | "chat" | "responses" | "anthropic" | "gemini" // 可选，默认 auto
  }
}
```

场景数据形状（前端 `src/lib/aiInsight.ts` 组装，服务端校验形状不符返回 `400 invalid_data`）：

| scene | data 关键字段 | 截断 |
|-------|---------------|------|
| `ranking` | `profileName`, `kind`, `collectionTitle`, `itemCount`, `works[{rank,title,creator?,year?}]` | works ≤ 150 |
| `profile` | `profileName`, `rankings[{kind,collectionTitle,itemCount,top[...]}]`, `stats{totalWorks,kindsCount,topCreators}` | top ≤ 15/榜，creators ≤ 8 |
| `compare` | `ownName`, `peerName`, `media[{kind,overlap,orderAgreement,consensusScore,kendallTau,sharedTop,onlyOwnCount,onlyPeerCount,biggestGap}]`, `crossAgreement` | sharedTop ≤ 5，media ≤ 10 |

自定义 `config` 的 `baseUrl` 强制 https、拒绝字面 IP / localhost / `*.internal` / `metadata.cloudflare.com`（400 `invalid_config`）。四协议适配与 `auto` 自动探测（chat → responses → anthropic → gemini，仅 404/405 降档）见 `worker/ai.ts`。

**响应（200）：**

```json
{
  "insight": "1. 总体印象：…",
  "source": "builtin" | "custom",
  "model": "claude-3-5-haiku-latest",
  "protocol": "anthropic",
  "promptVersion": 1
}
```

`promptVersion` 为数字 = 默认模块组合版本；`"override"` = 管理端在线覆盖生效（见管理接口补充）。

**错误：** `503 ai_not_configured`（未配置内置且请求未带 config）、`400 invalid_config / invalid_data`、`413 data_too_large`、`429 rate_limited`（retry-after 600）、`502 upstream_auth_failed / upstream_not_found / upstream_rate_limited / upstream_error`。`Cache-Control: no-store`。

**限流：** 内置桶 `ai` 8 次/10 分钟；自定义桶 `ai_custom` 15 次/10 分钟（各自独立）。

### POST /api/ai/test

「测试连接」：用 `max_tokens=16` 的探活请求验证 config 可用，`auto` 时回显探测到的协议。

**请求体：** `{ "config": { 同上 } }`
**响应：** `{ "ok": true, "model": "…", "protocol": "chat" }` 或 `{ "ok": false, "error": "…", "msg": "…" }`。
**限流：** 桶 `ai_test` 5 次/10 分钟。

### POST /api/ai/models

「获取模型列表」：按协议代理各家的模型列表端点（chat/responses → `{base}/models` + Bearer；anthropic → `{base}/v1/models` + `x-api-key`；gemini → `{base}/v1beta/models` + `x-goog-api-key`，自动剥离 `models/` 前缀）。`auto` 时按序探测并缓存结论（按 baseUrl，isolate 级，上界 200）。

**请求体：** `{ "config": { 同上 } }`
**响应：** `{ "ok": true, "protocol": "chat", "models": ["gpt-4o-mini", …], "truncated": false }`（上限 100 条，超出 `truncated: true`）。
**限流：** 桶 `ai_models` 10 次/10 分钟。

---

## 广场

### GET /api/plaza/posts

获取广场帖子列表（公开，无需登录；带 token 时额外可见自己的隐藏帖）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| limit | number | 否 | 每页数量，默认 20，最大 50 |
| kind | string | 否 | 按媒介筛选：`film` / `book` / `music` / `other` |
| sort | string | 否 | `newest`（默认）或 `hottest`（按 `like_count` 倒序） |
| q | string | 否 | 按标题或作者昵称模糊搜索（`LIKE`，转义 `%`/`_`） |

**响应：**（列表为瘦身版：**不返回**完整 `items`/`notes`，只给前三名作品与批注数量）
```json
{
  "posts": [
    {
      "id": 1,
      "user_id": 5,
      "post_type": "ranking",
      "kind": "film",
      "collection_title": "我的华语电影 Top 10",
      "description": "",
      "top_items": [
        { "id": "...", "title": "花样年华", "rank": 1, "creator": "王家卫", "year": 2000 }
      ],
      "note_count": 3,
      "item_count": 10,
      "like_count": 24,
      "comment_count": 5,
      "is_public": 1,
      "created_at": "2025-01-15T...",
      "updated_at": "2025-01-15T...",
      "nickname": "影迷小王",
      "is_author": false
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 156
}
```

`top_items` 取 `items` 的前三件（`profile` 帖则取各榜单第一名）。

### GET /api/plaza/posts/:id

获取单个帖子详情，包含留言列表。隐藏帖仅作者可见（其他人得到 `404`）。

**响应：**
```json
{
  "post": {
    "id": 1,
    "user_id": 5,
    "post_type": "ranking",
    "kind": "film",
    "collection_title": "我的华语电影 Top 10",
    "description": "",
    "items": [
      { "id": "...", "title": "花样年华", "rank": 1, "creator": "王家卫", "year": 2000 }
    ],
    "notes": "{\"work:film:xxx\":\"这是一部...\"}",
    "item_count": 10,
    "like_count": 24,
    "comment_count": 5,
    "is_public": 1,
    "created_at": "2025-01-15T...",
    "updated_at": "2025-01-15T...",
    "nickname": "影迷小王",
    "edit_count": 2,
    "last_edited_at": "2025-01-16T...",
    "is_author": true,
    "liked_by_me": false
  },
  "posterUrls": [null, "https://img9.doubanio.com/..."],
  "comments": [
    {
      "id": 1,
      "post_id": 1,
      "user_id": 8,
      "content": "很棒的榜单！",
      "parent_id": null,
      "created_at": "2025-01-16T...",
      "nickname": "书虫小李"
    }
  ]
}
```

`items` 走白名单投影（读取时自愈旧数据里的 `posterUrls`）；海报地址放在与 `items` 等长、按位置对齐的旁路数组 `posterUrls` 中，`null` 表示该条没有已持久化的地址。

### POST /api/plaza/posts

发布帖子到广场。需 Bearer Token。

**请求体：**
```json
{
  "post_type": "ranking",
  "kind": "film",
  "collection_title": "我的华语电影 Top 10",
  "description": "一句话说明",
  "items": [
    { "id": "...", "title": "花样年华", "rank": 1, "creator": "王家卫", "year": 2000 }
  ],
  "notes": { "work:film:xxx": "这是一部..." },
  "is_public": true
}
```

**约束：**
- `post_type` 必填（`ranking` 或 `profile`），否则 `400 invalid_post_type`
- `items` 不能为空：`ranking` ≤300 件，`profile` ≤20 个榜单（每项须含 `items` 数组），编码后条数须在 1–300，否则 `400 invalid_items`
- `collection_title` ≤200 字符（必填）、`description` ≤500 字符（可选）
- `notes` 可为对象或字符串；字符串形式 ≤50000 字符
- `is_public` 缺省为公开

**响应：** `201`
```json
{ "id": 42, "stored": true }
```

### PUT /api/plaza/posts/:id

编辑自己的帖子。需 Bearer Token + 帖子所有权。

**请求体：** 同 POST，所有字段可选（未传则保留原值，服务端用 `COALESCE` 处理）。支持修改标题、描述、批注和排序（通过 `items` 传入新顺序）。此处的 `notes` 走 `cleanString`，只接受**字符串且 ≤2000 字符**（与 POST 的 50000 不同）；传对象、超长或空串都会按「未提供」处理，保留原值。

**响应：**
```json
{ "ok": true }
```

**错误：**
- `401` — `authentication_required`
- `403` — `forbidden`（非帖子作者）
- `404` — `post_not_found`

### DELETE /api/plaza/posts/:id

删除自己的帖子（以 batch 原子清理编辑历史 → 留言 → 点赞 → 帖子；编辑历史有外键，必须先删）。需 Bearer Token + 帖子所有权。

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

获取帖子的留言列表（按时间正序，最多 200 条）。隐藏帖仅作者可见，否则 `404 post_not_found`。

**响应：**
```json
{
  "comments": [
    {
      "id": 1,
      "post_id": 1,
      "user_id": 8,
      "content": "很棒的榜单！",
      "parent_id": null,
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
{ "content": "很棒的榜单！", "parent_id": 3 }
```

**约束：** 内容最长 500 字符，不能为空，不能包含控制字符；`parent_id` 可选，必须是 ≥1 的整数（用于回复）。

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

`token` 为 64 位十六进制（32 字节随机），会话有效期 30 天；后续请求用 `Authorization: Bearer <token>`。

**错误：**
- `400` — `invalid_email` / `invalid_password`（密码 <6 位） / `invalid_nickname`
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
- `400` — `missing_fields`（缺 email 或 password）
- `401` — `invalid_credentials`
- `403` — `account_disabled`

### POST /api/account/logout

退出登录。需 Bearer Token（删除该 token 对应的会话）。

### GET /api/auth/config

返回前端用于判断账号体系是否可用：`{ "enabled": true }`（是否绑定 D1）。注意该路径不做方法校验。

### GET /api/account/providers

列出可用的 OAuth 提供商（仅返回已配置 Client ID 的那些）。

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

发起 OAuth 流程。重定向到提供商授权页面（并下发 HttpOnly 的 `oauth_state` Cookie 防 CSRF）。

支持的 provider：`google`, `github`（未配置或未知时 `503 provider_not_configured` / `404 unknown_provider`）。

### GET /api/account/oauth/callback

OAuth 回调。校验 `state` 与 `oauth_state` Cookie 一致（CSRF），自动创建或关联用户，然后 302 到 `/?oauth_code=<一次性 code>`（token 不进 URL）。前端用下面的交换接口换取 token。

### POST /api/account/oauth/exchange

用回调下发的一次性 code 换取会话（5 分钟有效，阅后即删）。

**请求体：** `{ "code": "<oauth_code>" }`

**响应：** `{ "token", "email", "nickname" }`；code 缺失/非法 `400`，过期或不存在 `404 invalid_code`。

---

## 用户画像

### GET /api/account/profile

获取当前用户的画像。需 Bearer Token。

**响应：**
```json
{
  "email": "user@example.com",
  "nickname": "影迷小王",
  "profile": { "version": 2, "profileId": "...", "...": "..." },
  "notes": { "work:film:xxx": "这是一部..." },
  "updatedAt": "2025-01-15T..."
}
```

`profile` 读取时经白名单自愈（剔除历史残留的 `posterUrls`），形状不认识时原样透传；无画像时为 `null`。

### PUT /api/account/profile

保存画像。需 Bearer Token。

**请求体：** `{ "profile": <ArtisticProfile>, "notes"?: { ... } }` —— 画像在 `profile` 字段里，**不是**整个请求体。原始请求体 ≤512 KB，编码后的画像 JSON 同样 ≤512 KB（超出 `413 profile_too_large`）。

**响应：**
```json
{ "stored": true }
```

### PUT /api/account/nickname

修改昵称。需 Bearer Token。

**请求体：**
```json
{ "nickname": "新昵称" }
```

昵称必填、≤40 字符；响应 `{ "ok": true, "nickname": "新昵称" }`。

---

## 云端清单

### GET /api/account/collections

获取当前用户的所有云端清单（按更新时间倒序，最多 100 条）。需 Bearer Token。

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
      "items": [],
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### POST /api/account/collections

保存新的云端清单。需 Bearer Token。

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

**限制：** `kind` ∈ `film` / `book` / `music` / `other`；`title` 必填且 ≤160 字符；`description` ≤500 字符；`items` 2–1000 件（每件须有非空 `title`，≤160 字符），编码后总大小 512 KB。不符合返回 `400 invalid_collection`，超限返回 `413 payload_too_large`。

**响应：** `201 { "id": 42, "stored": true }`

### DELETE /api/account/collections/:id

删除指定的云端清单（只能删自己的）。

**响应：** `{ "ok": true }`

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

`token` 为 64 位十六进制，管理会话有效期 7 天。密码来自 `ADMIN_PASSWORD` 环境变量，否则回退到 `admin_config('password_hash')`（旧 SHA-256 哈希会在登录时透明升级为 PBKDF2）；错误 `401 invalid_password`、`503 auth_unavailable` / `no_password_configured`。

### GET /api/admin/dashboard

获取仪表盘数据，包含：概览统计（含 7 天/当日）、14 天趋势、媒介分布、最近 20 条事件、API 日志（30 条）、API 错误（20 条）、用户列表（50 条）、存储统计（核心表 + 扩展表行数）、海报错误（近 7 天 50 条 + 近 30 天按来源/类型聚合）。

### GET /api/admin/accounts

获取用户列表（最近 100 个）。

### DELETE /api/admin/accounts/:id

删除用户及其所有数据（广场帖子/历史/评论/点赞、Cookie 保险库、会话、OAuth、画像、清单，最后删账户）。

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

**请求体：** `{ "password": "新密码" }`（≥6 位，否则 `400 invalid_password`）。

### GET /api/admin/poster-errors

查询海报错误记录（`Cache-Control: no-store`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| days | number | 否 | 查询天数，默认 7 |
| limit | number | 否 | 返回数量，默认 200，最大 1000 |

**响应：** `{ "errors": [{ "id", "title", "media_type", "error", "source", "created_at" }] }`

### GET /api/admin/poster-errors/export

导出海报错误为 CSV 文件（UTF-8 BOM，最多 5000 行，`Content-Disposition: attachment`）。**需要与管理接口相同的 Bearer Token**，不支持 URL 参数传 token。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| days | number | 否 | 查询天数，默认 30 |

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

**响应：** `{ "ok": true, "deleted": <删除行数合计> }`

---

## 补充端点（2026-09 功能簇）

### PUT /api/plaza/posts/:id（编辑明细）

除标题/描述/批注/排序外，请求体可带 `edits` 数组记录本次操作明细（服务端写入 `plaza_post_edits`，含权威时间戳）：

```json
{ "description": "改一下", "items": [ "..." ],
  "edits": [{ "action": "reorder", "detail": "把《X》移到第 2 位" }] }
```

`action` ∈ `reorder|add|remove|sync|meta|hide|restore`（≤40 字符，非字符串或超长的条目会被丢弃），`detail` ≤300。最多 50 条/次。仅作者；未提供字段用 COALESCE 保留原值。

### GET /api/plaza/posts/:id/edits

获取帖子编辑历史（**仅作者**，≤200 条，倒序）。返回 `{ "edits": [{ "id", "action", "detail", "created_at" }] }`。

### POST /api/plaza/posts/:id/visibility

作者隐藏/恢复自己的帖子。请求体 `{ "is_public": false }`。隐藏后仅作者自己在列表/详情可见，并写入一条 `hide`/`restore` 编辑历史。响应 `{ "ok": true, "is_public": 0 }`。

---

## 共享挑战

### POST /api/challenges

创建一个可分享的挑战题集。需同源，限流桶 `challenge`（30 次/10 分钟）。

**请求体：**
```json
{
  "items": ["龙猫", "千与千寻", "霸王别姬"],
  "theme": "宫崎骏 vs 华语经典",
  "mode": "shared",
  "top_k": 3
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| items | 是 | 2–300 条作品标题，每项 ≤120 字符，去重后至少 2 条 |
| theme | 是 | 主题，≤80 字符 |
| mode | 否 | ≤40 字符，默认 `shared` |
| top_k | 否 | 1–`items.length` 的整数 |
| seed_text / template_id | 否 | 各 ≤80 字符 |

**响应：** `201 { "id": "mv-xxxxxxxxxxxx", "path": "/?list=mv-xxxxxxxxxxxx" }`。ID 形如 `mv-` + 12 位 `[a-z0-9]`；未绑定 D1 或写入失败返回 `503 { "error": "challenge_storage_unavailable", "fallback": "payload" }`。

### GET /api/challenges/:id

读取共享挑战（公开，`max-age=300`）。ID 不匹配 `mv-[a-z0-9]{12}` 返回 `400 invalid_challenge_id`，不存在返回 `404 challenge_not_found`。

**响应：** `{ "id", "theme", "mode", "items", "top_k", "seed_text", "source": "shared", "template_id", "created_at" }`

---

## 分享短链

### POST /api/share

创建分享短链。需同源（不需要登录），限流桶 `share`（30 次/10 分钟）。请求体：`{ "profile": <ArtisticProfile>, "notes"?: {...}, "expires_days"?: 7|30|90|365 }`（默认 30 天，请求体与编码后的 profile 均 ≤512KB）。

**响应：** `{ "code": "ab12CD34", "url": "https://…/share/ab12CD34", "compareUrl": "https://…/encounter?payload=ab12CD34", "expires_days": 30, "expires_at": "…" }`

`code` 为 12 位十六进制随机串（冲突重试 3 次）；错误：`400 invalid_json` / `invalid_profile`，`413 profile_too_large`，`503 link_create_failed`。

### GET /api/share/:code

读取分享内容（公开，无需登录；`code` ≤20 字符）。过期或不存在返回 `404 link_expired_or_not_found`。响应：`{ "profile", "notes"?, "expires_at" }`（`max-age=3600`，读取时对历史画像做白名单自愈）。

> cron（`0 3 * * 1`，每周一）清理过期短链。

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
> 1. `GET music.163.com/api/v6/playlist/detail?id=&n=1000&s=0` → `playlist.trackIds` 全量曲目 ID（≤1000，v6 的 `tracks` 仅带前 ~10 首）
> 2. 空则降级 `POST music.163.com/weapi/v6/playlist/detail/`（AES-CBC+RSA 加密，连续尝试 2 次，每次之间退避 900ms）
> 3. 曲目批量：`POST music.163.com/api/v3/song/detail`（表单 `c=[{"id":1},…]`，每片 ≤300 个），空则降级 `weapi/v3/song/detail/`；分片间 700ms 节流
>
> 全部失败时回退 detail 自带的前几首 `tracks`。带连接 Cookie 时私有歌单也可导入。批量补全只请求窗口内的分片；若上游只返回窗口中的一部分曲目，`nextOffset` 回退到第一个缺失曲目，避免漏抓。

### GET /api/import/netease/mine

我的网易云歌单列表（需已扫码/Cookie 连接）。同样走 `neteaseUserPlaylists`（分层降级 + 收藏识别）。返回 `{ "playlists": [{ id, name, track_count, cover, special, subscribed }], "blocked", "uid" }`（special=我喜欢的音乐，subscribed=收藏的他人歌单；uid 供前端预填「按 UID 浏览」框）。

### GET /api/netease/user-playlists?uid=

按用户 ID 浏览**任意用户**的全部歌单（含其收藏的）。分层策略：
1. 开放接口 `api/user/playlist?uid=&limit=1000`（本机/住宅 IP 匿名可用；已连接时带 Cookie）
2. 空结果自动降级 weapi `/weapi/user/playlist/`
3. 两层都拿不到 → `{ playlists: [], blocked: true, msg: "网易云暂时限制了服务器匿名访问…" }`（网易云常对 Cloudflare 数据中心出口做匿名限制；仅在未连接账号时附 `msg`）

返回 `{ "playlists": [{ id, name, track_count, cover, special, subscribed }], "total", "blocked" }`。收藏歌单识别：匿名响应 `subscribed` 恒为 null，按 `creator.userId ≠ 被查 uid` 判定。`uid` 须为 1–1000000000000 的整数（≤13 位数字），否则 `400 invalid_uid`。前端入口：「音乐 → 我的清单 → 输入用户 ID/主页链接 → 浏览全部歌单 → 点选导入」。

---

## 网易云连接（需登录，IP 限流 120 次/10 分钟）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/netease/qr/issue` | 签发扫码二维码。开放接口优先、weapi 兜底。返回 `{ unikey, qr_value, ttl }`（ttl 秒，开放通道 150 / weapi 180） |
| GET | `/api/netease/qr/poll?unikey=` | 轮询状态 `{ state: waiting\|scanned\|confirmed\|expired\|risk, error?, nickname?, avatarUrl? }`。803 成功时从 Set-Cookie 提取 MUSIC_U(+__csrf) 加密入库；风控码返回 risk 由前端连续容忍。`unikey` ≤64 字符，否则 400 |
| GET | `/api/netease/status` | `{ connected, account: { nickname, avatarUrl } \| null }`（10 分钟内存缓存） |
| POST | `/api/netease/cookie` | 粘贴 Cookie 连接。体 `{ cookie }`（含 MUSIC_U 或纯值，≤4096 字符），校验真实可用后入库。错误 `400 invalid_cookie` / `missing_music_u` / `cookie_invalid`。响应 `{ ok: true, nickname: null }` |
| POST | `/api/netease/disconnect` | 断开并删除加密 Cookie |

## 豆瓣连接（需登录，IP 限流 120 次/10 分钟）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/douban/qr/issue` | 签发二维码。`accounts.douban.com/j/mobile/login/qrlogin_code`，服务端代理下载二维码图转 data URL。返回 `{ code, qr_image, ttl }`（ttl 120 秒） |
| GET | `/api/douban/qr/poll?code=` | 轮询 `qrlogin_status`，`login_status` pending→scan→login→expired；login 时从 Cookie 罐提取 `dbcl2`(+ck) 入库。`code` ≤128 字符，否则 400 |
| GET | `/api/douban/status` | `{ connected, account: { nickname, avatarUrl } \| null }`（10 分钟内存缓存） |
| POST | `/api/douban/cookie` | 粘贴 Cookie 连接（体 `{ cookie }`，含 dbcl2，≤4096 字符），`/mine/` 重定向校验有效后入库。错误 `400 invalid_cookie` / `missing_dbcl2` / `cookie_invalid` |
| POST | `/api/douban/disconnect` | 断开并删除 |

> 豆瓣 Cookie 罐按 `code` 键保存（5 分钟 TTL、上限 500 会话）；网易云按 `unikey` 键保存。`/api/netease/*`、`/api/douban/*` 未匹配到具体路径时返回 `404 not_found`，函数内异常返回 `502 <provider>_unavailable`。

> Cookie 保险库：`user_cookie_vault(user_id, provider, data_encrypted)`，AES-GCM 加密，密钥首次使用自动生成存 `admin_config('cookie_enc_key')`（可用 `COOKIE_ENC_KEY` 环境变量覆盖）。provider ∈ `netease|douban`。

---

## 管理接口补充

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/accounts/:id/detail` | 用户完整数据（画像/批注/清单/会话/OAuth/广场数） |
| GET | `/api/admin/plaza/posts` | 广场帖子管理列表（含隐藏、`kind`/`q` 筛选搜索、`live_comment_count` 校正评论数；分页同公开列表） |
| GET | `/api/admin/plaza/posts/:id` | 帖子完整详情（含全部评论（≤500）与作者邮箱） |
| DELETE | `/api/admin/plaza/posts/:id` | 管理员删除任意帖子（batch 原子清理编辑历史/评论/点赞） |
| POST | `/api/admin/plaza/posts/:id/visibility` | 管理员隐藏/恢复任意帖子 |
| DELETE | `/api/admin/plaza/comments/:id` | 管理员删评论（连删直接回复，按实际数修正计数；响应带 `removed`） |
| POST | `/api/admin/reset` | 分级重置（`scope` ∈ `analytics`/`plaza`/`shares`/`accounts` 四档，需 `confirm=RESET` + `password` 重验） |
| GET | `/api/admin/audit` | 审计日志列表（`limit` 默认 100、最大 500） |
| POST | `/api/admin/change-password` | 修改管理密码（体 `{ old_password, new_password }`，新密码 ≥6 位；使用 `ADMIN_PASSWORD` 环境变量时返回 `400 env_password_immutable`） |
| POST | `/api/admin/sessions/revoke-all` | 强制**所有用户**会话下线（清空 `user_sessions`） |
| POST | `/api/admin/links/clean-expired` | 立即清理过期短链 |
| GET | `/api/admin/ai/prompts` | 三场景 AI 提示词覆盖现状（`{ prompts: { ranking/profile/compare: { override, value } } }`） |
| PUT | `/api/admin/ai/prompt/:scene` | 设置某场景（`ranking`/`profile`/`compare`）的 system 提示词覆盖（体 `{ system }` ≤4000 字；存 `admin_config`，写审计 `ai:prompt_override`）。**仅覆盖指令部分**，作品数据块始终由服务端渲染 |
| DELETE | `/api/admin/ai/prompt/:scene` | 清除覆盖、恢复默认模块拼装（写审计） |

> 另有未在上表列出的管理端点：`POST /api/admin/logout`（注销当前管理员会话）、`GET /api/admin/check`（返回 `{ authenticated }`）、`GET /api/admin/poster-errors/export`（见上）。

---

## 邮箱验证码（注册 / 修改密码，2026-09-22）

注册与修改密码以**邮箱验证码**核验身份；发码通道为 luckycola customMail（API 契约与配置键照抄 `scripts/mail_sender.py`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/account/send-code` | 下发验证码（注册/修改密码共用）。体 `{ email, purpose: "register"\|"reset" }`。同邮箱同用途 **60s 冷却**（429 `code_cooldown`）；register 撞已注册 → 409，reset 未注册 → 404；邮件发送失败 → 502 `mail_failed`。环境变量 `MAIL_COLA_KEY` / `MAIL_SMTP_EMAIL` / `MAIL_SMTP_CODE` / `MAIL_SMTP_TYPE`（未配置走开发兜底：验证码仅写日志） |
| POST | `/api/account/change-password` | 修改密码（**免旧密码**，码证身份）。体 `{ email, code, password }`，password ≥6 位；成功后吊销该用户全部旧会话 |

`POST /api/account/register` 新增必填字段 `code`（purpose=register 的验证码）。验证码规格：6 位数字、**10 分钟有效**、**5 次容错**（超限作废）、一次性消耗（SHA-256 散列入库，`verification_codes` 表，迁移 `0023`）。
