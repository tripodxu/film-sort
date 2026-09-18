# 豆瓣 API 文档

基于 `search.douban.com`、各站点 suggest/Top250 接口和详情页解析的豆瓣数据 API。接口契约、限流桶与错误码以 `API.md` 为准，本文只记录数据来源与解析细节。

## 通用说明

- 数据接口均为 GET 请求（`POST /api/douban/cookie` 等登录接口除外）
- 响应格式统一为 JSON
- 搜索接口解析 `search.douban.com` 页面中的 `window.__DATA__` JSON
- 详情接口直接抓取豆瓣详情页 HTML 并用正则解析（`fetchDetailPage`）
- 电影详情以搜索接口取元数据为先，简介再取 `movie.douban.com/subject/...` 的 `v:summary`
- 内置防限流机制：UA 轮换、请求节流、自动重试、冷却期（见 `ARCHITECTURE.md` §5.5）

## 数据来源

| 类型 | 搜索列表 | 详情 | 海报 | Top250 |
|------|----------|------|------|--------|
| 电影 | `search.douban.com/movie` | `search.douban.com` 取元数据 + `movie.douban.com` 详情页 `v:summary` | suggest API + search + Top250 索引 + IMDb | `movie.douban.com/top250` |
| 书籍 | `search.douban.com/book` | `book.douban.com/subject/...` | suggest API (`pic` 字段) + search + Top250 索引 | `book.douban.com/top250` |
| 音乐 | `search.douban.com/music` | `music.douban.com/subject/...` | 网易云 CDN 直出 + search + Top250 索引 | `music.douban.com/top250` |

> 三类海报在候选全空后统一降级：维基 → 网易云/gd-proxy（音乐已在第一档取过网易云，不再重复）。完整来源顺序见 `API.md` §海报。

---

## 搜索列表 API

### 书籍搜索

```
GET /api/book/list?key={关键词}&page={页码}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词，最长80字符 |
| page | int | 否 | 页码，默认1，每页15条，有效范围 1–100 |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "0.988s",
  "data": [
    {
      "cover_link": "https://book.douban.com/subject/4913064/",
      "cover": "https://img9.doubanio.com/view/subject/m/public/s29869926.jpg",
      "rating": "9.4",
      "title": "活着",
      "author": "余华",
      "press": "作家出版社",
      "date": "2012-8",
      "price": "28.00元"
    }
  ]
}
```

---

### 影视搜索

```
GET /api/movie/list?key={关键词}&page={页码}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词，最长80字符 |
| page | int | 否 | 页码，默认1，每页15条，有效范围 1–100 |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "1.069s",
  "data": [
    {
      "cover_link": "https://movie.douban.com/subject/1291560/",
      "cover": "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2540924496.webp",
      "rating": "9.2",
      "title": "龙猫",
      "year": "1988",
      "country": "日本",
      "type": ["动画", "奇幻", "冒险"],
      "duration": "86分钟",
      "actors": ["宫崎骏", "日高范子", "坂本千夏"]
    }
  ]
}
```

---

### 音乐搜索

```
GET /api/music/list?key={关键词}&page={页码}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词，最长80字符 |
| page | int | 否 | 页码，默认1，每页15条，有效范围 1–100 |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "1.389s",
  "data": [
    {
      "cover_link": "https://music.douban.com/subject/1403307/",
      "cover": "https://img1.doubanio.com/view/subject/m/public/s35019288.jpg",
      "rating": "9.5",
      "title": "范特西",
      "subtitle": "Fantasy",
      "artist": "周杰伦",
      "date": "2001-09-14",
      "album": "专辑",
      "medium": "CD",
      "schools": "流行"
    }
  ]
}
```

---

## 详情 API

### 书籍详情

```
GET /api/book/detail?name={书名}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 书籍标题（简介走豆瓣官方优先、维基兜底） |
| title | string | 否 | 兼容旧参数，等同于 name |
| url | string | 否 | `book.douban.com/subject/...` 格式 |
| creator | string | 否 | 作者，用于在搜索多结果中择优（命中标题+作者 +4） |

简介优先取豆瓣官方详情页（书籍解析器读的是 `div.intro`，不读 `v:summary`）；失败时降级维基消歧打分（限定标题/类型声明/年份），百度百科兜底。`author_intro` 取 `#link-report` 内的 `div.intro`，`tags` 取标签链接，`dirs` 取目录区块。元数据从豆瓣详情页/搜索解析。

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "2.1s",
  "data": {
    "title": "活着",
    "pic": "https://img9.doubanio.com/view/subject/m/public/s29869926.jpg",
    "rating": "9.4",
    "作者": "余华",
    "出版社": "作家出版社",
    "出版年": "2012-8",
    "页数": "191",
    "定价": "28.00元",
    "装帧": "平装",
    "ISBN": "9787506365437",
    "content_intro": "To Live is a novel by Chinese author Yu Hua, first published in 1993...",
    "content_source": "enwiki",
    "author_intro": "余华，1960年出生...",
    "tags": ["余华", "活着", "人生", "中国文学", "小说"]
  }
}
```

---

### 影视详情

```
GET /api/movie/detail?name={电影名}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 电影标题（简介走豆瓣官方优先、维基兜底） |
| title | string | 否 | 兼容旧参数，等同于 name |
| url | string | 否 | `movie.douban.com/subject/...` 格式 |
| creator | string | 否 | 导演/主演，用于在搜索多结果中择优（命中标题+演员 +4） |

简介优先取豆瓣官方详情页 v:summary；失败时降级维基消歧打分，百度百科兜底。元数据从豆瓣搜索补充；维基消歧用的年份取自搜索结果的 `year`（路由**不读取** `year` 查询参数）。

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "1.2s",
  "data": {
    "title": "龙猫 となりのトトロ",
    "pic": "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2540924496.webp",
    "rating": "9.2",
    "year": "1988",
    "类型": "动画/奇幻/冒险",
    "制片国家/地区": "日本",
    "片长": "86分钟",
    "主演": "宫崎骏/日高范子/坂本千夏",
    "content_intro": "My Neighbor Totoro is a 1988 Japanese animated fantasy film written and directed by Hayao Miyazaki...",
    "content_source": "enwiki"
  }
}
```

---

### 音乐详情

```
GET /api/music/detail?name={专辑名}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 音乐标题（简介走豆瓣官方优先、维基兜底） |
| title | string | 否 | 兼容旧参数，等同于 name |
| url | string | 否 | `music.douban.com/subject/...` 格式 |
| creator | string | 否 | 表演者，用于在搜索多结果中择优（命中标题+表演者 +4） |

简介依次尝试 `v:summary` → `span.all` → `div.intro`（豆瓣官方优先）；失败时降级维基消歧打分（限定标题/类型声明/年份），百度百科兜底。曲目 `songs` 取 `.song-items-wrapper` 内的 `.song-name`。元数据从豆瓣详情页/搜索解析。

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "2.3s",
  "data": {
    "title": "范特西",
    "pic": "https://img1.doubanio.com/view/subject/m/public/s35019288.jpg",
    "rating": "9.5",
    "表演者": "周杰伦",
    "流派": "流行",
    "专辑类型": "专辑",
    "介质": "CD",
    "发行时间": "2001-09-14",
    "content_intro": "Fantasia is the second studio album by Taiwanese singer Jay Chou...",
    "content_source": "enwiki",
    "songs": ["1.爱在西元前", "2.爸我回来了", "3.简单爱"]
  }
}
```

---

## 作品详情（统一入口，已弃用）

> 前端已改用上方三个独立详情接口（`/api/{movie|book|music}/detail?name=`）。
> 此接口仍可用，但不再由前端调用。

```
GET /api/artwork/detail?kind={类型}&q={标题}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | `film` / `book` / `music` / `other` |
| q | string | 是 | 作品标题（≤120 字符） |

先通过搜索 API 找到第一个 `douban.com/subject/` 结果，再调用对应类型的详情接口（`film` → `doubanMovieDetail`）；`kind=other` 走维基详情。响应为对应详情体并附加 `source_url`。

---

## 海报/封面获取

```
GET /api/posters?q={标题}&en={英文名}&type={类型}&year={年份}
```

参数与响应契约见 `API.md` §海报（`year` 须为 1800–2200 的整数；`en` 默认空串）。

**各类型获取策略**（按下表顺序合并候选；全部落空后降级维基 → 网易云/gd-proxy，音乐已在第一档取过网易云故只再降级维基）：

| 类型 | 来源1 | 来源2 | 来源3 | 来源4 |
|------|-------|-------|-------|-------|
| movie | 豆瓣 suggest API (`img` 字段) | search.douban.com 搜索 | Top250 索引 | IMDb suggestion |
| book | 豆瓣 suggest API (`pic` 字段) | search.douban.com 搜索 | Top250 索引 | — |
| music | 网易云 CDN 直出 | search.douban.com 搜索 | Top250 索引 | — |

**响应：** `{ "poster_urls": ["https://img9.doubanio.com/...", ...] }`

豆瓣地址会展开成多个 CDN 镜像（`/l/` 大图 + 原始地址 + `img1`/`img2`/`img3`/`img9` 主机），前端按顺序尝试加载。

---

## 图片代理

```
GET /api/image?url={图片URL}
```

代理访问白名单主机的图片，避免浏览器跨域和 Referer 限制。白名单主机、Referer 规则与错误码见 `API.md` §图片代理。

---

## Top250 榜单

```
GET /api/douban/top250?limit={数量}       # 电影
GET /api/douban/books/top250?limit={数量}  # 书籍
GET /api/douban/music/top250?limit={数量}  # 音乐
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | int | 否 | 返回数量，2-250，默认50 |

**响应：**
```json
{
  "source": "douban",
  "total": 50,
  "works": [
    { "id": "douban-1291560", "title": "龙猫", "year": 1988, "poster_url": "https://..." }
  ]
}
```

---

## Suggest API

```
GET /api/douban/suggest?q={关键词}        # 电影
GET /api/douban/books/suggest?q={关键词}   # 书籍
```

返回豆瓣搜索建议，含标题、年份、封面 URL。音乐无 suggest API。

**响应：**
```json
{
  "works": [
    { "id": "douban-1291560", "title": "龙猫", "year": 1988, "poster_url": "https://..." }
  ]
}
```

---

## 错误响应

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 成功（列表/详情以 `status` 字段判断；豆瓣限流与抓取失败也走 200 + `status: false`） |
| 400 | 参数错误（`invalid_query` / `invalid_limit` / `invalid_key` 等） |
| 401 | 需要认证（仅 `/api/douban/qr/*`、`/api/douban/cookie` 等连接类接口） |
| 403 | 权限不足（跨域写入） |
| 404 | 资源不存在（详情未找到） |
| 502 | 上游不可用（Top250/「其他」接口的 `douban_unavailable` / `wiki_unavailable`） |

**限流响应示例**（`/api/{movie|book|music}/list` 命中冷却期时）：

```json
{
  "status": false,
  "msg": "豆瓣限流中，请30秒后重试",
  "time": "0s",
  "data": []
}
```

`msg` 里的秒数来自当前域名的剩余冷却时间；`search.douban.com` 冷却为触发后 10 秒。

---

## 防限流机制

豆瓣域名（`*.douban.com` / `*.doubanio.com`）的抓取统一走 `worker/media.ts` 的 `upstream()` + `buildHeaders()`；非豆瓣域名只带 UA 与 `Accept: */*`。通用机制见 `ARCHITECTURE.md` §5.5，豆瓣侧的当前实现：

- **UA 轮换**：4 个 Edge 浏览器 User-Agent 按索引依次轮转（非随机）；另带 `sec-ch-ua`/`sec-fetch-*` 等浏览器头，无 Cookie 时补一个随机 `bid`
- **请求节流**：按域名串行排队，默认间隔 800ms；`search.douban.com` 为 200ms（轻量 JSON 接口）
- **403/418 处理**：按域名设冷却 `(尝试次数 + 1) × 5s`（5s → 10s → 15s）并重试，`upstream()` 默认最多 3 次尝试；图片请求不再走节流（CDN 并发是正常浏览器行为）
- **其它非 2xx（含 429）**：不按豆瓣限流处理，抛错后按 `1s → 2s` 退避重试；`/api/music/*` 侧的上游限流另有 `music_upstream_limited`（429）出口，见 `API.md`
- **Accept 头**：图片请求用 `image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8`，页面请求以 `text/html,application/xhtml+xml,application/xml;q=0.9,...` 开头
- **Referer 头**：`book.douban.com` / `music.douban.com` / 其余豆瓣域名分别用 `https://book.douban.com/`、`https://music.douban.com/`、`https://movie.douban.com/`

---

## 已知限制

- `movie.douban.com` 详情页可能被反爬拦截（302→sec.douban.com）：`fetchDetailPage` 检测到该跳转即抛错，简介降级到维基/百度；元数据仍由 `search.douban.com` 提供
- `music.douban.com` 无 suggest API，音乐封面依赖网易云 CDN、搜索与 Top250 索引
- `search.douban.com` 可能随时调整反爬策略
- 所有接口依赖 Cloudflare Worker 环境，本地开发需 `npm run worker:dev`


---

## 统一豆瓣导入（/api/import/douban-list）

一个输入框自动识别三类链接（`worker/doubanlist.ts classifyDoubanList`）：

| 链接形态 | 抓取方式 | 是否需要连接豆瓣 |
|---|---|---|
| `douban.com/doulist/<id>` | HTML 解析（新版 `.doulist-item` + 旧版 `table.olt` 双兜底，offset/limit 分批） | 公开可抓；私有豆列需连接 |
| `m.douban.com/subject_collection/<ID>` | rexxar JSON API（`/items?type=S&start=&count=100` 分页） | 否（公开） |
| `{movie,book}.douban.com/mine?status=wish\|collect\|doing` | HTML 解析 2026 版结构（电影 `div.item.comment-item`、书籍 `li.subject-item`），offset/limit 分批（单批 ≤300，前端游标续抓） | **是**（扫码或粘贴 Cookie） |

响应：`{ works: [{ id, title, creator?, year?, rating?, poster_url?, type? }], total, listTotal, hasMore, nextOffset, kind }`（游标协议与单批上限见 `API.md` §外部数据导入）。

> **mine 页解析要点（2026-09 实测）**：旧版 `div.item-root` 已被豆瓣移除。
> - 电影页：`div.item.comment-item` → `li.title a` 内 `<em>中文名 / 英文名 / 别名…</em>`（取 ` / ` 首段为标题）、`.pic a[href*='/subject/']` 取 subject 链接、`.pic img` 取海报（`src` 或 `data-src`）、`li.intro` 是斜杠串元数据（含上映年份，无导演标签，故不强行造 creator）。
> - 书籍页：`li.subject-item` → `h2 a[title=书名]`（无 title 属性时退回正文 ` : ` 前段）、`.pic a` + `.pic img`、`.pub`「作者 / 出版社 / 年份 / 定价」（取首个非年份、非「…元」的字段为作者）。
> - **分页参数是 `start`**（每页约 15 条）；`page_start`/`page_limit` 会被服务端忽略导致每页返回同一批——必须用 `start`，步长按本页实际条数推进（解析失败的条目也计入），本页无新增条目即停止。单请求最多翻 20 页。清单总数从 `<title>` 的「我想看的影视(816)」括号数字解析。

## 豆瓣扫码登录与 Cookie 保险库

- 签发：`GET accounts.douban.com/j/mobile/login/qrlogin_code` → `payload{code, img, login_url}`；Worker 代理下载二维码图转 data URL 下发（免跨域），返回 `{ code, qr_image, ttl: 120 }`。
- 轮询：`qrlogin_status?code=` → `payload.login_status`：`pending → scan → login / expired`；未知状态回落为 `risk` 并带 error 文案。
- `login` 时登录凭证 **`dbcl2`**（+`ck`）经 Set-Cookie 落入**按 `code` 键**的会话 Cookie 罐（TTL 5 分钟、上限 500 会话），提取后 AES-GCM 加密存入 `user_cookie_vault(provider='douban')`。
- 兜底通道：`POST /api/douban/cookie` 粘贴浏览器 Cookie——正则提取 `dbcl2`，用 `/mine/` 重定向到 `/people/<uid>/` 校验真实有效后才入库（防存死 Cookie）。
- 连接后 `GET /api/douban/status` 返回昵称头像（解析个人主页 `<title>`/og:image，10 分钟缓存）。
