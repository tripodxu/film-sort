# 豆瓣 API 文档

基于 `search.douban.com` 和各站点 suggest/Top250 接口的豆瓣数据 API。

## 通用说明

- 所有接口均为 GET 请求
- 响应格式统一为 JSON
- 搜索接口通过 `window.__DATA__` 解析搜索结果页
- 详情接口通过正则解析豆瓣详情页 HTML
- 内置防限流机制：UA 轮换、请求节流、自动重试、冷却期

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
  "time": "5.364s",
  "data": [
    {
      "cover_link": "https://book.douban.com/subject/4913064/",
      "cover": "https://img3.doubanio.com/view/subject/l/public/s29053580.jpg",
      "rating": "9.3",
      "title": "活着",
      "author": "余华",
      "press": "作家出版社",
      "date": "2012-8-1",
      "price": "20.00元"
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
  "time": "5.372s",
  "data": [
    {
      "cover_link": "https://movie.douban.com/subject/4864908/",
      "cover": "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2530513100.jpg",
      "rating": "7.2",
      "title": "影",
      "country": "中国大陆",
      "type": ["香港", "剧情", "动作", "武侠", "古装"],
      "duration": "116分钟",
      "year": "2018",
      "actors": ["张艺谋", "邓超", "孙俪"]
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
  "time": "6.561s",
  "data": [
    {
      "cover_link": "https://music.douban.com/subject/1403307/",
      "cover": "https://img3.doubanio.com/view/subject/m/public/s3750422.jpg",
      "rating": "9.2",
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
| url | string | 是 | `book.douban.com/subject/...` 格式的URL |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "6.663s",
  "data": {
    "title": "活着",
    "pic": "https://img3.doubanio.com/view/subject/l/public/s29053580.jpg",
    "rating": "9.3",
    "作者": "余华",
    "出版社": "作家出版社",
    "出版年": "2012-8-1",
    "页数": "191",
    "定价": "20.00元",
    "装帧": "平装",
    "丛书": "余华作品（2012版）",
    "ISBN": "9787506365437",
    "content_intro": "《活着(新版)》讲述了农村人福贵悲惨的人生遭遇...",
    "author_intro": "余华，1960年出生，1983年开始写作...",
    "tags": ["余华", "活着", "人生", "人性", "中国文学", "小说"]
  }
}
```

---

### 影视详情

```
GET /api/movie/detail?url={豆瓣影视URL}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | `movie.douban.com/subject/...` 格式的URL |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "9.082s",
  "data": {
    "title": "影(2018)",
    "pic": "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2530513100.jpg",
    "rating": "7.2",
    "导演": "张艺谋",
    "编剧": "李威/张艺谋",
    "主演": "邓超/孙俪/郑恺/王千源/王景春/胡军/关晓彤/吴磊",
    "类型": "剧情/动作/武侠/古装",
    "制片国家/地区": "中国大陆/香港",
    "语言": "汉语普通话",
    "上映日期": "2018-09-30(中国大陆)",
    "片长": "116分钟",
    "又名": "三国·荆州/荆州保卫战/Shadow",
    "IMDb链接": "tt6864046",
    "content_intro": "战乱年代，群雄并起...",
    "acting_staff": ["张艺谋", "邓超", "孙俪"],
    "imgs": ["https://img3.doubanio.com/view/photo/sqxs/public/..."]
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
| url | string | 是 | `music.douban.com/subject/...` 格式的URL |

**响应示例：**
```json
{
  "status": true,
  "msg": "获取成功",
  "time": "9.652s",
  "data": {
    "title": "七里香",
    "pic": "https://img3.doubanio.com/view/subject/m/public/s3737076.jpg",
    "rating": "8.1",
    "又名": "Common Jasmin Orange",
    "表演者": "周杰伦",
    "流派": "流行",
    "专辑类型": "专辑",
    "介质": "CD",
    "发行时间": "2004",
    "出版者": "上海声像出版社",
    "唱片数": "1",
    "content_intro": "從第一張JAY同名專輯...",
    "songs": ["1.我的地盘", "2.七里香", "3.借口"]
  }
}
```

---

## 其他 API

### 海报/封面获取

```
GET /api/posters?q={标题}&en={英文名}&type={类型}&year={年份}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 作品标题 |
| en | string | 否 | 英文名（默认同q） |
| type | string | 否 | `movie` / `book` / `music`（默认movie） |
| year | int | 否 | 年份 |

**响应：** `{ "poster_urls": ["https://..."] }`

### 图片代理

```
GET /api/image?url={图片URL}
```

代理访问 doubanio.com 等 CDN 图片，避免跨域问题。

### 豆瓣 Top250

```
GET /api/douban/top250?limit={数量}      # 电影
GET /api/douban/books/top250?limit={数量}  # 书籍
GET /api/douban/music/top250?limit={数量}  # 音乐
```

### 豆瓣 Suggest

```
GET /api/douban/suggest?q={关键词}        # 电影
GET /api/douban/books/suggest?q={关键词}   # 书籍
```

---

## 错误响应

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 成功（检查 `status` 字段） |
| 400 | 参数错误 |
| 502 | 上游请求失败 |
| 415 | 不支持的图片格式 |
| 418/403 | 豆瓣限流 |

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

- **UA 轮换**：6个不同的 User-Agent 随机切换
- **请求节流**：同域名间隔最少 800ms
- **自动重试**：403/418 时自动重试，指数退避
- **全局冷却**：限流触发后进入递增冷却期
- **缓存**：搜索结果缓存1小时，详情缓存24小时
