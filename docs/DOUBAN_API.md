# 豆瓣 API 文档

基于 `search.douban.com`、各站点 suggest/Top250 接口和详情页解析的豆瓣数据 API。

## 通用说明

- 所有接口均为 GET 请求
- 响应格式统一为 JSON
- 搜索接口解析 `search.douban.com` 页面中的 `window.__DATA__` JSON
- 详情接口直接抓取豆瓣详情页 HTML 并用正则解析
- 电影详情因反爬改用搜索接口优先
- 内置防限流机制：UA 轮换、请求节流、自动重试、冷却期

## 数据来源

| 类型 | 搜索列表 | 详情 | 海报 | Top250 |
|------|----------|------|------|--------|
| 电影 | `search.douban.com/movie` | `search.douban.com` 优先 + `movie.douban.com` 降级 | suggest API + Top250 + IMDB | `movie.douban.com/top250` |
| 书籍 | `search.douban.com/book` | `book.douban.com/subject/...` | suggest API (`pic` 字段) + Top250 | `book.douban.com/top250` |
| 音乐 | `search.douban.com/music` | `music.douban.com/subject/...` | Top250 + search | `music.douban.com/top250` |

---

## 搜索列表 API

### 书籍搜索

```
GET /api/book/list?key={关键词}&page={页码}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 搜索关键词，最长80字符 |
| page | int | 否 | 页码，默认1，每页15条 |

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
| key | string | 是 | 搜索关键词 |
| page | int | 否 | 页码，默认1 |

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
| key | string | 是 | 搜索关键词 |
| page | int | 否 | 页码，默认1 |

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
GET /api/book/detail?url={豆瓣书籍URL}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | `book.douban.com/subject/...` 格式 |

通过正则解析详情页 HTML，提取标题、封面、评分、出版信息、简介、作者简介、标签等。

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
    "content_intro": "《活着》讲述了农村人福贵悲惨的人生遭遇...",
    "author_intro": "余华，1960年出生...",
    "tags": ["余华", "活着", "人生", "中国文学", "小说"]
  }
}
```

---

### 影视详情

```
GET /api/movie/detail?url={豆瓣影视URL}&title={标题}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 否 | `movie.douban.com/subject/...` 格式 |
| title | string | 推荐 | 电影标题（搜索用） |

**策略**：优先用 `title` 通过 `search.douban.com` 搜索获取数据（绕过反爬）；若未提供 title 则尝试直接抓取详情页（可能被拦截）。

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
    "主演": "宫崎骏/日高范子/坂本千夏"
  }
}
```

---

### 音乐详情

```
GET /api/music/detail?url={豆瓣音乐URL}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | `music.douban.com/subject/...` 格式 |

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
    "content_intro": "從第一張JAY同名專輯...",
    "songs": ["1.爱在西元前", "2.爸我回来了", "3.简单爱"]
  }
}
```

---

## 作品详情（统一入口）

```
GET /api/artwork/detail?kind={类型}&q={标题}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| kind | string | 是 | `film` / `book` / `music` |
| q | string | 是 | 作品标题 |

先通过搜索 API 找到作品 URL，再调用对应类型的详情接口。电影类型直接用搜索结果数据。

---

## 海报/封面获取

```
GET /api/posters?q={标题}&en={英文名}&type={类型}&year={年份}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 作品标题 |
| en | string | 否 | 英文名（默认同q） |
| type | string | 否 | `movie` / `book` / `music`（默认movie） |
| year | int | 否 | 年份 |

**各类型获取策略：**

| 类型 | 来源1 | 来源2 | 来源3 |
|------|-------|-------|-------|
| movie | 豆瓣 suggest API (`img` 字段) | search.douban.com 搜索 | Top250 索引 |
| book | 豆瓣 suggest API (`pic` 字段) | search.douban.com 搜索 | Top250 索引 |
| music | search.douban.com 搜索 | Top250 索引 | — |

**响应：** `{ "poster_urls": ["https://img9.doubanio.com/...", ...] }`

返回多个 CDN 镜像 URL（img1-img9.doubanio.com），前端按顺序尝试加载。

---

## 图片代理

```
GET /api/image?url={图片URL}
```

代理访问 doubanio.com / media-amazon.com / media-imdb.com / tmdb.org 的图片，避免浏览器跨域和 Referer 限制。

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
| 200 | 成功（检查 `status` 字段） |
| 400 | 参数错误 |
| 401 | 需要认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 502 | 上游请求失败（含豆瓣限流） |

**限流响应示例：**
```json
{
  "status": false,
  "msg": "豆瓣限流中，请30秒后重试",
  "time": "0s",
  "data": []
}
```

---

## 防限流机制

- **UA 轮换**：4 个 Edge 浏览器 User-Agent 随机切换
- **请求节流**：同域名间隔最少 800ms
- **自动重试**：403/418 时自动重试 2 次，指数退避（1s → 2s）
- **全局冷却**：限流触发后进入递增冷却期（5s → 10s → 15s）
- **Accept 头**：图片请求用 `image/webp,*/*`，页面请求用 `text/html,*/*`
- **Referer 头**：根据域名设置正确的 Referer

---

## 已知限制

- `movie.douban.com` 详情页被反爬拦截（302→sec.douban.com），电影详情改用 search.douban.com
- `music.douban.com` 无 suggest API，音乐封面依赖 Top250 索引和搜索
- `search.douban.com` 可能随时调整反爬策略
- 所有接口依赖 Cloudflare Worker 环境，本地开发需 `npm run worker:dev`
