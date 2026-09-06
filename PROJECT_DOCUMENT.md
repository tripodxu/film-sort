# Sort_FilmsGame / 电影审美名单 — 完整项目文档

> **当前版本**: v3.10  
> **上线地址**: https://sortfilmsgamegit.streamlit.app  
> **技术栈**: Python + Streamlit + Supabase + Pillow + qrcode  
> **定位**: 把"给电影排出完整顺序"的高成本任务，拆成连续 1v1 二选一的影视偏好排序 Web App

---

## 目录

1. [产品概述与核心理念](#1-产品概述与核心理念)
2. [需求分析](#2-需求分析)
3. [功能清单](#3-功能清单)
4. [系统架构设计](#4-系统架构设计)
5. [核心模块详细设计](#5-核心模块详细设计)
6. [前端组件与交互设计](#6-前端组件与交互设计)
7. [数据模型设计](#7-数据模型设计)
8. [A/B 实验框架](#8-ab-实验框架)
9. [轻量片单自动维护系统](#9-轻量片单自动维护系统)
10. [国际化 (i18n)](#10-国际化-i18n)
11. [数据分析与后台看板](#11-数据分析与后台看板)
12. [前端美术与视觉设计](#12-前端美术与视觉设计)
13. [隐私与安全设计](#13-隐私与安全设计)
14. [测试策略](#14-测试策略)
15. [部署与运维](#15-部署与运维)
16. [版本演化历史](#16-版本演化历史)

---

## 1. 产品概述与核心理念

### 1.1 一句话定位

一个面向影视爱好者的公开网页应用，把"从一堆电影里排出第一、第二、第三"这件很费脑的事，拆成多次简单的 1v1 取舍：每次只问你两部电影更偏爱哪一部，最后生成一份属于自己的电影审美名单。

### 1.2 核心文案

> 不必一次想清全部顺序，只在两部电影之间作一次取舍。

### 1.3 设计哲学

| 原则 | 含义 |
|------|------|
| **降低决策成本** | 将 N! 的排序空间拆解为 O(N log N) 次二选一 |
| **移动端优先** | 首屏紧凑布局，手机上 3 秒内看到核心交互 |
| **零门槛入口** | 不要求登录、不要求准备片单，内置片单直接开始 |
| **传播闭环** | 从片单链接到取舍到结果海报到二维码分享 |
| **数据驱动** | 匿名行为埋点 + 漏斗分析 + A/B 实验框架 |

### 1.4 技术依赖

| 依赖 | 用途 |
|------|------|
| `streamlit` | Web 框架、页面渲染、状态管理 |
| `pandas` | 后台数据看板的数据处理和图表 |
| `requests` | HTTP 请求（豆瓣抓取、海报下载、Supabase API） |
| `beautifulsoup4` | 豆瓣页面 HTML 解析 |
| `pillow` | 海报图片生成和处理 |
| `qrcode` | 二维码生成 |
| `fonts-noto-cjk` | Streamlit Cloud 中文字体支持（系统包） |

---

## 2. 需求分析

### 2.1 用户画像

| 角色 | 场景 | 核心诉求 |
|------|------|----------|
| **影视爱好者** | 从看过的电影中排出自己的 Top N | 降低排序心智负担，得到可分享的结果 |
| **情侣/朋友** | 对比两个人对同一批电影的偏好差异 | 看同一批电影在两个人心里的不同顺序 |
| **影迷社区** | 从导演/演员/类型片单中排列偏好 | 快速生成有仪式感的结果海报 |
| **产品经理** | 监控用户行为、分析漏斗、运行实验 | 匿名数据看板 + A/B 实验框架 |

### 2.2 功能需求

#### FR-01: 取舍式排序核心
- **FR-01.1**: 基于二分插入算法的 1v1 电影偏好排序
- **FR-01.2**: 支持 Top N 模式（只排前 N 名）和完整排序模式
- **FR-01.3**: 支持撤销上一步、略过陌生电影、暂放纠结组合
- **FR-01.4**: 盲排模式（过程中隐藏临时名单，结束后揭晓）
- **FR-01.5**: 左右随机展示，减少固定位置偏好
- **FR-01.6**: 键盘快捷键（A/D、左右方向键、1/2）
- **FR-01.7**: 顺序口令（同一片单 + 同一口令 = 一致出场顺序）

#### FR-02: 多种片单来源
- **FR-02.1**: 8 份内置轻量片单（豆瓣高分、诺兰、宫崎骏、新海诚、华语高分、王家卫、迪士尼、双人片单）
- **FR-02.2**: 24 份轮换候选片单（导演/演员/类型各 8 份）
- **FR-02.3**: 自定义电影片单（支持换行、逗号、顿号、分号、竖线分隔）
- **FR-02.4**: 豆瓣 Top250 候选范围选择
- **FR-02.5**: 豆瓣已看导入（直接输入 ID 或浏览器书签导入）
- **FR-02.6**: 豆瓣已看类型筛选（电影/剧集）、评分筛选（1-5 星）、标记年份筛选
- **FR-02.7**: 开始前片单预编辑（手动移除不想排的条目）

#### FR-03: 海报与分享
- **FR-03.1**: 二选一卡片带电影海报（豆瓣原图/Top250 索引/IMDb 备用）
- **FR-03.2**: Top 10 结果海报（9:16，带电影海报 + 二维码）
- **FR-03.3**: Top 100 长榜海报（3:4，纯文字 + 二维码）
- **FR-03.4**: 二维码开关选项
- **FR-03.5**: 复制"猜冠军"文案和同题挑战链接
- **FR-03.6**: 结果导出（TXT / CSV / Markdown / JSON）
- **FR-03.7**: 社交分享文案（朋友圈、小红书、豆瓣）
- **FR-03.8**: 好友 JSON 结果对比（Top 5 重合 + 最大分歧）

#### FR-04: 同好匹配
- **FR-04.1**: 结果页展示冠军相同的同好
- **FR-04.2**: 重榜单按前十重合度筛选同好
- **FR-04.3**: 自愿留下微信号/联系方式

#### FR-05: 首页与增长
- **FR-05.1**: 移动端优先紧凑布局，封面式 hero 区
- **FR-05.2**: 结果示例卡 + 行动标签说明
- **FR-05.3**: 内置片单卡片带适用场景推荐 + 代表海报
- **FR-05.4**: 公开统计展示（已整理名单数、今日整理、平均取舍次数）
- **FR-05.5**: `?list=<id>` 片单链接、`?payload=<data>` 长链接降级、`?import=<db-id>` 导入链接
- **FR-05.6**: 结果页推荐下一份不同气质的内置片单

#### FR-06: 本地进度保存
- **FR-06.1**: 浏览器 localStorage 自动保存排序进度
- **FR-06.2**: 退出后回来可恢复上次进度
- **FR-06.3**: 完成或重置后自动清理草稿

#### FR-07: 后台数据看板
- **FR-07.1**: `?admin=<token>` 私密入口
- **FR-07.2**: 总览指标、漏斗分析、每日趋势
- **FR-07.3**: 片单维度、渠道归因、实验分析
- **FR-07.4**: 内容统计（模板片单冠军 Top3 + 宣传海报生成）
- **FR-07.5**: 轻量片单维护（顺序、轮换历史、新品保护状态）
- **FR-07.6**: 时间范围筛选（7 天/30 天/全部/自定义）
- **FR-07.7**: 百万级事件读取支持

#### FR-08: 国际化
- **FR-08.1**: 页面级中文/English 切换（`?lang=en`）
- **FR-08.2**: 英文首页覆盖 6 份片单（诺兰、宫崎骏、新海诚、迪士尼、双人、豆瓣高分）
- **FR-08.3**: 英文电影标题翻译（170+ 部电影）
- **FR-08.4**: 英文化自定义片单设置、排序状态、二选一卡片、结果页和分享文案

### 2.3 非功能需求

| 编号 | 类别 | 需求 |
|------|------|------|
| NFR-01 | 性能 | 海报本地缓存和预加载，减少选择后等待 |
| NFR-02 | 可用性 | 无 Supabase 时主流程仍可运行（降级模式） |
| NFR-03 | 隐私 | 匿名 session id，不采集姓名/IP/联系方式 |
| NFR-04 | 可扩展性 | 新增 A/B 实验只需在 experiments.py 增加配置块 |
| NFR-05 | 兼容性 | Python 3.10+，支持桌面和移动端浏览器 |
| NFR-06 | 数据安全 | 事件 payload 过滤完整排名和自定义片单 |

---

## 3. 功能清单

### 3.1 核心排序流程

```
用户打开首页
  → 选择片单（内置/自定义/豆瓣 Top250/豆瓣已看）
  → 设置参数（Top N / 完整排序、署名、顺序口令、盲排）
  → 进入 1v1 取舍
    → 每次展示两部电影 + 海报
    → 选择更偏好的一部（点击/键盘 A-D-←-→-1-2）
    → 可选：撤销/略过/暂放
    → 状态栏显示进度、比较次数、预计剩余
  → 排序完成
    → 结果页：冠军电影、最纠结选择、总取舍次数
    → 生成海报（Top 10 带海报 / Top 100 纯文字）
    → 复制分享文案/链接
    → 同好匹配
    → 推荐下一份片单
```

### 3.2 片单来源详细

| 来源 | 数量 | 特点 |
|------|------|------|
| **内置轻量片单** | 8 份 active + 24 份 candidate | 自动轮换，带代表电影海报 |
| **自定义片单** | 无限 | 支持多种分隔符，可保存为分享链接 |
| **豆瓣 Top250** | 250 选 | 从中选择候选范围再排序 |
| **豆瓣已看** | 用户全部已看 | 服务器直接读取 或 浏览器书签导入 |
| **好友 JSON** | 导入对比 | 比较 Top 5 重合和最大分歧 |

### 3.3 内置轻量片单列表 (32 份)

**首页 Active (8+1 份)**:
| ID | 名称 | 类型 | 代表电影 |
|----|------|------|----------|
| douban-top50 | 豆瓣高分片单 | category | 肖申克的救赎 |
| nolan | 诺兰作品序列 | director | 星际穿越 |
| miyazaki | 宫崎骏动画手记 | director | 千与千寻 |
| shinkai | 新海诚动画电影榜 | director | 你的名字。 |
| chinese-highscore | 华语高分片单 | category | 霸王别姬 |
| wong-kar-wai | 王家卫电影榜 | director | 花样年华 |
| disney-animation | 迪士尼动画长片榜 | category | 疯狂动物城 |
| couple-debate | 两个人的观影名单 | category | 泰坦尼克号 |
| spielberg | 斯皮尔伯格电影榜 | director | 辛德勒的名单 |

**轮换候选 (23 份)**:
- **导演** (7): tarantino, denis-villeneuve, david-fincher, bong-joon-ho, hirokazu-koreeda, ang-lee, zhang-yimou
- **演员** (8): leonardo-dicaprio, tom-hanks, cate-blanchett, denzel-washington, tony-leung, maggie-cheung, song-kang-ho, zhou-xun
- **类型** (8): classic-scifi, courtroom, heist-crime, coming-of-age, horror, world-animation, musical, sports

### 3.4 海报来源优先级

```
1. 豆瓣页面原图
2. 豆瓣 Top250 海报索引
3. IMDb 备用源
4. 导入片单附带的原始海报 URL
5. 无海报时: 不显示错误图片，仅显示片名
```

### 3.5 导出格式

| 格式 | 内容 |
|------|------|
| TXT | 纯文本排名列表 |
| CSV | 排名 + 片名表格 |
| Markdown | 格式化排名 + 分隔线 |
| JSON | 完整结构化数据（可导入对比） |

---

## 4. 系统架构设计

### 4.1 总体架构

```
┌─────────────────────┐     ┌──────────────────────────┐
│   用户浏览器         │     │   Streamlit Community     │
│   (移动端优先)       │◄───►│   Cloud (Python 服务)     │
└─────────────────────┘     └──────────┬───────────────┘
                                       │
                                       │ REST API
                                       ▼
                            ┌──────────────────────────┐
                            │   Supabase               │
                            │   ├── analytics_events   │
                            │   ├── challenge_sets     │
                            │   ├── imported_movie_lists│
                            │   ├── peer_match_contacts │
                            │   ├── light_list_catalog  │
                            │   ├── light_list_daily    │
                            │   └── light_list_rotation │
                            └──────────────────────────┘
```

### 4.2 模块结构

```
Sort_FilmsGame/
├── merged_douban_ranker_v3.py        # Streamlit 主入口 (10587 行)
│   ├── 排序状态机
│   ├── 首页 UI
│   ├── 片单选择 UI
│   ├── 二选一取舍 UI
│   ├── 结果页 UI
│   ├── 后台数据看板 UI
│   ├── 海报生成逻辑
│   └── 豆瓣抓取逻辑
│
├── launch_copy.py                    # 首页文案、内置片单定义、分享文案 (226 行)
├── analytics.py                      # Supabase 匿名事件、漏斗分析 (1715 行)
├── experiments.py                    # A/B 实验配置和分桶 (698 行)
├── challenge_store.py                # 片单链接保存/读取/payload 降级 (181 行)
├── import_store.py                   # 豆瓣已看书签导入 (365 行)
├── i18n.py                           # 中英文切换、电影标题翻译 (213 行)
├── light_list_catalog.py             # 32 份轻量片单定义 (426 行)
├── light_list_runtime.py             # 轻量片单状态解析 (48 行)
├── release_history.py                # 版本时间线和版本归因 (298 行)
│
├── components/
│   ├── battle_picker/index.html      # 二选一取舍卡自定义组件
│   ├── copy_button/index.html        # 一键复制组件
│   ├── local_draft/index.html        # 浏览器本地自动保存组件
│   └── bookmarklet_link/index.html   # 豆瓣已看书签导入组件
│
├── supabase_schema.sql               # 完整表结构 + RLS + RPC 函数 (650 行)
├── supabase/migrations/              # 增量迁移脚本
│
├── analytics/
│   ├── sql/                          # 数据质量检查 SQL
│   └── scripts/                      # 分析脚本
│
├── tests/                            # 5 个测试文件
├── docs/                             # 分析文档、版本更新记录、指标合约
├── promo_assets/                     # 宣传截图和生成脚本
└── assets/                           # 首页封面、片单缩略图
```

### 4.3 数据流

```
用户操作
  │
  ├─► track_event(session_id, event_name, payload)
  │     └─► Supabase REST API: POST analytics_events
  │
  ├─► Streamlit session_state
  │     ├── 排序状态 (ranked, candidates, decision_log)
  │     ├── 实验分桶 (experiment_assignment_*)
  │     └── UI 状态 (current_page, draft)
  │
  ├─► localStorage (via local_draft component)
  │     └── 排序进度自动保存/恢复
  │
  └─► Supabase
        ├── challenge_sets (片单链接)
        ├── imported_movie_lists (豆瓣已看导入)
        └── peer_match_contacts (同好联系方式)
```

---

## 5. 核心模块详细设计

### 5.1 merged_douban_ranker_v3.py — 主入口 (10587 行)

这是项目的单一主文件，包含 Streamlit 页面的全部逻辑。

**主要子系统**:

| 子系统 | 职责 |
|--------|------|
| **首页渲染** | hero 区、内置片单卡片网格、豆瓣已看入口、自定义片单、公开统计 |
| **片单选择** | 内置模板选择、自定义输入、豆瓣 Top250 候选、豆瓣已看配置 |
| **排序状态机** | 候选列表、已排序列表、当前比较对、暂放栈、decision_log |
| **二选一 UI** | battle_picker 组件调用、海报加载、键盘快捷键 |
| **结果页** | 冠军展示、最纠结选择、海报预览面板、分享区、同好匹配 |
| **海报生成** | Pillow 图片合成、二维码叠加、Top 10 (1080×1920) / Top 100 (1800×2400) |
| **豆瓣抓取** | Top250 爬取、已看列表读取、海报 URL 提取 |
| **后台看板** | 漏斗分析、趋势图、渠道归因、实验分析、内容统计 |

**海报生成规格**:

| 类型 | 尺寸 | 比例 | 内容 |
|------|------|------|------|
| Top 10 海报 | 1080 × 1920 | 9:16 | 排名 + 电影海报 + 片名 + 二维码 |
| Top 100 海报 | 1800 × 2400 | 3:4 | 纯文字多栏长榜 + 二维码 |
| 片单海报 | 可变 | - | 片单封面 + 标题 |

### 5.2 analytics.py — 数据分析引擎 (1715 行)

**事件体系** (16 个标准事件):

| 事件名 | 中文标签 | 触发时机 |
|--------|----------|----------|
| `visit` | 访问 | 首页打开 |
| `list_opened` | 打开片单 | 点击内置片单卡片 |
| `list_selected` | 选择片单 | 自定义/豆瓣片单配置完成 |
| `sorting_started` | 开始整理 | 进入第一个二选一 |
| `comparison_made` | 完成一次取舍 | 每次二选一选择 |
| `ranking_completed` | 完成名单 | 排序结束 |
| `poster_downloaded` | 下载海报 | 下载结果海报 |
| `share_copied` | 复制分享 | 复制链接/文案 |
| `result_viewed` | 查看结果 | 进入结果页 |
| `qr_viewed` | 查看二维码 | 点击二维码 |
| `home_content_rendered` | 首页内容已渲染 | 首页渲染完成 |
| `experiment_exposed` | 实验真实曝光 | 实验变体实际渲染 |
| `heavy_config_viewed` | 重链路配置页曝光 | 豆瓣已看配置页打开 |
| `default_start_clicked` | 推荐快速开始点击 | 点击推荐 Top 10 |
| `sorting_scope_reduced` | 排序目标缩短 | 中途缩短为 Top 10 |
| `result_share_prompt_clicked` | 结果页快捷分享点击 | 点击快捷分享 |

**漏斗定义**:
```
主漏斗: visit → list_opened/list_selected → sorting_started → ranking_completed
轻量片单漏斗: list_opened → sorting_started → ranking_completed
重链路漏斗: list_selected → sorting_started → ranking_completed → share_copied/poster_downloaded
首页加载诊断: visit → home_content_rendered → list_opened/list_selected/sorting_started
```

**后台看板 Tab 结构**:
| Tab | 内容 |
|-----|------|
| 总览 | 核心指标卡片 + 自动洞察 |
| 漏斗分析 | 4 条漏斗 + 流失诊断 |
| 每日趋势 | 访问/开始/完成/分享趋势图 |
| 片单维度 | 按 list_id/template_id/mode 分组 |
| 渠道归因 | source/utm_source/utm_medium/utm_campaign |
| 实验分析 | 已停止/进行中两栏 |
| 内容统计 | 模板片单冠军 Top3 + 宣传海报 |
| 轻量片单维护 | 顺序/轮换/保护状态 |
| 行为质量 | 取舍次数分布、Top K 设置 |
| 最近事件 | 实时事件表格 + CSV 导出 |
| 版本分析 | 分版本指标对比 |

### 5.3 experiments.py — A/B 实验框架 (698 行)

**分桶机制**:
```
1. session_id + experiment_id → SHA256 → traffic_bucket (0~1)
2. traffic_bucket < traffic_allocation → 进入实验
3. session_id + experiment_id → SHA256 → variant_bucket (0~1)
4. variant_bucket → 按权重选择变体
```

**支持的实验变量类型**:
- hero_title / hero_subtitle / hero_tagline (首屏文案)
- card_action_text / card_recommendation_prefix (卡片 CTA)
- collect_kicker / collect_title / collect_cta_text (豆瓣已看入口)
- show_zero_decision_start / show_duel_teaser (首页新模块)
- show_scope_rescue / rescue_after_comparisons (排序中救援)
- show_result_share_bundle / share_bundle_cta (结果页分享)
- default_top_k (默认 Top N)
- progress_hint_style (进度文案风格)

**实验生命周期**:
```
active → 数据收集 → 分析决策 → paused + decision_variant_id
```

### 5.4 challenge_store.py — 片单链接管理 (181 行)

**Challenge 数据结构**:
```python
@dataclass
class Challenge:
    id: str              # "mv-{sha1[:10]}" 或 template id
    theme: str           # 片单主题名
    mode: str            # "自备片单" 等
    items: List[str]     # 去重后的电影列表
    top_k: Optional[int] # Top N 设置
    seed_text: str       # 顺序口令
    source: str          # "builtin" / "shared" / "payload"
    template_id: str     # 内置模板 ID
```

**链接策略**:
1. Supabase 可用 → 保存到 challenge_sets → `?list=<id>`
2. Supabase 不可用 → zlib 压缩 + base64 编码 → `?payload=<data>` (长链接降级)

### 5.5 import_store.py — 豆瓣已看导入 (365 行)

**导入数据结构**:
```python
@dataclass
class ImportedMovieList:
    id: str                          # "db-{random_hex}"
    entries: List[Dict[str, Any]]    # 完整条目列表
    items: List[str]                 # 片名列表
    poster_url_map: Dict[str, str]   # 片名→海报 URL
    rating_map: Dict[str, int]       # 片名→评分(1-5)
    rated_at_map: Dict[str, str]     # 片名→标记日期(YYYY-MM-DD)
    media_type_map: Dict[str, str]   # 片名→类型(movie/series/unknown)
    has_rating_data: bool
    has_rated_at_data: bool
    has_media_type_data: bool
```

**浏览器书签工作流**:
```
1. 用户在应用内获取书签按钮（javascript: URL）
2. 拖拽到浏览器书签栏
3. 打开自己的豆瓣"看过"页面
4. 点击书签栏按钮
5. 书签脚本在用户浏览器中:
   a. 分页读取电影(type=movie) 和 剧集(type=tv)
   b. 解析标题、海报、评分、标记日期、条目类型
   c. POST 到 Supabase imported_movie_lists
   d. 生成 db- 开头的片单 ID
   e. 跳转回应用 ?import=<db-id>
6. 其他设备输入同一 ID 继续整理
```

---

## 6. 前端组件与交互设计

### 6.1 自定义 Streamlit 组件

项目包含 4 个自定义 HTML 组件，通过 `streamlit.components.v1` 注册：

#### 6.1.1 battle_picker — 二选一取舍卡

**文件**: `components/battle_picker/index.html` (247 行)

**功能**: 展示两部电影的对比卡片，支持点击选择和键盘快捷键

**视觉设计**:
```
┌─────────────────────────────────────────────┐
│  ┌──────────────────┐  ┌──────────────────┐ │
│  │ 选项 A           │  │ 选项 B           │ │
│  │ 肖申克的救赎      │  │ 霸王别姬         │ │
│  │ ┌──────────────┐ │  │ ┌──────────────┐ │ │
│  │ │              │ │  │ │              │ │ │
│  │ │   电影海报    │ │  │ │   电影海报    │ │ │
│  │ │              │ │  │ │              │ │ │
│  │ └──────────────┘ │  │ └──────────────┘ │ │
│  │ A          A/←   │  │ B          D/→   │ │
│  └──────────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────┘
```

**交互**:
- 点击卡片选择
- 键盘: A/←/1 = 左侧, D/→/2 = 右侧
- hover: 边框变色 + 微上移 + 阴影
- 移动端: 自适应布局，海报区域缩小

**技术细节**:
- 通过 `postMessage` 与 Streamlit 通信
- 海报加载失败时显示"暂无真实海报，只按片名判断"
- 动态计算帧高度避免滚动

#### 6.1.2 copy_button — 一键复制

**文件**: `components/copy_button/index.html` (127 行)

**功能**: 带状态反馈的复制按钮

**视觉设计**:
```
┌─────────────────────────────────────────┐
│ [输入框: 可复制链接文本............] [复制] │
│ 已复制                                   │
└─────────────────────────────────────────┘
```

**技术**: 优先 `navigator.clipboard.writeText()`，降级 `document.execCommand("copy")`

#### 6.1.3 local_draft — 本地自动保存

**文件**: `components/local_draft/index.html` (73 行)

**功能**: 零 UI 的 localStorage 读写桥接

**操作**: `load` / `save` / `clear` 三种 action，通过 Streamlit component value 回传

#### 6.1.4 bookmarklet_link — 书签导入按钮

**文件**: `components/bookmarklet_link/index.html` (107 行)

**功能**: 可拖拽的书签链接

**视觉设计**:
```
┌─────────────────────────────────────┐
│ [导入我的豆瓣已看] ← 可拖拽到书签栏   │
│ 拖到浏览器书签栏；保存后应显示这个名   │
│ 字，网址以 javascript: 开头。         │
└─────────────────────────────────────┘
```

### 6.2 页面状态机

```
┌────────┐   选择片单   ┌──────────┐   开始排序   ┌──────────┐
│  首页  │─────────────►│  准备页  │─────────────►│  排序中  │
└────────┘              └──────────┘              └──────────┘
                                                     │
                                                     │ 完成
                                                     ▼
                                                ┌──────────┐
                                                │  结果页  │
                                                └──────────┘
                                                     │
                                                     │ 推荐下一份
                                                     ▼
                                                ┌──────────┐
                                                │  首页    │
                                                └──────────┘
```

**后门入口**: `?admin=<token>` → 后台数据看板

---

## 7. 数据模型设计

### 7.1 Supabase 表结构

| 表 | 用途 | 关键字段 | RLS |
|----|------|----------|-----|
| `challenge_sets` | 片单链接 | id, theme, items(jsonb), top_k, seed_text | 匿名可读/可插入(2-300条) |
| `analytics_events` | 匿名事件 | event_name, session_id, payload(jsonb) | 匿名可插入(白名单事件)/可读 |
| `imported_movie_lists` | 豆瓣已看导入 | id, items(jsonb), item_count, expires_at | 匿名可插入(db-开头)/过期前可读 |
| `peer_match_contacts` | 同好联系方式 | contact, champion, top_items(jsonb) | 匿名可插入(allow_display=true)/可读 |
| `light_list_catalog_state` | 片单目录状态 | template_id, status, display_rank | 完全限制(仅 RPC) |
| `light_list_daily_stats` | 片单日统计 | metric_date, template_id, unique_sessions | 完全限制(仅 RPC) |
| `light_list_rotation_runs` | 轮换记录 | run_date, removed_ids, added_ids | 完全限制(仅 RPC) |

### 7.2 RPC 函数

| 函数 | 用途 |
|------|------|
| `get_home_light_list_roster()` | 计算并返回首页 9 份片单顺序（含日统计计算 + 自动轮换） |
| `read_home_light_list_roster()` | 只读返回当前首页片单顺序（不触发计算） |
| `get_light_list_rotation_history()` | 返回轮换历史记录 |

### 7.3 索引策略

- `analytics_events`: created_at DESC, event_name, challenge_id, template_id
- `light_list_catalog_state`: (status, display_rank)
- `light_list_daily_stats`: (template_id, metric_date DESC)
- `peer_match_contacts`: (list_kind, list_key, champion, created_at DESC), (list_kind, created_at DESC)

---

## 8. A/B 实验框架

### 8.1 当前实验状态 (v3.10)

**已停止实验 (14 个)**:

| 实验 ID | 收口版本 | 决策 |
|---------|----------|------|
| home_layout_order_v1 | builtin_first | 快速片单前置胜出 |
| builtin_card_poster_v1 | poster | 海报卡片胜出 |
| post_render_hero_value_v1 | outcome_preview | 结果预览表达胜出 |
| quick_list_card_framing_v1 | control | 原推荐理由胜出 |
| douban_collect_entry_cta_v1 | control | 原总榜叙事胜出 |
| home_zero_decision_start_v1 | control | 无零决策入口胜出 |
| home_duel_teaser_v1 | control | 无试看题胜出 |
| home_featured_quick_start_v1 | control | 无直达卡胜出 |
| heavy_default_start_v1 | recommended_top10 | 推荐 Top 10 胜出 |
| sorting_scope_rescue_v1 | offer_top10 | Top 10 救援胜出 |
| result_share_bundle_v1 | quick_share_bundle | 一键分享包胜出 |
| homepage_cta_v1 | - | 已停止 |

**进行中实验 (5 个)**:

| 实验 ID | 主指标 | 变量 |
|---------|--------|------|
| home_card_cta_copy_v1 | 内置卡打开率 | CTA 文案: "开始整理" vs "先排 Top N" |
| custom_list_scope_hint_v1 | 开始率 | 长片单是否显示 Top 10 工作量对照 |
| douban_collect_scope_default_v1 | 开始率 | 豆瓣已看默认 Top 20 vs Top 10 |
| sorting_progress_framing_v1 | 完成率 | 进度文案: 中性 vs 结果导向 |
| result_share_cta_copy_v1 | 分享/海报率 | 分享 CTA: "生成 Top 10 海报" vs "生成海报，发给同好猜冠军" |

### 8.2 实验护栏

- 每个实验必须声明 `primary_metric`
- 使用 `experiment_exposed` 作为严格曝光分母
- assigned variant sessions 仅作诊断
- 复盘报告声明适用版本、日期窗口、统计单位

---

## 9. 轻量片单自动维护系统

### 9.1 运行机制

```
北京时间 03:00 作为统计日切边界
  │
  ▼
03:00 后首次有效首页访问
  │
  ├─ 补算昨日 light_list_daily_stats
  ├─ 按昨日独立 session 降序排序 9 份 active
  ├─ 固化 display_rank 到 light_list_catalog_state
  │
  ▼
每满 3 个统计日
  │
  ├─ 下架近 3 日访问最少的 3 份 (21 天冷却)
  ├─ 从候选池各取导演/演员/类型 1 份
  ├─ 新上架置顶保护 24 小时
  ├─ 记录轮换到 light_list_rotation_runs
  │
  ▼
多级降级:
  1. get_home_light_list_roster() RPC
  2. Supabase 状态表直接读取
  3. 静态 9 份默认列表
```

### 9.2 轮换候选池

| 类型 | 数量 | 示例 |
|------|------|------|
| 导演 | 8 | 斯皮尔伯格、昆汀、维伦纽瓦、芬奇、奉俊昊、是枝裕和、李安、张艺谋 |
| 演员 | 8 | 莱昂纳多、汤姆·汉克斯、布兰切特、丹泽尔、梁朝伟、张曼玉、宋康昊、周迅 |
| 类型 | 8 | 科幻经典、法庭、犯罪、成长、恐怖、世界动画、歌舞、体育 |

### 9.3 缩略图系统

- 32 份片单全部绑定 136×192 WebP 代表电影海报
- 存储路径: `assets/builtin_list_thumbnails/<template_id>.webp`
- 运行时只读仓库静态资源，不联网抓图
- 生成脚本: `promo_assets/generate_builtin_list_thumbnails.py`

---

## 10. 国际化 (i18n)

### 10.1 实现方案

- URL 参数 `?lang=en` 控制语言状态
- 写入 Streamlit session_state，链接中持续保留
- `i18n.py` 提供翻译函数

### 10.2 覆盖范围

| 模块 | 中文 | 英文 |
|------|------|------|
| 首页 hero | 完整 | 完整 |
| 内置片单 (6 份) | 完整 | 完整（名称/主题/tagline/推荐语） |
| 自定义片单设置 | 完整 | 完整 |
| 排序状态栏 | 完整 | 完整 |
| 二选一卡片 | 完整 | 完整 |
| 结果页 | 完整 | 完整 |
| 分享文案 | 完整 | 完整 |
| 电影标题 | 全部 | 170+ 部已翻译 |
| 豆瓣已看导入 | 完整 | 仅中文（依赖中文站点） |
| 后台看板 | 完整 | 仅中文 |

---

## 11. 数据分析与后台看板

### 11.1 公开指标

首页可见的匿名统计:
- 已整理名单数
- 今日整理人数
- 平均取舍次数

### 11.2 后台看板 v2 功能矩阵

| 分析维度 | 具体能力 |
|----------|----------|
| **总览** | 访问/session/开始/完成/分享/海报 + 率指标 |
| **漏斗** | 4 条标准漏斗 + 自动流失诊断 + 产品洞察文案 |
| **趋势** | 每日访问/开始/完成/分享折线图 |
| **片单** | 按 list_id/template_id/mode 分组统计 |
| **渠道** | source/utm_source/utm_medium/utm_campaign |
| **实验** | 已停止/进行中两栏，曝光后行动率/开始率/完成率/分享率 |
| **内容** | 模板片单冠军 Top3 + 宣传海报生成 |
| **维护** | 轻量片单顺序/轮换历史/新品保护 |
| **行为** | 取舍次数分布(P50/P75/P90)、Top K 设置、暂放使用率 |
| **版本** | 分版本指标对比、相邻版本变化 |
| **事件** | 实时事件表格 + CSV 导出 |

### 11.3 隐私边界

- 只使用随机 session id，不要求登录
- 不记录姓名、IP、联系方式
- 不记录完整排名（只保存完成结果前 10 名）
- 不记录完整自定义片单
- 历史事件名自动兼容映射

---

## 12. 前端美术与视觉设计

### 12.1 整体设计语言

**设计风格**: 温暖、文艺、电影质感

| 属性 | 值 |
|------|-----|
| 主色调 | 暖棕色系 (#8a4f3d, #9b6a58) |
| 背景色 | 暖白 (#fffdf9, #fffaf4) |
| 文字色 | 深灰 (#1f2328) |
| 次要文字 | 暖灰 (#6f665d) |
| 卡片边框 | 暖米 (#e7e1d8, #d8d1c6) |
| 字体 | system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif |
| 圆角 | 8px (卡片), 6px (海报), 10px (弹窗) |

### 12.2 首页视觉设计

**Hero 区**:
```
┌─────────────────────────────────────┐
│                                     │
│    慢慢排出你的电影审美名单            │
│    不必一次想清全部顺序，              │
│    只在两部电影之间作一次取舍。        │
│                                     │
│    几分钟后，留下一份更接近            │
│    自己的观影片单。                    │
│                                     │
│    ┌────┐ ┌────┐ ┌────┐ ┌────┐     │
│    │Top │ │冠军│ │结果│ │同题│     │
│    │榜单│ │电影│ │海报│ │挑战│     │
│    └────┘ └────┘ └────┘ └────┘     │
│                                     │
└─────────────────────────────────────┘
```

**内置片单卡片网格** (3 列布局):
```
┌──────────────────────────────────────────┐
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ 🎬海报  │ │ 🎬海报  │ │ 🎬海报  │    │
│ │ 豆瓣高分 │ │ 诺兰    │ │ 宫崎骏  │    │
│ │ 片单    │ │ 作品    │ │ 动画    │    │
│ │ 50部    │ │ 12部    │ │ 11部    │    │
│ │ Top 10  │ │ Top 8   │ │ Top 8   │    │
│ │ 开始整理 │ │ 开始整理 │ │ 开始整理 │    │
│ └─────────┘ └─────────┘ └─────────┘    │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ 新海诚  │ │ 华语高分 │ │ 王家卫  │    │
│ │ ...     │ │ ...     │ │ ...     │    │
│ └─────────┘ └─────────┘ └─────────┘    │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ 迪士尼  │ │ 双人    │ │ 斯皮尔  │    │
│ │ ...     │ │ 片单    │ │ 伯格    │    │
│ └─────────┘ └─────────┘ └─────────┘    │
└──────────────────────────────────────────┘
```

**卡片设计规范**:
- 海报区域: 136×192 WebP 缩略图
- 标题: 粗体 (font-weight: 820)
- 推荐语: 小号灰色
- 元数据: "50 部电影 · 前 10 名"
- CTA: 暖棕色按钮 "开始整理"
- 新品标记: 24 小时保护期内带"新"标签

### 12.3 二选一取舍页设计

**桌面布局** (双列):
```
┌────────────────────────────────────────────────┐
│ 状态栏: 我的宫崎骏动画名单 | 已取舍 3 次 | 预计剩余 15 次 │
│────────────────────────────────────────────────│
│ ┌──────────────────┐  ┌──────────────────┐    │
│ │ 选项 A            │  │ 选项 B            │    │
│ │ 千与千寻          │  │ 龙猫              │    │
│ │                   │  │                   │    │
│ │ ┌──────────────┐ │  │ ┌──────────────┐ │    │
│ │ │              │ │  │ │              │ │    │
│ │ │  千与千寻海报 │ │  │ │   龙猫海报   │ │    │
│ │ │              │ │  │ │              │ │    │
│ │ └──────────────┘ │  │ └──────────────┘ │    │
│ │ A           A/←  │  │ B           D/→  │    │
│ └──────────────────┘  └──────────────────┘    │
│                                                │
│ [撤销] [略过] [暂放] [查看临时名单]              │
└────────────────────────────────────────────────┘
```

**移动端布局** (自适应):
- 卡片缩小，间距减小
- 海报区域高度: `min(34vh, 230px)`
- 标题字号: 16px
- 快捷键标签隐藏

### 12.4 结果页设计

```
┌──────────────────────────────────────────────────┐
│ 完成页头                                          │
│ 片单: 我的宫崎骏动画名单                           │
│ 🏆 冠军: 千与千寻                                 │
│ 🔥 最纠结: 千与千寻 vs 龙猫                       │
│ 总取舍: 15 次                                     │
│──────────────────────────────────────────────────│
│ ┌─────────────────┐ ┌─────────────────────────┐ │
│ │                 │ │ 行动面板                  │ │
│ │   海报预览      │ │ [生成 Top 10 海报]        │ │
│ │   (9:16 竖版)   │ │ [生成 Top 100 长榜]       │ │
│ │                 │ │ [复制链接]                │ │
│ │                 │ │ [复制猜冠军文案]           │ │
│ │                 │ │                           │ │
│ │                 │ │ 同好匹配                  │ │
│ │                 │ │ 推荐好友                  │ │
│ └─────────────────┘ └─────────────────────────┘ │
│──────────────────────────────────────────────────│
│ 推荐下一份: 诺兰作品序列                           │
└──────────────────────────────────────────────────┘
```

### 12.5 海报生成设计

**Top 10 海报 (1080×1920, 9:16)**:
```
┌────────────────────────┐
│  电影审美名单            │
│  我的宫崎骏动画名单      │
│────────────────────────│
│  1. 千与千寻            │
│  ┌────┐                │
│  │海报│ 千与千寻        │
│  └────┘                │
│────────────────────────│
│  2. 龙猫               │
│  ┌────┐                │
│  │海报│ 龙猫           │
│  └────┘                │
│  ...                   │
│────────────────────────│
│  [二维码]  sortfilmsgame│
│  git.streamlit.app     │
└────────────────────────┘
```

**Top 100 海报 (1800×2400, 3:4)**:
```
┌──────────────────────────────┐
│  电影审美名单                  │
│  我的豆瓣高分电影名单          │
│──────────────────────────────│
│  1. 肖申克的救赎  │ 51. XX    │
│  2. 霸王别姬      │ 52. XX    │
│  3. 阿甘正传      │ 53. XX    │
│  ...              │ ...       │
│  50. XX           │ 100. XX   │
│──────────────────────────────│
│  [二维码]  sortfilmsgame      │
└──────────────────────────────┘
```

### 12.6 后台看板设计

**看板主题**: 与主应用一致的暖色调
- 指标卡片: 白色背景 + 粗体数字
- 图表: 使用 Streamlit 内置 st.metric / st.plotly_chart
- 表格: pandas DataFrame + st.dataframe
- 漏斗: 自定义 HTML/CSS 漏斗图

### 12.7 响应式设计

| 断点 | 布局调整 |
|------|----------|
| **>820px** | 桌面: 双列二选一、3 列片单网格 |
| **≤820px** | 平板: 双列二选一(缩小)、2 列片单网格 |
| **≤390px** | 手机: 进一步缩小间距和字号 |

### 12.8 宣传素材

| 素材 | 文件 | 用途 |
|------|------|------|
| 宫崎骏二选一界面 | `promo_assets/01_two_choice_miyazaki.png` | 产品展示 |
| 宫崎骏结果海报 | `promo_assets/02_result_miyazaki_poster.png` | 产品展示 |
| 豆瓣已看二选一 | `promo_assets/03_douban_collect_two_choice.png` | 功能展示 |
| 豆瓣已看结果海报 | `promo_assets/04_douban_collect_result_poster.png` | 功能展示 |
| 移动端首页截图 | `promo_assets/live_screens/mobile_home.png` | 实机截图 |
| 社交文案包 | `promo_assets/social_copy_pack.md` | 小红书/豆瓣发布文案 |
| 冠军榜海报预览 | `promo_assets/content_stats_poster_preview_v3_1.png` | 内容统计展示 |

---

## 13. 隐私与安全设计

### 13.1 数据隐私

| 原则 | 实现 |
|------|------|
| 匿名优先 | 只使用随机 session id，无登录 |
| 最小采集 | 不记录姓名、IP、联系方式、完整 UA |
| 排名脱敏 | 只保存完成结果前 10 名，不保存完整排名 |
| 片单脱敏 | 不保存完整自定义片单到事件 payload |
| 过期清理 | 豆瓣已看导入默认 7 天过期 |

### 13.2 Supabase RLS 策略

| 表 | 插入限制 | 读取限制 |
|----|----------|----------|
| challenge_sets | items 数组 2-300 条 | 公开可读 |
| analytics_events | 白名单事件名 | 公开可读 |
| imported_movie_lists | id 格式 db-[a-z0-9]{12,32}, 2-1500 条 | 过期前可读 |
| peer_match_contacts | allow_display=true, contact 2-80 字符 | allow_display=true |
| light_list_* | 完全限制(仅 RPC) | 完全限制(仅 RPC) |

### 13.3 后台访问控制

- 通过 `?admin=<ADMIN_DASHBOARD_TOKEN>` URL 参数认证
- Token 在 Streamlit Secrets 中配置
- 无持久化登录状态

---

## 14. 测试策略

### 14.1 测试文件

| 文件 | 覆盖范围 |
|------|----------|
| `tests/test_abtest_v38.py` | v3.8 A/B 实验配置和事件修复 |
| `tests/test_abtest_v310.py` | v3.10 新实验配置验证 |
| `tests/test_i18n_v39.py` | 国际化翻译函数 |
| `tests/test_result_posters.py` | 结果海报生成逻辑 |
| `tests/test_light_list_catalog.py` | 轻量片单目录和轮换 |

### 14.2 语法检查

```bash
python -m py_compile merged_douban_ranker_v3.py analytics.py experiments.py ...
python -m unittest discover -s tests -v
```

---

## 15. 部署与运维

### 15.1 部署步骤

1. 推送代码到 GitHub
2. Streamlit Community Cloud 新建应用
3. 入口文件: `merged_douban_ranker_v3.py`
4. 配置 Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUBLIC_APP_URL`, `ADMIN_DASHBOARD_TOKEN`
5. 确认 `packages.txt` 包含 `fonts-noto-cjk`
6. 执行 Supabase schema 和迁移脚本

### 15.2 Supabase 迁移

| 迁移 | 用途 |
|------|------|
| `supabase_schema.sql` | 初始表结构 + RLS + RPC |
| `20260629_light_list_auto_rotation.sql` | v3.6 轻量片单自动轮换 |
| `20260724_abtest_v38_events.sql` | v3.8 实验事件 policy 修复 |

### 15.3 降级策略

```
Supabase 不可用时:
  ├─ 公开统计 → 隐藏
  ├─ 片单链接 → 长链接 payload 降级
  ├─ 豆瓣已看导入 → 不可用
  ├─ 同好匹配 → 不可用
  ├─ 后台看板 → 不可用
  └─ 主排序流程 → 正常运行
```

---

## 16. 版本演化历史

| 版本 | 日期 | 核心变化 |
|------|------|----------|
| v0.1 | 2026-04-22 | 原始排序原型 |
| v0.2 | 2026-04-23 | 双模式电影版 |
| v0.3 | 2026-05-26 | 工程化和 v3 入口 |
| v0.4 | 2026-05-26~27 | 发布前体验增强（Top N、盲排、撤销、海报等） |
| v1.0 | 2026-06-01 | 公开发布版（Supabase、片单链接、后台看板） |
| v1.1~1.2 | 2026-06-01~02 | 海报/二维码/移动端/首页优化 |
| v1.3 | 2026-06-02 | 豆瓣已看总榜 |
| v1.4 | 2026-06-03 | 浏览器本地自动保存 |
| v1.5 | 2026-06-05 | 豆瓣已看书签导入 |
| v1.6 | 2026-06-07 | 评分筛选 + README 重写 |
| v1.7 | 2026-06-08 | 后台数据看板 v1 |
| v1.8 | 2026-06-09 | 标记年份筛选 |
| v1.9 | 2026-06-11 | 首页与结果页转化优化 |
| v2.0 | 2026-06-12 | 后台看板 v2 + A/B 实验基础设施 |
| v2.1~2.4 | 2026-06-13 | 新版埋点、片单、首页加载、版本分析 |
| v2.5~2.6 | 2026-06-13~14 | 同好联系方式、好友推荐入口 |
| v2.7 | 2026-06-17 | 类型筛选 + 片单预编辑 |
| v2.8 | 2026-06-17 | 百万事件读取 |
| v2.9~2.10 | 2026-06-23 | 导入教程入口、轻量片单海报实验 |
| v3.1~3.2 | 2026-06-24~25 | 内容统计、实验收口 |
| v3.3 | - | Analytics metric contract cleanup |
| v3.4~3.5 | 2026-06-27 | 渲染后行动率实验(5 个) |
| v3.6 | 2026-06-29 | 轻量片单自动排序与轮换 |
| v3.7 | 2026-07-03 | Top 10 / Top 100 结果海报 |
| v3.8 | 2026-07-24 | 漏斗修复 + 新一轮 A/B 实验 |
| v3.9 | 2026-07-27 | 中英文切换 |
| v3.10 | 2026-08-05 | A/B 实验收口 + 下一轮漏斗测试 |

---

> 本文档基于 Sort_FilmsGame v3.10 源码自动生成。
