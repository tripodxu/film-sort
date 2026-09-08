# ART/RANK 深度体验升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ART/RANK 的排序、比较、导出、同步、导入和管理能力达到可长期使用的产品状态，同时保持 Cloudflare Workers 的部署边界。

**Architecture:** 保留浏览器优先的排序与游客画像，把比较证据、作品详情和导出排版放在前端纯函数中；把云端榜单、同步、海报错误和管理员操作放在 Worker/D1；第三方 AI 与音乐服务只经过 Worker 代理，并通过 Secret 和缓存限制访问。

**Tech Stack:** React 19、TypeScript、Vite、Three.js、Vitest、Cloudflare Workers Static Assets、D1、fflate、Canvas API。

---

### Task 1: 重构 1v1 排序证据层

**Files:**
- Modify: `src/lib/ranking.ts`
- Test: `src/lib/ranking.test.ts`
- Modify: `src/App.tsx`

- [x] 为比较状态增加最近对手窗口、验证队列、重复比较记录、偏好图边集合和环路告警字段，同时保留旧草稿的可恢复兼容。
- [x] 将候选调度从连续二分比较改为带最小间隔的交错调度：同一对作品至少隔离若干个比较或候选处理后才允许复测；排序结束前对高置信度边做少量冗余验证。
- [x] 用有向图检测 A→B→C→A 及更长环路；环路首次出现时自动加入验证队列，连续多轮方向一致时记录“偏好张力”状态。
- [x] 在排序页增加当前证据状态、复测提示和温和的环路说明，不阻塞用户继续选择。
- [x] 为调度间隔、复测、环路检测和 undo/replay 增加单元测试。

### Task 2: 升级多维比较模型与作品详情

**Files:**
- Modify: `src/lib/profile.ts`
- Test: `src/lib/profile.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/Poster.tsx`
- Modify: `src/styles.css`

- [x] 计算媒介内重合度、Top N 加权接近度、名次距离、Spearman 近似一致率、冠军/前三共识和最大分歧。
- [x] 计算跨媒介画像宽度、媒介覆盖、审美一致性和“共同偏好/分歧轴”摘要数据，所有结果保持可解释且不依赖外部 AI。
- [x] 比较页改成指标带、分歧列表、媒介切换和作品详情抽屉；点击海报查看年份、创作者、标签、来源和外部详情链接。
- [x] 作品详情通过现有 Worker API 获取，不把第三方请求直接暴露给浏览器。

### Task 3: 设计型 PNG 导出

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/lib/profile.test.ts`

- [x] 增加导出版式选择：编辑型总榜、媒介拼贴和极简文字版。
- [x] 使用 Canvas 预加载海报，按媒介色、排名层级、标题和副标题排版；海报失败时用统一色块占位，不阻止导出。
- [x] 输出 1200px 宽、适合社交平台的长图，并在图片中包含画像名称、日期和 ART/RANK 标识。
- [x] 验证中文字体、跨媒介数量和无海报作品的导出结果。

### Task 4: 云端同步与个人榜单

**Files:**
- Modify: `src/App.tsx`
- Modify: `worker/account.ts`
- Modify: `worker/index.ts`
- Create: `migrations/0008_user_collections.sql`
- Modify: `docs/CLOUDFLARE.md`

- [x] 登录后读取云端画像并在画像变更后做防抖保存。
- [x] 监听 `pagehide`、`visibilitychange` 和在线恢复事件，在已有 token 时发送 `keepalive` 同步请求；失败只保留本地画像。
- [x] 支持登录用户保存、读取、删除个人榜单，单件输入和批量导入都复用同一校验器。
- [x] 为榜单接口增加体积、数量、协议和标题长度限制，并补充文档。

### Task 5: 管理后台与观测完善

**Files:**
- Modify: `worker/account.ts`
- Modify: `worker/index.ts`
- Modify: `migrations/0008_user_collections.sql`
- Modify: `docs/USAGE.md`

- [x] 管理员可查看账户、禁用/恢复账户、删除账户画像和管理用户榜单。
- [x] 海报错误日志按来源、媒介、错误类型聚合，并保留 CSV 导出。
- [x] 后台 UI 改为状态卡、账户表和错误表，危险操作统一二次确认。

### Task 6: UI 与交互重构（Task 5 与附加服务之间）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `worker/index.ts`

- [x] 统一首页、来源选择、排序、画像、比较和账号弹层的栏目名称与操作语义，减少重复按钮和无意义的技术词。
- [x] 对齐参考页面的黑色夜景、绿色生命点、玻璃胶囊、低密度网格和移动端布局；保留 Three.js 光球作为首页焦点。
- [x] 优化点击反馈、键盘提示、焦点状态、返回路径、危险操作确认和加载/空状态。
- [x] 后台看板使用状态卡、账户表、海报错误聚合和明确的危险操作样式。

### Task 7: 附加服务接入

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/media.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `docs/CLOUDFLARE.md`

- [x] 增加可选 AI 解读接口，密钥只从 Cloudflare Secret 读取，前端只收到结构化短文，不记录原始画像或密钥。
- [x] 增加音乐详情/试听代理，使用 `music-api.gdstudio.xyz` 时做域名白名单、缓存、并发限制和明确的失败状态。
- [x] 只在用户主动打开详情或播放时请求附加服务。

### Task 8: 验证与发布检查

**Files:**
- Modify: `README.md`
- Modify: `docs/USAGE.md`
- Modify: `docs/CLOUDFLARE.md`
- Test: `src/lib/ranking.test.ts`, `src/lib/profile.test.ts`

- [ ] 运行类型检查、单元测试、生产构建和 Wrangler dry-run。
- [ ] 用真实浏览器验证桌面/手机排序、比较详情、PNG 下载、登录离页同步和批量导入。
- [ ] 检查新增 API 的错误码、缓存头、CSP、敏感信息边界和迁移说明。
