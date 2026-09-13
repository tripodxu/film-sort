# 网易云「按用户 ID 浏览全部歌单并选导入」主流程重构

## 目标（对齐你的澄清）
主需求：输入网易云**用户 ID** → 列出该用户**全部歌单（含收藏的）** → 任点一个 → 抓取该歌单歌曲并导入。
次要：扫码登录/Cookie 连接目前不稳，是"小功能" → UI 折叠收起，不占主界面。

## 已核实的关键事实（决定方案）
- `api/user/playlist?uid=&limit=1000`：本机匿名返回 54 条正常；但**线上 Cloudflare 海外出口匿名返回 0 条**（网易云限制数据中心 IP）。带你的 MUSIC_U Cookie 时正常。→ 这是"显示没有公开歌单"的真正原因，不是 bug 而是 IP 风控。
- 匿名响应里 `subscribed` 恒为 `null`，收藏歌单要靠 `creator.userId ≠ 被查 uid` 识别（现在"已收藏"标记匿名下永远不亮，要修）。
- 你写的旧 `api/playlist/detail` 已要求登录（code 20001），取歌单歌曲必须走已实装的 v6 detail + v3 song/detail 两步链（实测 9 首完整）。
- weapi 加密基建已在 worker/netease.ts，可作匿名失败时的第二通道。

## 后端
1. **worker/netease.ts `neteaseUserPlaylists`**：
   - 收藏标记修复：`subscribed = p.subscribed===true || (p.creator?.userId != null && p.creator.userId !== uid)`。
   - 分层降级：开放接口（带 cookie 若有）→ 空则 weapi `/weapi/user/playlist/`（带 cookie 若有）→ 仍空则返回 `{ playlists: [], blocked: true }`。
2. **worker/index.ts `/api/netease/user-playlists?uid=`**：响应加 `blocked`；blocked 且未连接时 msg 提示"服务器匿名访问受限，可展开下方连接账号后重试"。
3. worker/import.ts 不动（v6+v3 链已验证）。

## 前端（SourceView.tsx + styles.css）
4. **主界面（始终可见）**：音乐导入区重排为——
   - 第一输入框（主）：「输入网易云用户 ID 或主页链接 → 浏览全部歌单」；纯数字按 UID，含 `user/home?id=` 链接自动提取数字。
   - 结果列表：全部歌单（含收藏），每行 = 封面 + 名称 + N 首 + 标记（我喜欢的音乐/收藏）+「导入此歌单」；超过 ~8 行容器内滚动（新增 `.netease-pl-scroll`，复用 candidate-scroll 思路）。
   - blocked 时列表区显示引导文案指向折叠区。
   - 保留「或直接粘贴歌单链接/ID 导入」为次要行（现功能不破坏）。
5. **折叠区 `<details class="advanced-import">`（复用现有批量导入折叠样式）**：标题「连接我的网易云账号（扫码/粘贴 Cookie）· 可导入私有歌单」。内部收纳：扫码按钮、Cookie 粘贴框、已连接状态与「浏览我的歌单」——连接后自动把 UID 框预填为你自己的 ID 并触发浏览，"我的歌单"与"按 UID 浏览"合一。
6. 帮助弹窗（?）文案同步：主流程改为 UID 浏览，扫码/Cookie 标注"可选·被风控时用"。

## 验证
7. 本地 wrangler dev：uid=5204302550 → 54 条全列（收藏标记正确）→ 点选 → 曲目导入成功。
8. 线上部署后：匿名 blocked 提示正确；粘贴 Cookie 连接后 54 条完整（用你的 Cookie 验证后清理测试数据）。
9. tsc + vitest 全绿；六主题抽查新列表样式。

## 文档同步
docs/API.md（blocked + 收藏识别 + IP 限制说明）、FEATURES.md（导入走查项改为 UID 浏览主流程、扫码降级折叠）、USAGE.md（主流程 + 折叠说明）、README.md（端点表 + 功能描述）。

## 提交
单一 commit，push 后 CF 自动部署，线上抽查。