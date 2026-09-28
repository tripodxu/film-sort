# TIMELINE — 项目演化时间线（由 515 条 git 记录整理）

> **格式：最新在最上面。** 按日倒序排列，每日内按主题归组（非逐条罗列 515 个 commit）。
> 用途：让 agent 在**不翻 git log** 的前提下，快速知道「这个功能是什么时候、为什么、以什么代价加进来的」。
> 需要精确到 commit 时用 `git log --oneline --all`（515 条）或 `git log --grep=<关键词>`。

生成时间：2026-09-28 ｜ 覆盖区间：2026-09-06 → 2026-09-28（23 天，单人开发，0 个外部贡献者）

---

## 2026-09-28 · 优化冲刺 P1–P5（29 commits）

产品侧的五项冲刺，全部线上验证后收尾，并做了文档收口。

- **P5 Jev 辅助模式（AI 代判）** `50e46df` — 排序中每对先经 `/api/ai/jev-pick` 预测，置信 ≥0.8 自动落位并标注「上一对由 Jev 代判 · 置信 NN%」，可撤销；低置信或复测阶段交还用户。键控竞态守卫丢弃迟到响应。
- **P4 路由拆包** `82b5b2d` — 五个大视图改 `React.lazy` + Suspense，index chunk 1072→964 KB（gzip 307→279）。
- **P3 广场品味相似度** `bcdaabb` — 新增 `src/lib/similarity.ts`（Jaccard 重合 + 顺序一致度），卡片徽章「重合 N/3」。
- **P2 OG 卡片** `dca3ab0` `cf9b837` — `worker/og.ts` 为 `/share/:code` 与 `/plaza/:id` 注入 og:/twitter: 元数据（爬虫不发 JS，必须服务端注入）。修复默认画像名在 OG 标题里重复。
- **P1 移动端滑动选择** `8017364` `ad8e735` — `lib/swipe.ts` 纯判定 + 容器级 pointer 处理器；修复 `setPointerCapture` 未守卫导致非活跃指针打断滑动链。
- **文档收口** `6ec21a0` `8661488` `fc901b1` — CHANGELOG 09-27/28、API 补 jev-pick、README 索引、ROADMAP 新增 1.5、FEATURES §12、USAGE 指南。

## 2026-09-27 · UI 全量打磨 + 移动端抢救 + Jev Phase 1（5 commits）

- `50e46df` 前一日的 Jev Phase 1（AI 快排）落地：准备页第三种成榜方式。
- 移动端 Hero 抢救、顶栏 `≤540px` 收 3 项（修复匿名「广场」被 `:last-child` 误伤）、设置下拉改锚 topbar（`overflow-x` 隐式裁剪）、触屏 tooltip 粘滞根治、名次墨块竖排修复、图标全部收编 lucide。
- 教训沉淀：**UI 修复要按「结构性改动优先于表面打磨」排序**（`2df15f5` 记录的迭代原则）。

## 2026-09-25 · P0/P1 安全加固 + 插件系统（23 commits）

- **安全**：`worker/outbound.ts` 出站统一策略（精确 host 白名单 / manual redirect 逐跳复核 / 响应字节上限 = SSRF 修复）；扫码事务所有权绑定（0024）；验证码与 OAuth exchange 一次性消费；Plaza 请求形状校验与写入完整性。
- **插件系统**：插拔主题包（`docs/THEME-PACKS.md` + 导入弹窗，内置第 7 主题「纸上擂台」）、开场光球特效注册表（`docs/ORB-EFFECTS.md`，等离子球/极光环场/呼吸黑洞）、分类清缓存（海报/文字/歌曲/其他）。
- **修复**：后台看板内联脚本模板转义错误导致登录失效；看板图表自托管摆脱 jsdelivr；Node 22 统一（CI / engines / .nvmrc）。

## 2026-09-24 · 加固设计与验证（11 commits）

- P0/P1 加固的设计文档与实施计划（`docs/superpowers/specs`、`docs/superpowers/plans`）。
- 出站与邮件安全契约测试成型（`outbound.test.ts` / `mailer.test.ts`）。

## 2026-09-23 · 测试补齐（5 commits）

- Task 1 契约测试收尾：出站重定向预算、邮件安全契约、类型安全断言。

## 2026-09-22 · UI 全站焕新「夜间档案馆 / Nocturne Archive」（46 commits）

**本项目最大的一次设计+工程改造，功能零变更**（唯一新增：可选布局模式）。

- **视觉**：北极星两屏三轮迭代（叠印报名、竖排书脊、目录巨号行、出血海报、CJK 首字下沉）；九视图 + 八界面 + 壳层全量收编档案语言；六主题人格化。
- **工程**：Token 体系 L1/L2 落地、散落 hex 归零、`--text-3` 74%→78%（WCAG AA）、圆角 21→5 档、间距 8px 阶梯、字阶 ±1px、阴影 36→2 级、玻璃两级制（17 类退哑光）、hover 浮起分级治理。
- **工具链**：`scripts/ui-shot.mjs` 截图 + `ui-diff.mjs` 零依赖 PNG 比对 + `ui-contrast.mjs` 对比度扫描 + `ui-normalize.mjs` 字面量归一化；270 张截图基线。
- **P5c 布局模式**：`src/lib/layout.ts`（与 theme 正交的 `data-layout`）。
- 收尾产出 release checklist、回滚方案、债务清单、设备 QA 清单、B1 re-anchor 记录。

## 2026-09-21 · 音乐链路提速与纠偏（10 commits）

- 音乐详情提速：百度直连熔断 + 双路并行 + 路由两步并行；anysearch 接入 API key 提为百科首选传输，音乐详情 ~20s → ~4s。
- `/api/music/detail` 上报真实服务端耗时（替代写死 0s）；清理误提交的临时文件。

## 2026-09-20 · 排序三模式 + 比较三档深度 + AI 点评落地（12 commits）

- `d47c444` **排序三模式**：简易（守门员截断）/ 经典（主动式二分插入 + 回环检测 + 复测）/ 精确（加强校准 + 校准一致率）；比较三档深度（median 聚合 / 共识构成 / 全量分歧）。
- `0594409` AI 点评三场景（内置 / 自定义双通道四协议）落地。
- `c4db783` AI 输出截断修复、榜单同名改后缀追加、搜索候选卡片化。
- `37c7879` 清理 styles.css 9 条 byte-identical 重复定义、补齐缺失类、移动端溢出兜底。

## 2026-09-18 · 工程化与性能（9 commits）

- `464775b` 接入 Prettier / ESLint 工具链并全仓统一格式（此后 `format:check` 成为门禁）。
- `604d331` 修两处 Hook 违规，首屏 Three.js 光球移出关键路径。
- `9f36ae9` 限流窗口 Map 加上界与惰性清扫。
- `73374fe` 试听/歌词独立配额 + 命中缓存不记账 + 渲染歌词译文。
- `68bc9e6` 删除外部工具产物，对全部文档做一次对着代码的校订（**文档必须对着代码校订**的习惯由此确立）。

## 2026-09-17 · 海报管线与画像持久化（16 commits）

- 海报批量接口 + 分页懒加载 + 服务端 1 天缓存打通；缺失海报按 Wiki → 网易云 → gd-proxy 逐级回退。
- `d4492eb` **豆瓣海报直连必然 418** —— 豆瓣系改走代理，图片免于抓取节流。
- 画像读写单侧校验导致「保存后刷新整份消失」—— 口径收敛 + **读侧永不删数据**。
- `960139d` 海报地址不再进 `items`：统一可落库白名单、唯一编码出口、批量先查库。
- Cookie 保险库支持独立环境密钥并兼容旧密文。

## 2026-09-16 · 音乐试听突围 + 导入体系升级（20 commits）

- `0e70c18` **音乐试听走 Deno Deploy 代理** —— CF Worker + gdstudio + 网易云出口均被封禁，Deno 走 GCP 出口可达。
- `9a8da52` CSP `connect-src` 缺 Deno 代理域名导致浏览器静默拦截（**静默 CSP 拦截**是本项目高频故障模式）。
- 音乐服务限流误报修复（连续失败冷却替代预算计数器）。
- `f8ad9ce` 导入体系升级：offset/limit 分批引擎 + 进度条、单次上限 100~1000 可调、已导入清单折叠/全选、「仅保存不排序」、存储上限 300→1000。
- `923f512` 豆瓣想看/已看导入全面修复（2026 版 mine 页已无 `item-root`，重写解析器）。
- 画像云端存储 Worker 端强制去掉 posterUrls（512KB 三连修：`51dfc8d` `58da68a` `4ce1f15`）。

## 2026-09-14 · Hook 提取（3 commits）

- `fb33527` `useAuth` / `5831209` `useSorting` / `49ce16e` 工具与路由 Hook —— App.tsx 累计减少 400+ 行。
- 次日 `f62affa` 修复 Hook 提取引入的三处回归（草稿无限写循环、自动同步无限 PUT、登出保存竞态）。

## 2026-09-13 · 主题系统地基 + 比较算法增强 + 文档全量重建（26 commits）

- `d6e9d64` **主题系统地基**：styles.css 全面令牌化（545 var / 194 color-mix）、六套主题、顶栏切换器 + 持久化 + 防闪烁。
- `4060716` 比较算法增强：Kendall τ-b（含并列）/ Top-5 Jaccard / 年代偏好 / 综合共识评分（五因子加权）。
- `193737e` PNG 导出重做：抽 `lib/exportPng.ts`（主题感知、2x 高清）、五版式。
- `bd63b4e` 「其他」类别数据（维基 pageimages + 百度百科兜底）。
- `aa1c4ff` **文档全量重建**：新增 `FEATURES.md` 作为回归基线，README 删错误陈述，API/ARCHITECTURE/DOUBAN_API/CLOUDDFLARE/USAGE 同步修订。
- 网易云导入链 weapi 分层降级 + 分片节流（CF 出口 weapi 单发可通、连发被限流）。

## 2026-09-12 · 外部导入体系 + 广场 + 管理后台 + 安全审计（58 commits）

历史上最密集的一天，四条并行主线：

1. **导入体系①–⑤**：即搜即加 → 豆瓣豆列 → 网易云歌单 → 扫码登录（`netease.ts` 加密 Cookie 保险库、`doubanlist.ts`）→ 文档收尾。
2. **广场优化步骤 1–7**：列表瘦身与服务端排序 → 分享有效期 → 发布到广场 → 榜单增删同步 → 作者编辑 → 按钮逻辑重构 → 无限滚动。
3. **后台看板增强步骤 1–5**：管理 API → Tab 化改版 → 用户画像查看 → 数据页签（分级重置 / 审计 / 会话）→ 文档收尾。
4. **安全审计 P0-1…P0-5**：OAuth state 校验 + 一次性 code 交换、PBKDF2 加盐哈希、管理后台 XSS 转义、缺失样式补齐、SW 缓存修复。

## 2026-09-10 · 全流程 UI 优化 + PWA（49 commits）

- 全流程 UI 优化：批注大弹窗（Amado 风格毛玻璃）、画像分享、广场批注、分享页指引。
- `76b290c` PWA 离线支持（Service Worker + manifest）。
- `e102c98` 排序撤销改 O(1) 快照法。
- `4b48dfa` 焦点陷阱 + 错误边界（模态键盘可访问性 + 白屏防护）。
- `2307402` UI 审查报告最终汇总：21 项中 16 项修复，5 项大型重构暂缓。
- 留言回复（嵌套评论）、粒子爆炸动画、发布描述字段。

## 2026-09-09 · 广场从零到一 + 优化路线图 22 项（112 commits）

- **广场 Phase 1–7**：数据库迁移 + 完整 API（CRUD / 点赞 / 留言 / 编辑）→ 分享页 `/share/:code` → 广场列表 + 详情 → 发布到广场 → 人工优化排序（拖拽 + 上下箭头）。
- **优化路线图 22 项**：Bundle 按需加载（QRCode / fflate 动态 import）、CSP 收紧、海报缓存持久化到 sessionStorage、API 日志批量写入 + D1 查询合并、Cron 自动清理过期数据、58 个核心测试、GitHub Actions CI。
- **路由体系**：URL 路径路由（清单 / 相遇 / 我的文化索引独立路径，支持前进后退）、分享链接统一为 `/encounter?payload=`。
- **比较重构**：多榜单合并 + 评分匹配 + 贪心分配 + 三方结果；自动合并 / 手动指定双模式。

## 2026-09-08 · 详情 API 与维基消歧攻坚（52 commits）

- `fetchWikipedia` 经历 **十余次迭代**才稳定：直接 titles → `generator=search` → `gsrwhat=title` → 两步搜索 → 加 media type hints → 最终 `63393cb` 重构为清晰的三阶段。
- 详情 API 体系成型：豆瓣搜索 + 详情 + 维基/百度百科兜底；`content_intro` / `content_source` 写入响应。
- 云端同步冲突解决：登录时冲突 → 增量合并到云端；同步状态灯。
- 管理后台：登录、API 日志、看板图表、日志清理（4 档）。

## 2026-09-07 · 用户系统从零到一（28 commits）

- 自建注册/登录（替代 Cloudflare Access）→ Google / GitHub OAuth → 昵称必填。
- D1 数据库启用 + migrations 起步。
- 豆瓣搜索/详情 API（书/影/音）+ 反爬限流头。
- 多榜单（每媒介多个）、重命名/删除、品味年轮、卡片网格布局迭代。
- 管理后台雏形（`ADMIN_PASSWORD` 环境变量）。

## 2026-09-06 · 项目起点（1 commit）

- `e1175d9` 初始提交。

---

## 附：按主题检索 commit 的常用命令

```bash
git log --oneline --all --grep="广场"        # 某功能的全部演化
git log --oneline --all -- worker/netease.ts # 某文件的全部改动
git log --oneline --all --since="2026-09-25" # 某时间窗
git show <hash> --stat                        # 单次改动面
```

## 附：提交类型分布（反映项目健康度）

| 类型 | 数量 | 说明 |
|------|------|------|
| fix | 171 | 占比最高 —— 项目处于高速迭代 + 持续纠偏期 |
| feat | 115 | 功能扩张 |
| docs | 65 | 文档同步习惯良好 |
| chore / style / refactor / perf / test / ci / ops | 其余 | 工程化 |
| Revert | 3 | `4952871`（撤回整包 P0+P1）、`e1fe9bf`、`13a51ed` |
