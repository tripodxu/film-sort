> ⚠️ **【已过时 · 归档】**（2026-09-22 归档）内容停留在归档时点，**请勿据此操作**；现行结论见 `PLAN-ui-refresh.md`（§10）与各活跃文档。主体已实施并上线，实现偏离记录见 §十二（原文保留）。

# 社区功能计划：查看分享 + 广场

> 状态：**主体已实施** —— 广场列表 / 帖子详情 / 发布 / 编辑 / 删除（含隐藏恢复）/ 点赞 / 留言与嵌套回复 / 分享查看页 / 人工调整排序均已上线。
> 少量细节与本文最初设计不一致（本文写错或最终换了实现），逐条记录在 §十二。

---

## 一、功能概览

### 栏目1：查看他人分享的榜单和画像

分享链接的两种入口，行为不同：

- **直接打开链接**（从聊天/邮件/浏览器点击）→ 进入 `/share/:code` **查看页面**，展示对方榜单/画像内容（含批注），再决定下一步操作（与我比较 / 用对方榜单排序 / 复制分享链接）；点赞收藏只在广场帖子详情页提供
- **在「相遇」页面粘贴链接**（已有功能）→ **直接进入比较界面**，行为不变

### 栏目2：广场（Plaza）

公共信息流：浏览不需要登录，登录后可以把自己的榜单/画像发布到广场，其他用户可以浏览、点赞、留言、使用对方榜单排序或发起比较。广场是社区互动的入口（发布/点赞/留言需登录，见 §八）。

---

## 二、数据模型

### 2.1 广场帖子（plaza_posts）

```sql
CREATE TABLE plaza_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  post_type TEXT NOT NULL,          -- 'ranking' | 'profile'
  kind TEXT,                         -- 媒介类型（ranking 时有值）
  collection_title TEXT NOT NULL,
  items TEXT NOT NULL,               -- JSON: RankedArtwork[] 或 RankingExport[]
  notes TEXT,                        -- JSON: Record<string, string> 批注
  item_count INTEGER,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

> 落地时另加了 `description TEXT`（`0012_plaza_description.sql`），用于帖子的一句话描述。

### 2.2 点赞（plaza_likes）

```sql
CREATE TABLE plaza_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);
```

### 2.3 留言（plaza_comments）

```sql
CREATE TABLE plaza_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  content TEXT NOT NULL,             -- 最长 500 字符
  created_at TEXT DEFAULT (datetime('now'))
);
```

> 落地时另加了 `parent_id INTEGER REFERENCES plaza_comments(id)`（`0014_comment_replies.sql`），用于嵌套回复。

---

## 三、API 设计

### 3.1 广场帖子

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plaza/posts?page=&limit=&kind=&sort=&q=` | 获取广场帖子列表（分页、可按媒介筛选、可按最新/最热排序、可搜索标题与昵称） |
| GET | `/api/plaza/posts/:id` | 获取单个帖子详情（含留言；海报地址走旁路数组 `posterUrls`） |
| POST | `/api/plaza/posts` | 发布帖子到广场（需登录） |
| PUT | `/api/plaza/posts/:id` | 编辑自己的帖子（标题/描述/批注/排序，需登录 + 所有权） |
| DELETE | `/api/plaza/posts/:id` | 删除自己的帖子（需登录 + 所有权） |
| GET | `/api/plaza/posts/:id/edits` | 编辑历史（仅作者可见；`0019_plaza_post_edits.sql`） |
| POST | `/api/plaza/posts/:id/visibility` | 作者隐藏/恢复自己的帖子 |
| POST | `/api/plaza/posts/:id/like` | 点赞/取消点赞（需登录） |
| GET | `/api/plaza/posts/:id/comments` | 获取留言列表 |
| POST | `/api/plaza/posts/:id/comments` | 发表留言（需登录，可带 `parent_id` 回复） |
| DELETE | `/api/comments/:id` | 删除自己的留言 |

> 全部实现在 `worker/plaza.ts` 的 `plazaRoute()` 内，由 `worker/index.ts` 统一挂在 `/api/plaza/` 与 `/api/comments/` 前缀上。
> 另有管理员路由 `/api/admin/plaza/*`（`adminPlazaRoute()`，见 §八）。

### 3.2 查看分享（改造现有）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/share/:code` | 返回 profile + notes（已有，扩展 notes 字段） |

分享链接查看页面不再是直接跳入比较，而是先进入查看模式，展示内容后提供操作按钮。

---

## 四、前端路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 清单 | 首页（现有） |
| `/catalog/*` | 排序流程 | 现有 |
| `/encounter` | 相遇 | 现有 |
| `/myself` | 我的文化索引 | 现有 |
| `/share/:code` | 查看分享 | **新增**：查看他人分享的榜单/画像 |
| `/plaza` | 广场 | **新增**：公共信息流 |
| `/plaza/:id` | 广场帖子详情 | **新增**：单个帖子详情 + 留言 |

---

## 五、页面设计

### 5.1 查看分享页（`/share/:code`）

```
┌─────────────────────────────────────────────┐
│ ← 返回                ART/RANK              │
├─────────────────────────────────────────────┤
│                                             │
│  [海报网格/前三名]                           │
│                                             │
│  榜单名称 / 画像名称                         │
│  by 用户昵称  ·  2025-01-15                 │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 01  🥇 作品A / 导演A               │    │
│  │     [批注: 我对这部作品的看法...]    │    │
│  │ 02  🥈 作品B / 导演B               │    │
│  │ 03  🥉 作品C / 导演C               │    │
│  │ ...                                │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ❤️ 12 赞   💬 3 条留言                     │
│                                             │
│  ┌──────────────┐  ┌──────────────┐         │
│  │ 用此榜单排序  │  │ 与我比较     │         │
│  └──────────────┘  └──────────────┘         │
│                                             │
│  💬 留言区                                  │
│  ┌─────────────────────────────────────┐    │
│  │ 用户A: 很棒的榜单！                 │    │
│  │ 用户B: 和我的品味很像               │    │
│  └─────────────────────────────────────┘    │
│  [输入留言...]                              │
└─────────────────────────────────────────────┘
```

> 实现说明：`ShareView`（`src/views/ShareView.tsx`）实际只提供「用此榜单排序」「与我比较」「复制分享链接」三个操作，**没有点赞与留言区**——点赞/留言只在广场帖子详情页（`PlazaPostView`）提供。上方草图中的 ❤️/💬 与留言区未按此实现。

### 5.2 广场页（`/plaza`）

```
┌─────────────────────────────────────────────┐
│ ← 返回    广场    ART/RANK                  │
├─────────────────────────────────────────────┤
│                                             │
│  [筛选: 全部 | 电影 | 书籍 | 音乐 | 其他]    │
│  [排序: 最新 | 最热]                         │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  [前三名海报竖排]  榜单名称          │    │
│  │  by 用户A  ·  电影  ·  ❤️ 24  💬 5  │    │
│  │  "这是我的华语电影审美坐标"           │    │
│  │  [用此榜单排序] [比较] [查看详情]    │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  [画像缩略图]  多维度文化索引         │    │
│  │  by 用户B  ·  4个领域  ·  ❤️ 18     │    │
│  │  [查看详情] [与我比较]               │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [发布到广场] ← 需登录                       │
└─────────────────────────────────────────────┘
```

> 实现说明：卡片上的操作最终做成了图标按钮——作者看到「管理我的帖子」，所有人看到「用此榜单排序」，点击卡片本身进入详情（等价于「查看详情」）。卡片上没有独立的「比较」按钮（比较在详情页里）。工具条另加了搜索框与 2/3/4 列数选择器（列数持久化在 `localStorage`）。

### 5.3 发布到广场

在「我的文化索引」页面，每个榜单和画像旁增加「发布到广场」按钮：
- 仅登录用户可见
- 点击后弹出确认弹窗，可选择附带批注
- 发布成功后把帖子 id 记入 `localStorage` 的 `art-rank:plaza-links`（键为 `kind|collectionTitle` / `profile|profileId`）；此后作品变更时页面会出现「同步到广场」，可把改动推回帖子

> 与原设计的差异：「按钮变为『已发布』并可取消」**未实现**。取消发布需要到帖子详情页用「隐藏帖子」或「删除帖子」。

---

## 六、前端组件规划

### 新增视图

| 组件 | 文件 | 说明 |
|------|------|------|
| ShareView | `src/views/ShareView.tsx` | 查看分享页 |
| PlazaView | `src/views/PlazaView.tsx` | 广场列表页 |
| PlazaPostView | `src/views/PlazaPostView.tsx` | 广场帖子详情 + 留言 |

### 新增组件

| 组件 | 文件 | 说明 |
|------|------|------|
| PlazaCard | `src/components/PlazaCard.tsx` | 广场帖子卡片（海报+标题+互动） |
| CommentSection | `src/components/CommentSection.tsx` | 留言区组件 |
| PublishModal | `src/components/PublishModal.tsx` | 发布到广场弹窗 |
| SharePageLayout | `src/components/SharePageLayout.tsx` | 分享查看页布局 |
| ReorderableList | `src/components/ReorderableList.tsx` | 拖拽排序列表（HTML5 DnD + touch） |
| EditPostModal | `src/components/EditPostModal.tsx` | 编辑广场帖子弹窗 |

> **实际未拆分为独立文件**（功能都已实现，只是内联在视图里）：
> 广场卡片在 `src/views/PlazaView.tsx`；留言区与编辑界面在 `src/views/PlazaPostView.tsx`；
> 发布弹窗在 `src/views/ProfileView.tsx`（`showPublishModal`）；分享页布局在 `src/views/ShareView.tsx`；
> 拖拽排序列表实现为 `src/views/ProfileView.tsx` 内部的 `ReorderList` 组件，帖子编辑态另在
> `src/views/PlazaPostView.tsx` 内有一份等价的拖拽逻辑。

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/useRouter.ts` | 路由表新增 `/share`、`/plaza`、`/plaza/:id`（`pathToView` 按 `startsWith("/share")` 与 `/^\/plaza\/\d+/` 分派） |
| `src/App.tsx` | 按 `view` 分支渲染 ShareView / PlazaView / PlazaPostView |
| `src/views/ProfileView.tsx` | 添加「发布到广场」「手动调整」按钮，内联 `ReorderList` 拖拽组件 |
| `src/views/types.ts` | 新增 ShareViewProps、PlazaViewProps、PlazaPostViewProps、PlazaPost 等 |
| `worker/plaza.ts` | 广场 API 全部实现（`plazaRoute()` / `adminPlazaRoute()`） |
| `worker/index.ts` | 把 `/api/plaza/*`、`/api/comments/*` 挂到 `plazaRoute()` |
| `worker/account.ts` | 账号相关的广场数据统计与注销清理（`plaza_post_count`、删除本人帖子/留言/点赞） |
| `migrations/0011_plaza.sql` 及后续 0012/0014/0018/0019 | plaza_posts、plaza_likes、plaza_comments 建表与后续扩展 |
| `src/styles.css` | 新增广场/分享查看页/拖拽排序样式 |
| `src/lib/profile.ts` | `reorderRanking()` 函数支持手动调整排序 |

---

## 七、交互流程

### 7.1 查看分享 → 比较

```
【直接打开分享链接】
  用户打开 /share/:code
  → 加载查看页面
  → 展示对方榜单/画像内容（含批注）
  → 点击「与我比较」
    → 如果没有自己的画像 → 提示先创建
    → 如果有 → 跳转 /encounter 页面，自动导入对方数据

【在相遇页面粘贴链接】
  用户在 /encounter 页面粘贴链接
  → 直接进入比较界面（现有行为，不变）
```

### 7.2 查看分享 → 用对方榜单排序

```
用户打开分享链接
  → 展示内容
  → 点击「用此榜单排序」
    → 打开 /catalog/setup，候选作品来自对方榜单
    → 排序完成后保存到自己的画像
```

### 7.3 广场浏览 → 互动

```
用户访问 /plaza
  → 加载广场帖子列表（分页）
  → 浏览帖子卡片
  → 点击卡片 → 进入帖子详情
  → 可点赞、留言
  → 可「用此榜单排序」或「与我比较」
```

### 7.4 发布到广场

```
用户在「我的文化索引」页面
  → 点击「发布到广场」
  → 弹窗确认（可选附带批注）
  → POST /api/plaza/posts
  → 发布成功，按钮变为「已发布」
```

### 7.5 编辑/删除广场帖子

```
用户查看自己的广场帖子
  → 帖子详情页显示「编辑」和「删除」按钮
  → 点击「编辑」
    → 可修改标题、描述、批注
    → 可调整排序（人工优化，见 7.6）
    → PUT /api/plaza/posts/:id
  → 点击「删除」
    → 确认弹窗 → DELETE /api/plaza/posts/:id
    → 返回广场列表
```

### 7.6 人工优化排序

排序完成后，如果对结果不满意，支持手动调整：

```
用户在「我的文化索引」页面查看已完成的榜单
  → 点击「手动调整」按钮
  → 进入拖拽排序模式：
    - 每个作品行左侧显示拖拽手柄（⠿）
    - 拖拽作品行调整位置
    - 或使用上下箭头按钮逐位移动
    - 实时更新排名数字
  → 点击「保存」
    → 更新本地画像 + 云端同步
    → 如果已发布到广场，同步更新广场帖子
```

**实现方式**：
- 使用 HTML5 Drag and Drop API（无需引入第三方库）：`draggable` + `onDragStart/onDragOver/onDrop`
- 拖拽时显示半透明预览（`.reorder-item.dragging`）和插入位置指示线（`.drop-before` / `.drop-after`）
- 移动端**未**接 touch 事件，改为每行提供「上移 / 下移」按钮（帖子编辑态同样如此）
- 保存时重新计算 rank 字段（连续 1, 2, 3...），由 `src/lib/profile.ts` 的 `reorderRanking()` 完成

**入口**：
- 「我的文化索引」页面：每个榜单标题区域增加「手动调整」按钮
- 排序完成后的结果页面：增加「手动微调」按钮
- 广场帖子编辑页：可调整排序

---

## 八、安全性

- 所有写入操作（发布、点赞、留言）需登录
- 留言内容限制 500 字符，过滤控制字符（`worker/plaza.ts` 的 `cleanString()`）
- 帖子只能被作者删除（另有管理员路由 `/api/admin/plaza/*` 可删除任意帖子，全部写入 `admin_audit`）
- 留言只能被作者删除（管理员可删除任意留言，连同其直接回复一起删）
- 分享链接查看不需要登录（公开访问）
- 广场浏览不需要登录（公开信息流）；登录后额外可见自己的隐藏帖（`is_public = 0`）
- 批注数据随帖子一起发布（用户选择是否附带）

---

## 九、数据库迁移

```sql
-- 0011_plaza.sql（注：本文原写作 0010_plaza.sql，实际落地为 0011）

CREATE TABLE plaza_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  post_type TEXT NOT NULL,
  kind TEXT,
  collection_title TEXT NOT NULL,
  items TEXT NOT NULL,
  notes TEXT,
  item_count INTEGER,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE plaza_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);

CREATE TABLE plaza_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_plaza_posts_created ON plaza_posts(created_at DESC);
CREATE INDEX idx_plaza_posts_user ON plaza_posts(user_id);
CREATE INDEX idx_plaza_likes_post ON plaza_likes(post_id);
CREATE INDEX idx_plaza_comments_post ON plaza_comments(post_id);
```

**后续迁移**（均在 `migrations/` 中）：

| 文件 | 内容 |
|------|------|
| `0012_plaza_description.sql` | `plaza_posts` 增加 `description` 列 |
| `0014_comment_replies.sql` | `plaza_comments` 增加 `parent_id` 列（嵌套回复） |
| `0018_plaza_perf.sql` | 广场查询性能相关索引 |
| `0019_plaza_post_edits.sql` | 新增 `plaza_post_edits` 表（编辑历史） |

---

## 十、实施优先级

| 阶段 | 内容 | 工作量 | 状态 |
|------|------|--------|------|
| **Phase 1** | 数据库迁移 + 广场 API（CRUD + 点赞 + 留言 + 编辑） | 1-2 天 | ✅ 已完成 |
| **Phase 2** | 查看分享页（/share/:code）改造 | 1 天 | ✅ 已完成 |
| **Phase 3** | 广场列表页 + 帖子详情页（含编辑/删除） | 2-3 天 | ✅ 已完成 |
| **Phase 4** | 发布到广场功能（ProfileView 集成） | 0.5 天 | ✅ 已完成 |
| **Phase 5** | 人工优化排序（拖拽/上下移动） | 1-2 天 | ✅ 已完成 |
| **Phase 6** | 广场 → 排序/比较 交互流程 | 1 天 | ✅ 已完成 |
| **Phase 7** | 文档更新 + 测试 | 0.5 天 | ✅ 已完成 |

**总计：约 7-10 天**

**额外优化（已完成）**：
- 广场卡片自定义 HTML/CSS 设计（便利贴风格，`.plaza-sticker`）
- 列数选择器（2/3/4 列，持久化在 `localStorage` 的 `art-rank:plaza-cols`）
- 加载骨架屏动画（`.plaza-skeleton`）
- 广场头部高端化（渐变 + 毛玻璃标签页）
- 媒介能力选择器（`.plaza-abilities`）+ 导航栏毛玻璃
- 发布描述字段（输入框展开 + Enter 发布）
- 区分比较链接和分享链接（`/encounter?payload=` vs `/share/:code`）
- 批注大写作框 + 长批注展开/收起（`ExpandableNote`）
- 4 列模式单海报（紧凑模式 `.plaza-sticker-compact`）
- 发布粒子爆炸动画（`publishBurst`）
- 下拉模组 UI 美化
- 批注截断 30 字 + 弹窗查看
- 发布到广场弹窗设计（类 note-modal）
- 排序进度混合预估
- 无障碍 ARIA 属性增强（`role="tab"` / `aria-selected` / `aria-label` 等）
- 云端批注自动恢复（三入口修复）
- 留言回复功能（嵌套评论，`parent_id` + 缩进 + 回复按钮）

---

## 十一、待确认

1. ~~广场帖子是否支持编辑（修改标题/描述）？~~ → 已确认：支持编辑（标题/描述/批注/排序）
2. ~~排序结果不满意怎么办？~~ → 已确认：支持人工优化排序（拖拽/上下移动）
3. ~~留言是否支持回复（嵌套评论）？~~ → 已实现：支持回复，嵌套显示+缩进+回复按钮
4. 是否需要举报/屏蔽功能？→ **仍未实现**：全仓搜不到「举报 / 屏蔽」相关实现（无对应表、接口或界面）
5. ~~广场帖子的排序策略（最新/最热/混合）？~~ → 已实现：`sort=newest|hottest`（最热按 `like_count` 再按时间）
6. 每个用户发布帖子的数量限制？→ **仍未实现**：`POST /api/plaza/posts` 只校验单帖体积与条数上限，没有按用户计数

---

## 十二、校订记录（与本文原设计的差异）

本节记录本次校订中，对着 `worker/plaza.ts`、`migrations/`、`src/views/PlazaView.tsx`、
`src/views/PlazaPostView.tsx` 核实后改掉的**事实性错误**。设计取舍本身保持原样。

| 项 | 本文原写 | 实际情况 |
|---|---|---|
| 迁移文件名 | `0010_plaza.sql` | `0011_plaza.sql`（`0010` 已被 `0010_notes_column.sql` 占用） |
| 删除留言端点 | `DELETE /api/plaza/comments/:id` | `DELETE /api/comments/:id`（`worker/index.ts` 同时挂了两个前缀） |
| 表结构 | 未提 `description` / `parent_id` | `0012` 加 `description`，`0014` 加 `parent_id` |
| 未列出的端点 | — | `GET /api/plaza/posts/:id/edits`、`POST /api/plaza/posts/:id/visibility`（另有 `/api/admin/plaza/*`） |
| 列表参数 | `page/limit/kind` | 另有 `sort`（newest/hottest）与 `q`（搜索标题/昵称） |
| 新增组件文件 | 6 个独立组件文件 | 均未拆分，功能内联在三个视图里（详见 §六） |
| 路由位置 | `App.tsx` 新增路由 | 路由表在 `src/lib/useRouter.ts`，`App.tsx` 只按 `view` 分支渲染 |
| plaza 接口位置 | `worker/account.ts` 扩展 | 全在 `worker/plaza.ts`；`account.ts` 只做账号侧统计与注销清理 |
| 分享查看页 | 含点赞数、留言区 | `ShareView` 只有「用此榜单排序 / 与我比较 / 复制分享链接」 |
| 发布后状态 | 按钮变「已发布」、可取消 | 未实现；改为 `localStorage` 记录帖子 id + 「同步到广场」「隐藏帖子」「删除帖子」 |
| 移动端拖拽 | touch 事件适配 | 未接 touch，改用「上移 / 下移」按钮 |

**无法核实、故未改动的断言**（原文保留，供后续确认）：

- 「下拉模组 UI 美化」——描述过于笼统，无法对应到具体代码。
- 「排序进度混合预估」——仓库中搜不到「预估」相关实现，无法确认。
- 「云端批注自动恢复（三入口修复）」——`src/lib/useAuth.ts` 中有「已从云端恢复画像和批注。」提示，
  但「三入口」具体指哪三处无法从代码确认。
