# 社区功能计划：查看分享 + 广场

> 状态：已实施

---

## 一、功能概览

### 栏目1：查看他人分享的榜单和画像

分享链接的两种入口，行为不同：

- **直接打开链接**（从聊天/邮件/浏览器点击）→ 进入 `/share/:code` **查看页面**，展示对方榜单/画像内容（含批注），再决定下一步操作（比较 / 用对方榜单排序 / 点赞收藏）
- **在「相遇」页面粘贴链接**（已有功能）→ **直接进入比较界面**，行为不变

### 栏目2：广场（Plaza）

登录用户可见的公共信息流。所有用户可以将自己的榜单/画像发布到广场，其他用户可以浏览、点赞、留言、使用对方榜单排序或发起比较。广场是社区互动的入口。

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

---

## 三、API 设计

### 3.1 广场帖子

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plaza/posts?page=&limit=&kind=` | 获取广场帖子列表（分页、可按媒介筛选） |
| GET | `/api/plaza/posts/:id` | 获取单个帖子详情（含留言） |
| POST | `/api/plaza/posts` | 发布帖子到广场（需登录） |
| PUT | `/api/plaza/posts/:id` | 编辑自己的帖子（标题/描述/批注/排序，需登录 + 所有权） |
| DELETE | `/api/plaza/posts/:id` | 删除自己的帖子（需登录 + 所有权） |
| POST | `/api/plaza/posts/:id/like` | 点赞/取消点赞（需登录） |
| GET | `/api/plaza/posts/:id/comments` | 获取留言列表 |
| POST | `/api/plaza/posts/:id/comments` | 发表留言（需登录） |
| DELETE | `/api/plaza/comments/:id` | 删除自己的留言 |

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

### 5.3 发布到广场

在「我的文化索引」页面，每个榜单和画像旁增加「发布到广场」按钮：
- 仅登录用户可见
- 点击后弹出确认弹窗，可选择附带批注
- 发布后按钮变为「已发布」，可取消

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

### 改动文件

| 文件 | 改动 |
|------|------|
| `App.tsx` | 新增路由 `/share/:code`、`/plaza`、`/plaza/:id` |
| `src/views/ProfileView.tsx` | 添加「发布到广场」「手动调整」按钮 |
| `src/views/types.ts` | 新增 ShareViewProps、PlazaViewProps 等 |
| `worker/index.ts` | 新增 `/api/plaza/*` 路由（含 PUT 编辑） |
| `worker/account.ts` | 扩展 plaza 相关接口 |
| `migrations/` | 新增 plaza_posts、plaza_likes、plaza_comments 迁移 |
| `src/styles.css` | 新增广场/分享查看页/拖拽排序样式 |
| `src/lib/profile.ts` | 扩展 `reorderRanking()` 函数支持手动调整排序 |
| `src/components/ReorderableList.tsx` | 拖拽排序组件（HTML5 DnD + touch 适配） |

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
- 使用 HTML5 Drag and Drop API（无需引入第三方库）
- 拖拽时显示半透明预览和插入位置指示线
- 移动端使用 touch 事件适配
- 保存时重新计算 rank 字段（连续 1, 2, 3...）

**入口**：
- 「我的文化索引」页面：每个榜单标题区域增加「手动调整」按钮
- 排序完成后的结果页面：增加「手动微调」按钮
- 广场帖子编辑页：可调整排序

---

## 八、安全性

- 所有写入操作（发布、点赞、留言）需登录
- 留言内容限制 500 字符，过滤控制字符
- 帖子只能被作者删除
- 留言只能被作者删除
- 分享链接查看不需要登录（公开访问）
- 广场浏览不需要登录（公开信息流）
- 批注数据随帖子一起发布（用户选择是否附带）

---

## 九、数据库迁移

```sql
-- 0010_plaza.sql

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

---

## 十一、待确认

1. ~~广场帖子是否支持编辑（修改标题/描述）？~~ → 已确认：支持编辑（标题/描述/批注/排序）
2. ~~排序结果不满意怎么办？~~ → 已确认：支持人工优化排序（拖拽/上下移动）
3. 留言是否支持回复（嵌套评论）？
4. 是否需要举报/屏蔽功能？
5. 广场帖子的排序策略（最新/最热/混合）？
6. 每个用户发布帖子的数量限制？
