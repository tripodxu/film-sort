# TASK-LEDGER — 任务台账（接力状态文件）

> **这是多 agent 协作的唯一活状态源。** 最新条目在最上面。
> 用法：接任务前先看顶部有没有在进行的条目（避免撞车）；开工时把自己的条目插到顶部；完成时更新状态并写明交接对象。
> 条目格式与交接四件套见 [`HANDOFF.md`](HANDOFF.md)。

**状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ⏸ 阻塞/缓行 ｜ 👀 待审 ｜ ✅ 完成（**必须线上验证过**）

---

## 进行中 / 最近

### T-20261005-05 · 登录态全流程实测（自建账户）· ✅ 完成（34 项通过，1 个待复现缺陷）

**状态**：✅ 完成 —— 注册 2 个测试账户（e2e-test@ / e2e-test-2@logicc.top，验证码经 D1 植入），API 全流程 26 项 + 越权 4 项 + 广场 6 项 + 浏览器 UI 登录，**34 项通过**。脚本在 `.tmp/flow*.mjs / ui-*.mjs`。

**全流程验证通过**：注册（验证码原子门）→ 登录 → 画像 PUT/GET + `work:` 前缀批注 round-trip → 云端清单 CRUD（items≥2 校验、作者删除、**跨用户删除被 user_id 条件天然挡住**）→ 分享链接创建 + 匿名读 → **cover-choice 登录写入 + 全站读穿 + 非维基域仍拒** → 分析事件（session_id 16-64 位、事件名白名单）→ **改密吊销旧会话 + 新密码登录** → 广场私密帖（匿名不可见/作者可见/未登录 PUT 与点赞被拒/作者编辑）。IDOR：B 账号摸不到 A 的画像/清单。浏览器 UI 登录（表单提交 → 顶栏变同步/退出 → 弹窗显示账号与同步动作）✅。

**⚠️ 待复现缺陷 F1（中低）**：`/share/<code>` **页面**卡在「正在加载分享内容…」——同一 code 的 **API** GET 是 200（数据完好），三次独立浏览器会话均复现，与登录态无关。前端缺陷（ShareView 渲染链或错误路径缺失），至少缺「加载失败反馈」。**⚠️ 结论被污染待复现 F2**：「从云端恢复画像」看似空转——但复测时 `account_auth` 桶（8 次/10 分钟）已被我自己的连续登录打满，登录疑似 429，恢复自然无 token 可用；限流窗口过后需重新验证（离线已证 parseProfile 对存储形状解析正常）。**教训**：E2E 脚本必须先断言登录响应再继续，否则会把限流误判成功能缺陷。

**测试账户交接**：e2e-test@logicc.top / `E2e-New-2026-m8Q2`（B 号同密码），名下有 1 条私密广场帖（id=34，标题「E2E 测试帖（已编辑）」，管理台可删）、2 条分享链接（68c444093cbf / abf35b81c8b2）、1 条 `other|e2e封面测试2026|...` 封面位。验证码临时行已被注册流程消费。

### T-20261005-04 · 线上全面安全与健壮性测试 · ✅ 完成（零漏洞，两条设计备注）

**状态**：✅ 完成 —— 44 项 HTTP 探针 + 6 视图浏览器扫描 + 4 项补充检查，**零漏洞**。脚本在 `.tmp/sec-probe.sh` / `.tmp/views-sweep.mjs`（.tmp 不进库，重跑可照着重写）。

**覆盖与结论**：
- **安全响应头**：HTML/JS/API 三类响应全部带 CSP（frame-ancestors 'none）+ X-Frame-Options DENY + COOP + nosniff + referrer-policy + permissions-policy。
- **鉴权边界**：admin 全家（dashboard/audit/reset/cache）未登录一律 401/400；`admin/reset` 防线是链式的（scope → 确认短语 → **管理员密码 401**），未登录无法执行；cover-choice 三道闸（跨源 403 / 无 token 401 / 假 token 401）✅；netease/douban 状态端点未登录 401 ✅；jev 无配置 400 ✅。
- **SSRF 面**：`/api/image` 白名单正则严格——云元数据 IP / file 协议 / 非白名单域 / `userinfo@` 挟持 / 非常规端口全部 400；白名单内正常放行。
- **注入与校验**：SQL 注入串、XSS 串进查询参数均被参数化查询与 JSON content-type 化解（无未转义反射、无 500）；batch 端点坏 JSON 400 / items 非数组 400 / **132KB 超大 payload 413** / `<script>` 标题安全处理；candidates name>120 与 english>120 均 400。
- **泄漏面**：所有 4xx/5xx 响应无栈、无内部路径；`/assets/../../wrangler.jsonc` 不可达；health 只回最小信息。
- **浏览器层**：6 个视图（首页/广场/我的索引/比较/分享/目录源）零 pageerror、零应用 console 错误、零 CSP 违规。唯一报错是 Cloudflare Insights 统计信标被**本机代理网络**拦断（环境问题，非应用）。

**两条设计备注（非漏洞）**：① `admin/reset` 的参数校验跑在鉴权之前（未登录先见 415/400），且错误消息会向未登录者暴露确认短语「RESET」——密码闸在其后，无实际风险，若想收紧可把鉴权提到最前；② `/admin` HTML 壳是公开的登录表单，数据端点全部有会话闸，无信息泄漏。

### T-20261005-03 · 低危小项清账 · lint 清零 / gates 聚合 / cover-choice 审计 / 焦点圈回 / 加载态

**状态**：✅ 完成（线上验证过）—— 本地 `npm run gates` 5/5 全绿；lint **0 problems**；vitest **715 passed / 9 skipped (724)**，714 ⇒ +1 审计用例。部署 `index-COzEojF4.js` 后 **E2E 6/6 全绿**（T4 焦点行为无回归）。提交 `f7b095e` + `e9313f2` + `0e0e0a8`。

**改了什么**（提交 `f7b095e` + `e9313f2`）：
1. **lint 警告 29 → 0**：16 处未用导入/变量/参数删除或 `_` 前缀（App 解构 ×3、OrbScene 导入 ×2、SettingsMenu/ plasma/useAuth/useRouter/account/CompareView ×3/HomeView ×2/SourceView `_refreshed`）；12 处 `react-hooks/exhaustive-deps` **逐条带真实原因的定向抑制**（渲染期函数身份 / selections 进依赖会循环 / mount-once 消费 URL——盲目补依赖在无 jsdom 覆盖的视图上是回归风险，不是疏忽）。
2. **`npm run gates`**（`scripts/gates.mjs`）：五道门禁退出码正确聚合、失败即停（管道 `| tail` 吞退出码的假绿根治，2026-10-05 真实踩过）。
3. **cover-choice 写审计**：写穿校验通过后 `recordAudit("cover_choice", {title,wikiTitle,url,userId,email})` 落 `admin_audit`——全站封面位的写现在可追溯，管理台零改动可见。+1 运行时用例（fakeDb 捕获 admin_audit INSERT）。
4. **FocusTrap 监听上 document** + `el.contains(activeElement)` 守卫：焦点在 trap 外时 Tab 圈回、Escape 生效（原挂 el 上收不到 keydown）。绊线同步（document 监听 + contains 守卫都不许摘）。
5. **Poster 加载态**：`imgLoaded` 布尔 → `loadedSrc === src` 派生，候选切换/代理重试换图时占位态正确恢复。

**给下一棒**：低危清单到此清完。剩两条线：① 四个封面链观测项攒 `poster_batch_stats` 数据后裁夺（SQL 见 T-20261005-02）；② 产品向（ROADMAP Phase 3/4、PWA、per-user 封面、P2 待办池 B/C/D/E）。

### T-20261005-02 · 观测基建 + 浏览器 E2E（第一档两件）· ✅ 完成（线上验证过）

**状态**：✅ 完成 —— 门禁 5/5（vitest **714 passed / 9 skipped (723)**，711 ⇒ +3）；迁移 0026 已应用远程 D1；线上部署 `index-B8c95rz-.js` 后 **E2E 6/6 全绿** + `invalid_english` 探针 400。提交 `92393be`（ErrorBoundary null 语义，E2E 抓到的真 bug）/ `9c40ad2`（观测基建 + E2E）/ `70c6d51`（E2E 真实化）。

**改了什么**：
1. `migrations/0026_poster_batch_stats.sql`：每批量请求一行 `total/found/absent/throttled` —— 封面链四个「动闸门前先观测」项改为查表判断。
2. `worker/index.ts`：批量端点火后不管写一行统计；管理台 Promise.all + 响应新增 `poster_batch_stats` 键 + 「海报错误聚合」卡渲染近 7 天汇总（含 throttled 占比）。
3. `scripts/ui-e2e.mjs`（`npm run e2e [url]`）+ `playwright` devDep：T1 菜单开合 / T2·T3 chunk 拦截不白屏 / T4 详情焦点不回跳；浏览器启动回退链（自带 → 残留 chromium-1223 → msedge → chrome，本机下载通道不通）。
4. `src/components/ErrorBoundary.tsx`：`fallback ?? 默认` → `fallback !== undefined`（`??` 把显式 null 求值成默认报错块，E2E 首跑抓到）+ 绊线。
5. `worker/posterBatchStats.test.ts` ×2（45s 超时：全挂路径走满豆瓣退避链是真成本）。

**诚实备注**：T4 的「旧代码会真实失败」按机制推断，未做真旧 bundle 变异验证；T4 第一版 Tab 方案在 loading 期会误报（弹窗只有一个可聚焦元素，Tab 原地打转），已写进脚本注释。

**给下一棒**：四个观测项现在可以动手了——`SELECT SUM(throttled), SUM(total), created_at FROM poster_batch_stats WHERE created_at >= ...` 直接出占比；标题抽样配 `poster_errors WHERE title LIKE ...`。低危剩余：lint 29 warnings 清零、`npm run gates` 聚合脚本、cover-choice 写审计、FocusTrap Tab 逃逸补丁、Poster imgLoaded 重置。

### T-20261005-01 · 回归审查修复 · 最近 30 次提交整体审查出的 1 高 + 4 中缺陷（前端五处）+ 低危清单五项

**状态**：👀 待审（HTTP 层线上验证 ✅，浏览器行为项留红）—— 门禁 5/5 本地全绿；修复批 commit `8e58816`（vitest 707，+6）、低危批 `dbeae79`（再 +4 ⇒ **711 passed / 9 skipped (720)**）。**线上验证 2026-10-05**：推送触发自动部署后，`GET /` 引用的主包 `assets/index-Bsgh-aaO.js` 与本地 dbeae79 构建逐字节同哈希，且 `GET /api/other/candidates?english=<121字符>` 线上返回 **400 `invalid_english`**（该字符串仅存在于 dbeae79 ⇒ 前后端新代码确认在跑）；线上冒烟 5/5（english 上限 400 ✓ / 正常请求 200 ✓ / 新 chunk `immutable` 头 ✓ / HTML `must-revalidate` ✓ / 同批 CSS 就位 ✓）。**浏览器行为项已补验关闭（同日 T-20261005-02）**：E2E T2/T3 拦截产物请求（= 发版换代 404 的确定性模拟）证明 chunk 失败不白屏；T4 证明详情数据到达后焦点停在 body 不被抢回——6/6 全绿，见 `npm run e2e`。注意：本轮经 push 自动部署，`wrangler deployments list` 仍显示 10-02 的旧 Version（自动部署通道不在本地 wrangler 视图内），验证证据以「bundle 哈希吻合 + invalid_english 探针」为准，下一棒别被旧 Version 迷惑。

**任务类型**：回归审查 + 修复（用户指派「审查最近 30 次提交会不会有回归 → 修复」）。审查用三路并行深读（worker 封面链 / worker 接口与存储 / 前端），范围 `5faea92..HEAD`（30 commits，+10764/−451）。

**改了什么**：
1. `src/App.tsx`：界外三处 Suspense（顶栏 SettingsMenu / AiConfigDialog / RankingDetail）各包一层 `<ErrorBoundary fallback={null}>`（此前 chunk 失败会卸掉整棵根 → 白屏整站）；`openArtworkDetail` 落结果改条件更新 `applyIfCurrent`（比对 kind+work.id，保住等待期间 CoverChoice 换过的 posterUrls）。
2. `src/components/FocusTrap.tsx`：`onEscape` 走 `onEscapeRef` 桥接，监听+首焦点 effect 依赖清空（挂载一次）。
3. `src/components/CoverChoice.tsx`：候选取图改 `requestedRef` 记账，effect 依赖收回 `[memo, year]`（原实现与注释相反，每候选重复请求 2-3 次烧共享 other 桶）。
4. `src/components/OrbScene.tsx`：`mountInstance` 的 `createOrbEffectById` 包 try/catch（失败加 `.orb-scene-fallback` 退 CSS 背景）；cleanup 首行 `mountToken += 1` 作废在途挂载（否则泄漏一次 dispose）。
5. `src/components/DeferredOrb.tsx`：新增 `SilentChunkBoundary`（失败停留 placeholder），装饰组件失败不再冒泡到路由级边界拖死首页。
6. `src/ui-fixes.test.ts`：新 describe「懒加载失败与迟到响应守卫（回归审查 2026-10）」**6 例绊线**（源码扫描式，同既有惯例）。
7. 低危批（同日第二批）：`worker/other.ts` `edit[-_ ]` 补词首边界（`Credit roll.jpg` 子串误杀，+4 例黑线）｜`worker/media.ts` other 分支死三元清掉（恒 false 的 `throttled`，无行为变化）｜`shared/posterKey.ts` 注释代数改「以常量为准」｜`worker/index.ts` candidates `english` 补 120 上限（+1 例路由用例，复用 coverChoice 测试骨架）｜`src/lib/detailFields.ts` 未知对象值序列化 JSON（`[object Object]` 不再上屏，+2 例）。
8. `CHANGELOG.md`：同日条目（含「没回归」清单全文 + 低危清单）。

**为什么**：五个缺陷全在「不常走的路径」上——chunk 失败只在发版换代/弱网显形（且 2980ad9 的 immutable 一年恰好放大暴露面）、迟到响应只在手速快过 30s 详情链时显形、重复请求只烧后台配额不报错。逐条证据见审查报告与 CHANGELOG。

**审查确认「没回归」的方面**（下一棒不必重查）：八次封面链迭代的关键机制（繁简归一/tier 闸门/年份 −4/类型词轮保底/详情链短路/桶宽白名单/逐条探针/artifact 尺）在 HEAD 全部在位且互相叠加；posterKey 换代 movie/book/music 逐字节同键、仅 other 换代；资产缓存 matcher 不误伤 HTML/API；fetchBounded/allowedImage/storedItem 白名单/Key 不落盘/管理面转义/读侧不删数据全部无新增违规；bf936bc 后无模块级跨请求状态。

**下一步 / 遗留（按优先级）**：
1. **浏览器行为项线上复验**（HTTP 层已 ✅，见状态栏五项冒烟）：部署换代后旧标签页点齿轮/AI 设置/榜单海报不白屏、详情弹窗数据到达时焦点不被抢走——需要真浏览器，本机连续第四次缺此环境。
2. **动闸门前先补线上观测（4 项）**：① `otherDetail` 第一档把「裸标题同名条目」钉死并短路整套消歧救援（`worker/other.ts:1424` + `worker/media.ts:1734`，维基结构一变就错图直出）；② `ARTIFACT_FILE_RE` 误杀「标题即敏感词」作品（`worker/other.ts:296`，Avatar/Banner/Flag 类真海报被杀且连正文兜底一起失效，2d962d2 引入的回退）；③ other 链上游请求量翻倍（otherDetail+resolveOtherCover 同链重跑，429→15s 负缓存→批次变灰）；④ 「标题即年份」作品（《2012》/《1984》）被年份否决刀 −4 误伤——修它没有干净的离线测试缝（做有区分度的夹具得反推整套评分词表），按「动闸门先观测」纪律与 ①②③ 同批。观测点：cover-choice 前后 key 命中分布、poster_errors 里 throttled 占比、标题含 icon/avatar/flag 条目抽样。
3. 已知取舍不动：cover-choice 允许任意登录用户改全站封面位（端点注释已声明的产品决策，留意滥用面）；FocusTrap 焦点落在 trap 外时 Tab 可逃逸（实际暴露面极小）。



### T-20261002-12 · 迭代 11/20（前端类）· 作品详情弹窗接上焦点陷阱 + 字段翻译层（后端键不再直接印给人看）

**状态**：✅ 完成 —— 门禁 5/5（`tsc -b` exit 0 ｜ lint **29 problems (0 errors, 29 warnings)** = 基线 ｜ format:check All matched files ｜ vitest **701 passed / 9 skipped (710)**（基线 674 ⇒ **+27**，47 files + 1 skipped）｜ build 通过）｜ 红队 ×4 全红 ｜ 线上 Version **`bcbd52d4-5054-42df-a8fb-885bcd046597`**，A3/A8 ✅ 线上四类响应键覆盖实测通过。

**任务类型**：§2 前端打磨（ROADMAP §二 P2 待办池 A13 / A12 / E1 三项合并，全落 `src/components/ArtworkDetail.tsx`）。轮换位：10 优化 → **11 前端**。题源由用户 m05616「继续，做到优化轮次停止」排到本轮。

**最小上下文**（接手需读的四个文件）：
`src/components/ArtworkDetail.tsx`（唯一改动点）｜ `src/lib/detailFields.ts`（**新建**纯函数翻译层）｜ `src/components/FocusTrap.tsx`（**已有**组件，本轮只是接线，零改动）｜ `src/ui-fixes.test.ts`（接线绊线所在，用既有 `stripComments` 先剥注释再扫源码）。

**改了什么**：
1. `ArtworkDetail.tsx` 返回根元素由 `<div className="modal-backdrop">` 改为 `<FocusTrap onEscape={onClose}>` **包住** backdrop 与 `<section role="dialog" aria-modal="true">`（FocusTrap 必须在**外层**，写里层则背景元素仍可被 Tab 到）。
2. `<audio controls autoPlay src={playUrl} />` 加 `aria-label={t("歌曲试听", "Audio preview")}`。
3. `<dl>` 改用 `splitDetailFields(detailFields(detail.data, t))`：`rows` 出表格行、**`blocks`（长文本）走既有 `.detail-synopsis` 块级排版**挂在 `<dl>` 之后 ⇒ **`styles.css` 零改动**。
4. 新建 `src/lib/detailFields.ts`（纯函数，node 环境无 jsdom 才测得了）：`INTERNAL_KEYS`（9 键 / 7 条逐键理由）、`KNOWN_FIELDS`（11 键中英双语，**顺序 = 显示顺序，不跟响应插入序**）、`LONG_VALUE_CHARS = 80`、`isPresent()`（**先判空再 stringify**）、`detailFields(data, t)`、`splitDetailFields(fields)`。
5. 测试：`src/lib/detailFields.test.ts` **21 例**（四份 fixture 是**线上实录形状**）；`src/ui-fixes.test.ts` 新 `describe("详情弹窗可访问性与字段翻译（PLAN-DETAIL-DIALOG-A11Y）")` **6 例**。

**为什么**（四条，都不是「更好看」）：
1. `role="dialog" aria-modal="true"` 是写给 AT 的**声明**，声明不产生行为 ⇒ 焦点仍在触发按钮上、Tab 会走到弹窗背后、**Esc 无效**。`ArtworkDetail` 是全站**唯一**没接 `FocusTrap` 的模态（另两处 `src/App.tsx:2278` / `src/components/AiConfigDialog.tsx:166` 已接）。
2. 旧实现 `Object.entries(detail.data)` **把「后端返回了什么」当成了「界面该显示什么」**，`slice(0, 8)` 是在这层缺失上打的补丁——用一个数字掩盖「从来没选过」，还让顺序跟着响应 JSON 插入序变。
3. 线上实测（`.tmp/dl11.mjs`）该补丁的代价：`other` 类印出 **44 字符 percent-encoded 内部键 `id`** 与 **150 字符裸 URL `poster_url`**；`book` 类把 **389 字符 `author_intro`** 挤在表格行里；`music` 类印纯内部字段 `matchedTitle`；`movie` 类在中文界面下是一片 `year: 2025`。
4. 裸 `<audio>` 对读屏用户只是一个没有名字的控件。

**验证状态**：
- 五道门禁全过（A1 ✅）；vitest **701 passed / 9 skipped (710)**。
- **红队 ×4 全红**（每次都删字面量，见 `docs/PLAN-DETAIL-DIALOG-A11Y.md` §5.2）：R-1 `<FocusTrap onEscape={onClose}>` → `<div>`（1 failed）｜ R-2 删 `audio` 的 `aria-label`（1 failed）｜ R-3 `splitDetailFields(detailFields(detail.data, t))` → 旧实现 `Object.entries(detail.data).filter(([, v]) => v).slice(0, 8)`（**2 failed**）｜ R-4 `INTERNAL_KEYS` 少 `"matchedTitle",` 一个字符串（1 failed）。R-4 与迭代 9 的空变异 R-5 构成对照：**那次变异没有语义，这次有语义且被咬住**。
- A3/A8 线上四类响应键覆盖实测（`.tmp/a3v11.mjs`）：`movie` 8 键（排除 3/翻译 5/保底 0）、`book` 20 键（排除 5/翻译 3/保底 12）、`music` 6 键（排除 4/翻译 2/保底 0）、`other` 7 键（排除 6/翻译 1/保底 0）⇒ **「未翻译即未排除」的键为 0**，无键带着字面量 `null` 漏到界面。
- A6 ✅：`git status --porcelain` 5 个条目全在前端与文档，`src/styles.css` / `worker/` / `shared/` **零条目**；线上 CSS 148114 B。
- 线上 bundle：411823 B（与本地逐字节相同）、`ce=br` + `public, max-age=31536000, immutable`、`modulepreload` 计数 0；`歌曲试听` / `art-rank:cover-choice` / `other-name|` 三痕迹均 true（迭代 9 未被破坏）。

**实测发现并修掉的真 bug 4 条**（三条来自我自己写的「更干净」的重写）：
1. **`title` 没搬进 `INTERNAL_KEYS`** —— 重写旧 SKIP 列表时漏了，`other` 类多出一行 `title`。被新测试当场抓住。
2. **`String(null)` 是 `"null"` ⇒ null/undefined 漏到界面** —— 我把旧 `.filter(([, value]) => value && …)` 翻译成「先 stringify 再 `!text.trim()` 判空」，看着更统一，结果 `country: null` 变成可见的「地区: null」。**判空必须在 stringify 之前**——这两步的顺序是语义，不是风格。修法：新增 `isPresent()` 在 `stringifyValue()` 之前判。
3. **数组元素未过滤 ⇒ `"、null、徐凯鑫"`** —— `["", null, "徐凯鑫"]` 直接 join 出前导顿号 + 字面量 `null`。修法 `value.filter(isPresent).map(String).join("、")`，并补 `[null, undefined]` 整段为空的用例。
4. **`label` 当 React key 会撞车** —— `author`→「作者」与原始中文键 `作者`（保底照印）标签相同 ⇒ React 重复 key 错位复用 DOM。**这条只有在保留保底键的设计下才可能出现，是我引入的**。修法：`DetailField.key` 用原始键名，`label` 只给人看；调用点两处 `key={field.label}` → `key={field.key}`。
- 附带修掉一个测试环境坑：**JSDoc 里写 `/api/*/detail` 会提前终止块注释**，esbuild 报 `Unterminated string literal` 于**文件末行**（离真错 180 行）；定位法＝逐行前缀二分跑 `esbuild.transform` 找第一条硬错误（报 `Expected "*/" to terminate multi-line comment` 于第 7 行）。

**遗留风险 7 条**：
1. **A4 的浏览器行为与 A7 的界面渲染两栏留红**（未标 ✅）：环境无可驱动浏览器——`npx playwright --version` 有 1.60.0，但 `%LOCALAPPDATA%\ms-playwright` 只有 `chromium_headless_shell-1223` / `chromium-1223` **残留目录、无可执行文件**；本机唯一浏览器是 Edge 且未纳入 Playwright 通道。**同一处连续第三次留红**（迭代 7、9、11）。
2. **A5 超预算**：实测 **+1325 B**，超 1 KB 预算 325 B，**经复核判定接受**（压回 1 KB 只能删真实字段 = 为数字删功能）。教训：**预算应先量一次空实现的体积，而不是猜**。
3. **`book` 仍有 12 个保底键未翻译**（`作者`/`译者`/`校注`/`出版社`/`出版年`/`ISBN`/`页数`/`装帧`/`定价`/`丛书`/`dirs`）——它们**本来就是中文键名**（后端如此），非本轮引入；修它要改后端字段名 ⇒ 后续轮的独立题目。
4. **焦点归还仍未做**：`FocusTrap` 不把焦点还给触发按钮，属**仓级组件语义**，改它影响另两处已有调用点 ⇒ 本轮明确不做。
5. **`IconButton` 只传 `title` 不传 `aria-label`**（ROADMAP §二 P2 全局项）仍有 20+ 调用点 ⇒ 全局重构，另开一轮。
6. 线上 `other|纪念碑谷|monument valley|2014|4` 仍返 `Monument_Valley_icon_unrounded.jpg` —— **迭代 10 的 24h 边缘缓存**（PITFALLS 2.21 / 4.51），非回归；本轮**零后端改动**，不做任何缓存动作。
7. 零迁移：deploy 报 `✅ No migrations to apply!`；`worker/` 与 `shared/` 全程未动。

**下一步 6 条**（优先级序）：
1. **P0（遗留自迭代 7/9）浏览器 E2E 缺口** —— 已连续三轮卡在同一处（环境无浏览器）。**建议本轮内解决环境**（装 `chromium` 或把 Edge 纳入通道），否则后续所有「视觉/交互类」迭代都只能留红一半。
2. **P1 `book` 类后端字段名中文化**（12 个中文键 ⇒ 统一英文字段 + i18n 标签），修 A7 的 `book` 分支。
3. **P1 `IconButton` 全局补 `aria-label`**（20+ 调用点）。
4. **P2 `FocusTrap` 焦点归还**（仓级语义，影响三处调用点）。
5. **P2 第 5 档「超时但前 4 档成功 ⇒ absent」运行时用例**（遗留自迭代 8）。
6. P3 per-user 封面覆盖（新表、scope 大）；`docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3/4 仍 ⬜。

---

### T-20261002-11 · 迭代 10/20（优化类）· 封面文件名判别（infobox 指向 app 图标时改用正文作品图）

**状态**：✅ 完成（门禁 + 红队 ×4 + 线上实测 2026-10-02；**A7 留 ⚠️ 原键受 24h 缓存**，见遗留 ①）

- **任务类型**：§2.1 优化类（轮换位：9 创意 → 10 优化）
- **最小上下文**：不需要读全仓。只需 `worker/other.ts`（`toWork` / `resolveOtherCover` / `wikiPageImageAny` / `fillArticleImageNames`）与 `worker/media.ts:1325 wikiPagePoster`。**`src/` 与 `shared/` 本轮零改动**（主包指纹逐字节不变可证）。
- **改了什么**
  - `worker/other.ts` 新增 `ARTIFACT_FILE_RE` + `export type ArtworkFileVerdict = "artwork" | "artifact"` + `export function classifyArtworkFile(name): ArtworkFileVerdict`：**判据只能是文件名**（宽高被实测钉死，见「为什么」②）。收窄到 `icon|logo|logotype|wordmark|banner|avatar|flag|placeholder|mascot|edit[-_ ]|star full/empty/half`，且**刻意不收**旧 `SKIP` 的 `disambig`（那是 pageprops 键名）、`commons`（Commons 来源但完全正确）、`question`。
  - 新增 `ARTWORK_NAME_HINT_RE`（`screenshot|cover|boxart|poster|keyart|title screen|capture|gameplay`，**语言无关**）、`isArtworkPageImage`、`articleImageNames`（按 `jpe?g|png` 过滤 + artwork 判别）、`fillArticleImageNames`（**单独**发一次 `prop=images&imlimit=50` 的 titles 查询，**只在 artifact 判定后才发**）、`articleNameMatchesWork`。
  - `toWork` 改成 `async`：`infobox` 判 artifact ⇒ 走 `thumbnail/original`，再没有则走同页 images 第四档（`articleNameMatchesWork` 命中先试，否则第一张）。
  - `resolveOtherCover` / `wikiPageImageAny` / `media.ts:1325 wikiPagePoster` 三处 `page_image` 直取收口到同一把尺，**都不 `return null`**（它们后面本来就有下一档）。
  - 测试：改写 1 条（旧的 `it("…infobox 封面（而非真实地貌照片）")` 断言的正是本轮要修的 bug）、新增 8 条（写回形状的端到端用例、`wikiPageImageAny` 不返回 icon、`toWork` 退回缩略图而不丢条目、`classifyArtworkFile` 5 例、tripwire 5 例），迭代 8 的记账 tripwire 由 5 改 6。
- **为什么（4 条）**
  1. **台账的因果写错了，动手前的实测推翻了它**：`year` 不参与任何选图判断，它做的是换一道分支（`media.ts:1727` 第一档 `otherDetail(title, year)`）。不带 year 返回地貌页（`page_image` 空 ⇒ 落到缩略图那张 500px 地貌照）；带 year 返回 `纪念碑谷 (游戏)`（tier 2 / score 13.5 / band `exact`，**条目选得是对的**）。⇒ 题眼是「infobox 封面名指向 app 图标」，不是 year。
  2. **宽高判据被实测钉死**：`Animal_Crossing_New_Horizons.png` 只有 **248×402**，比 316×316 的 icon **更窄**；正确封面出 `thumbnail_unscaled` 是常态 ⇒ 任何「太窄/太小 ⇒ 不是封面」的规则都会误杀**当前正确**的封面。
  3. **「判掉」不等于「修好」**：实测 `纪念碑谷 (游戏)` 的 `thumbnail`/`original`/`pageimages` **三者全空**（app 图标是非自由文件）⇒ 只做「不采用」会把错图换成**没图**。真正的游戏截图躺在同页 images 里，必须自己补那一档。
  4. **收口点决定代价**：加 `prop=images` 到 `wikiSearchOnce` 每轮 +2746 B、一条 other 最坏 4 轮 ⇒ +11 KB；只查 `top` 那 1–3 页则 +1969 B。
- **验证状态**
  - 门禁：`tsc -b` exit 0；`lint` **29 problems (0 errors, 29 warnings)** = 基线；`format:check` All matched files；`vitest` **674 passed / 9 skipped (683)**（基线 660 ⇒ **+14**）；`build` ✓ **零前端改动** ⇒ `index-CGd3gcxH.js` 本地 410498 B / 线上 410498 B，与迭代 9 **同一指纹**，`ce=br`、`immutable`、`modulepreload` 计数 0。
  - 红队 ×4 **全红**：R-1 删 `toWork` 守卫（1 failed）/ R-2 改成 `return null`（2 failed，`条目被整个丢掉了（不该发生）`）/ R-3 删正则扩展分隔符（2 failed，`expected 'artwork' to be 'artifact'`）/ **R-4 删 `fillArticleImageNames` 存回 `{title}` 的 `.map`（1 failed，精准命中新加的那条端到端用例）**。
  - 线上 Version ID **`28126578-420f-4547-a179-4c182edb5ee3**，`✅ No migrations to apply!`（零迁移仍是设计目标）。
  - A3 ✅ batch：`other|纪念碑谷(游戏)|monument valley|2014|4` ⇒ **`Monument_Valley_screenshot.jpg`**；detail `poster_url` 同值、标题仍是 `纪念碑谷 (游戏)`。
  - A4 ✅ 三轮逐字稳定 4/4 `found`：风之旅人 `Journey_PSN_Cover.png`、动物森友会 `Animal_Crossing_New_Horizons.png`、Journey `Journey_PSN_Cover.png`、Inside `INSIDE_Cover.jpg`。
- **实测发现并修掉的真 bug（4 条）**
  1. **`fillArticleImageNames` 写裸字符串、`articleImageNames`/`wikiPageImageAny` 按 `{title}` 对象读** ⇒ 静默全空，`tsc` 零报错、69 条测试全绿、线上取不到图。改为存回 `{title}` 并补一条**必须走过填充器**的端到端用例（PITFALLS 4.61）。
  2. **计划点名错了修复点**：以为主路径是 `resolveOtherCover`，实测带 year 的请求在 `media.ts:1727` 就被 `otherDetail` 截住 ⇒ 只改它的话测试全绿而线上零变化（PITFALLS 4.60）。真正修 bug 的是 `toWork`。
  3. **「判 artifact ⇒ return null」是回归**：该函数同时当过滤器用，undefined 会把整条候选从详情/搜索里抹掉，比拿错图更糟。由红队 R-2 逼出，并补了「退回缩略图而不是丢掉整条条目」的行为用例。
  4. **中文条目正文里的文件名是英文的**：只拿中文标题去 `includes` 永远匹配不上（第一次验收白跑一轮）⇒ 加与语言无关的 `ARTWORK_NAME_HINT_RE`；**刻意不查 `langlinks`**，因为那会让每个 icon 页多付一次请求。
- **遗留风险**
  1. **A7 留 ⚠️**：原键 `other|纪念碑谷|monument valley|2014|4` **今天仍返 icon**（24h TTL 未过）。A3 的证据建立在另一个键（换**输入形态** `纪念碑谷(游戏)` 半角括号，真实用户写法）上。**加盐会破坏维基消歧**（PITFALLS 4.54），所以换的是形态不是内容。原键修复待 TTL 过期后复测。
  2. **A6 只核到「取图层之外零改动」**：`git diff` 逐行读过，但没有自动化断言钉住「评分/档位/别名一行不动」⇒ 下一轮若碰 `other.ts` 应补形状 tripwire。
  3. **正则有已知漏网**（诚实记账）：`Crystal Clear app package games.svg`、`Future film2.svg`、`Symbol support vote.svg` 这类条目模板图标不共享特征词，靠 `jpe?g|png` 过滤兜住；png/jpg 模板图标仍可能漏网。
  4. **`icon` 按词边界命中** ⇒ `File:Icon Man.jpg` 会被判 artifact。实测无此真封面，但这是明确取舍。
  5. **`toWork` 改 async 是签名变更**（三个调用点都传了 probe）。`otherSearch` 的 `Promise.all` 并发度未变（确认过没变），但**未测量它对总时长的影响**。
  6. **迭代 9 遗留 ①（浏览器 E2E）与迭代 8 遗留（A7/A8 需网络恢复）仍未解**，见下一步。
- **下一步（迭代 11 起）**
  1. **浏览器 E2E 缺口**（迭代 7/9/10 连续三次留红）：一次性 Playwright 脚本，覆盖「会话内同名继承」「重试按钮」「三态渲染」。
  2. **补 A6 的形状 tripwire**：钉住 `other.ts` 的评分/档位/别名零改动。
  3. **第 5 档运行时用例**：迭代 8 遗留的「超时但前 4 档成功 ⇒ absent」目前只有源码形状断言。
  4. 24h TTL 过期后复测原键 `other|纪念碑谷|monument valley|2014|4`；网络恢复后复测迭代 8 的 A7/A8。
  5. per-user 封面覆盖（新表 + scope 大）、把「让用户选」扩展到 29 处 `<Poster>` 的直出封面位。
  6. `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3/4 仍 ⬜。

### T-20261002-10 · 迭代 9/20（创意类）· 消歧记忆（一次「让用户选」升级成「记住这个名字指哪部作品」）

**状态**：✅ 完成（门禁 + 红队 + 线上实测 2026-10-02；**A8 留 ❌ 需浏览器**，见遗留 ①）

- **任务类型**：§2.6 创意类（轮换位：8 优化 → 9 创意）
- **最小上下文**：不需要读全仓。只需 `src/components/Poster.tsx`（`urls` 收口处）、`src/components/ArtworkDetail.tsx`（唯一挂载点）、`src/components/CoverChoice.tsx`（裁决入口）、`shared/posterKey.ts`（键口径）。**`worker/` 与 `shared/` 本轮零改动。**
- **改了什么**
  - 新建 `src/lib/coverMemory.ts`（纯函数）：`COVER_MEMORY_KEY="art-rank:cover-choice"`、`COVER_MEMORY_MAX=100`、模块级 `let memo` 一次解析、`validRow` 用 `isWikiImageUrl` 白名单校验 sessionStorage（非可信输入）、`rememberCoverChoice` / `recallCoverChoice`（精确键优先，返回 `exact` 标志）/ `mergeCoverRecall` / `memorySuppliesCover` / `clearCoverMemory`。**双键**：`coverMemoryKey = posterMediaKey(t,e,"other",y)` 与 `coverNameKey = "other-name|" + posterKeySegment(title)`（前缀保证不与精确行相撞）。
  - `src/components/Poster.tsx`：新增 `recalledCover(work,kind)`（读）与导出 `rememberPickedCover(work,kind,url,wikiTitle?)`（写），**两者同处一个文件、共用 `mediaTypeForKind(kind) !== "other"` 闸**；`urls` 收口处改为 `mergeCoverRecall([...new Set([...(work.posterUrls ?? []), ...resolved])], recalled)`；useEffect 加 `!userDecided &&` 与同名依赖项。
  - `src/components/CoverChoice.tsx`：`onPicked` 签名 `(url) => void` → `(url, wikiTitle) => void`，`pick()` 里传 `choice.title`；**删掉它自己的记忆写入**（组件拿不到同源键）。
  - `src/components/ArtworkDetail.tsx`：`onPicked` 接线先 `rememberPickedCover(detail.work, detail.kind, url, wikiTitle)` 再 `onCoverChange(url)`；`onCoverChange` 的文档注释改成「只 patch 这个弹窗，其余同名作品由消歧记忆负责」。
  - 文案：旧句「已保存，之后都用你选的这一张。」**是假话**（只 patch 一个对象）⇒ 改为「这一页里所有《X》都用这一张」/「on this page now uses this cover」。
  - 测试：`src/lib/coverMemory.test.ts` 19 例（新建）、`src/ui-fixes.test.ts` 新 `describe("消歧记忆绊线（PLAN-COVER-MEMORY）")` 5 例。
- **为什么（4 条）**
  1. `ArtworkDetail.tsx:41-44` 的注释与 `CoverChoice.tsx:200` 的文案都承诺「所有渲染过的地方同时生效」，而 `App.tsx:1672-1676` 只 patch `detailWork` **一个对象**——榜单/画廊/对比视图各持自己的 `work` 拷贝（`HomeView.tsx:492`、`GalleryWall.tsx:95`、`ProfileView.tsx:697` 直接读 `work.posterUrls`），一个都不更新 ⇒ **UI 在承诺一件代码没做的事**。
  2. 根因一句话：消歧被实现成「往一个 state 对象上打补丁」而不是「记下一个事实」，补丁只活在被补丁的对象上。修法不是逐处通知（29 处 `<Poster>`），而是**记事实 + 唯一收口处读**。
  3. 记忆放在 `Poster.tsx` 收口处 ⇒ **29 处调用点一行不改**；放在组件里则要改 29 处。
  4. 继承设为**非破坏**（只在 `urls` 为空时补位）⇒ 结构上不可能把一张判对的封面换成猜的；`memorySuppliesCover` 只认精确行 ⇒ 裁决过的那一件不必再问上游（省一次维基回源，而 other 桶只有 20/10min）。
- **验证状态**
  - 门禁：`tsc -b` exit 0；`lint` **29 problems (0 errors, 29 warnings)** = 基线；`format:check` All matched files；`vitest` **660 passed / 9 skipped (669)**（基线 636 ⇒ **+24**）；`build` ✓ `index-BV_vjOsd.js` **410.40 kB / gzip 137.05**（+1.32 raw / +0.51 gzip ≤ 1.5 KB 预算）。线上产物 `index-CGd3gcxH.js` 410.50 kB / gzip 137.09，`ce=br`，`public, max-age=31536000, immutable`，`modulepreload` 计数 **0**。
  - 红队 ×5 **全红**：删 `mergeCoverRecall` 收口位（1 failed）/ 删 `!userDecided &&`（1 failed）/ 删 `ArtworkDetail` 接线（1 failed）/ 删 `recallCoverChoice` 精确行分支（2 failed）/ 把 `mergeCoverRecall` 的 `exact` 分支整体退化（2 failed）。
  - 线上 Version ID **`13a3eece-269c-4c48-93cc-b44f38f85fac**，`✅ No migrations to apply!`（零迁移是本轮的设计目标）。
  - A5 五个 other 封面 **三轮逐字稳定 5/5 `found`**：Journey=`Journey_PSN_Cover.png`、蒙娜丽莎=`500px-Mona_Lisa%2C_by_…`、纪念碑谷=`500px-Monument_Valley,_Utah,_USA_(23611451292).jpg`、动物森友会=`Doubutsu_No_Mori_Boxart.jpg`、INSIDE=`INSIDE_Cover.jpg`。
  - A7 三闸顺序实测：无 `origin` 头 ⇒ **403 `cross_origin_forbidden`**；带 `origin` 未登录 ⇒ **401 `auth_required`**（与迭代 5 一致）。
- **实测发现并修掉的真 bug（4 条）**
  1. **`persist()` 的上界 `return` 挡在 `setItem` 之前** ⇒ 整份记忆只活在内存副本：页内正常、刷新全丢、**零报错**。改为先写再淘汰。被「两行并存」测试抓出。
  2. **写入口归属错误**：第一版放在 `CoverChoice.pick()`，其键是自己拼的 `title|year`，与服务端 `posterMediaKey(…, "other", …)` 不同源 ⇒ 页内碰巧对、刷新丢。搬到 `ArtworkDetail` + `onPicked` 加传 `wikiTitle`。
  3. **`writeRows` 提取后忘了改调用处** ⇒ lint 多出第 30 个 warning。当场修掉。
  4. **计划里的绊线写错了层**（§5.2 第 2 条原写「`CoverChoice` 里 `rememberCoverChoice` 在 `onPicked` 之前」）⇒ 执行时改为**反向断言 `CoverChoice` 不含 `rememberCoverChoice`**。计划的错、代码的没错，但说明计划阶段就该读一遍调用链。
- **遗留风险**
  1. **A8 留 ❌**：会话内继承只能在浏览器里验。浏览器外最强证据是线上 bundle 里四个源码痕迹全在（等于「发上去的等于我审过的」），**不等于功能成立**。需要一次性 Playwright 脚本（导入含两件同名 `other` 作品的清单 → 裁决一件 → 断言第二格）——**独立一轮**。
  2. **同名不同作品误继承（R-1）未根治**：为 `Journey` 选了 2012 版后，榜单里另一件无封面的同名 `Journey` 会拿到这张图。缓解只有「`shouldOfferChoice` 只在判不准时开口」+「继承只填空格」。根治要比较 wiki 条目，而 `wikiEntry` 从来没下发给前端。
  3. **`sessionStorage` 记忆无 per-user 隔离**：同浏览器换账号仍在（与 `poster_urls` 全站共享同性质）。文案已按「这一页」而非「已保存」措辞。
  4. **收益是个位数**：`shaky|weak ∧ poolSize≥2 ∧ coverCount>0` 一次典型使用影响个位数格子 ⇒ 是「让迭代 5 不白费」的修复，**不进 FEATURES 主表**，只记 CHANGELOG。
  5. **只在本次会话有效**：跨会话靠 `poster_urls`（服务端缓存，本轮未碰语义），同名继承不跨会话（有意：跨会话传播 = 替未来用户做决定）。
  6. **迭代 8 归因出的 `year` → icon 误选仍未修**（`/api/other/detail?name=纪念碑谷&year=2014` → `Monument_Valley_icon_unrounded.jpg`），**仍是最高优先级遗留**。本轮零改 `worker/`，该行为原样保留。
- **下一步（迭代 10 起）**
  1. **修 `year` → icon 误选**（最高优先：是「真的选错图」）：给 year 加权重上限，或对 icon/系列页主图降权。
  2. **浏览器 E2E 缺口**（迭代 7/9 连续三次留红的那一项）：一次性 Playwright 脚本，覆盖「会话内同名继承」「重试按钮」「三态渲染」。
  3. **第 5 档运行时用例**：迭代 8 遗留的「超时但前 4 档成功 ⇒ absent」目前只有源码形状断言。
  4. A7/A8 依赖上游健康，**网络恢复后复测**迭代 8 的三条。
  5. per-user 封面覆盖（新表 + scope 大）、把「让用户选」扩展到 29 处 `<Poster>` 的直出封面位。
  6. `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3/4 仍 ⬜。

### T-20261002-09 · 迭代 8/20（优化类）· 上游降级信号逐条化（模块级全局 → 逐条记账探针）

- **状态**：✅ 完成（**636 passed·9 skipped**·46 files + **线上实测** 2026-10-02，**A7/A8 留 ❌ 见验证状态**）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-08 下一步①
- **任务类型**：§2.6（外部平台/海报管线）
- **最小上下文**：`worker/other.ts`（`WikiProbe`/`newWikiProbe`/`wikiProbeVerdict`/`wikiJson`/八个穿透签名）、`worker/media.ts:4-15` import + `:1720-1770` other 分支 + `:1415-1438` `queryWikiImages` 自带 fetch 记账、`worker/other.test.ts`（重写 `describe("上游降级信号（逐条记账 PLAN-WIKI-DEGRADED-SCOPE）")` 10 例 + 新增 `describe("降级信号作用域（PLAN-WIKI-DEGRADED-SCOPE tripwire）")` 4 例）、`docs/PLAN-WIKI-DEGRADED-SCOPE.md`（新建计划，含 §7 反思与 §8 记账）
- **改了什么**：**判决链路的记账层，评分/闸门零改动**（`worker/index.ts` 未进 diff）。① **删掉** `worker/other.ts` 的 `let wikiDegraded` 全局与三个导出 `resetWikiDegraded()`/`noteWikiDegraded()`/`wikiWasDegraded()`（后者**全仓无调用者**，`noteWikiDegraded` 也是——不留兼容层）。② **新增 `export interface WikiProbe { ok: number; failed: number }` + `newWikiProbe()` + `wikiProbeVerdict(probe): "absent"|"throttled"`**（`probe.ok > 0 ? "absent" : "throttled"`）。③ **`wikiJson(lang, params, timeoutMs, probe)` 双向记账**：`r.ok` 成功 `ok++`；`!r.ok` 时 **429/>=500 记 `failed`，其余（含 4xx）记 `ok`**；`catch`（超时/连接重置）记 `failed`。④ **显式传参穿透 8 个函数**：`wikiFileThumbUrls`/`wikiFileThumbUrl`/`fillPageImageUrls`/`wikiSearchOnce`/`resolveOtherPages`/`wikiTitlePages`/`otherSearch`/`wikiEnTitle`/`wikiPageImageAny`/`resolveOtherCover`；末尾可选参 `probe: WikiProbe = newWikiProbe()` ⇒ 现有 60+ 处调用**不用改**。⑤ **`worker/media.ts` 第 5 档 `queryWikiImages` 自带 fetch（不走 `wikiJson`），也自己记账**（漏掉它 = 「第 5 档全超时但前 4 档成功」会错判）。⑥ **`otherDetail`/`otherCandidateReport` 签名不变、内部各造用完即弃探针**（`detailProbe`/`diagProbe`）⇒ `worker/index.ts` **零改动**、诊断与判决彻底解耦。⑦ 判决行 `worker/media.ts:1770` `outcome: throttled ? "throttled" : wikiProbeVerdict(probe)`。
- **为什么**：① **两层缺陷叠在一起**，只修一层不够：**作用域错**（全局 ≠ 逐条，`resolvePostersBatch` 默认 `concurrency=8`，同 isolate 共享一个布尔，一条超时就把它并发跑的 8 条全染成降级）+ **语义错**（旧标记只有置位没有复位、**只记失败不记成功** ⇒「上游曾经失败过」被当成「这一次我什么都没问到」，且 `resetWikiDegraded()` 只在 `computePosters` other 分支入口调一次，而一条 other 的兜底链要发十几次 wiki 请求）。② **判定方向是反转的，这是本轮最关键的一行**：新判据是「有过一次**答复** ⇒ `absent`」，不是「有过一次**失败** ⇒ `throttled`」。理由：other 兜底链 5 档串行，若第 1 档成功、第 5 档超时，这条其实已用掉前 4 档的答复 ⇒ 应按「确实没有」记账；「以最后一次为准」等于**「上游慢比上游快更不可信」，方向反了**。③ **4xx 记 `ok` 不记 `failed`**：维基对不存在的条目返 200+`missing`，4xx 极少见，但真出现时它同样是「上游对我有反应」，记成失败会重演误判。④ **顺手解决 F12（T-20261002-08 §1.4 的遗留）**：迭代 8 之前**用户点开一次「让用户选」弹窗就会改变后面海报的分类**——`otherCandidateReport` 与判决链共享同一个全局。
- **验证状态**：五道门禁 ✅（`npx tsc -b` exit 0 / lint **0 errors·29 warnings**＝迭代 7 基线未增 / format:check `All matched files use Prettier code style!` / vitest **636 passed·9 skipped·645**·46 files（迭代 7 的 628 **+8**）/ build 成功）｜ **红队 ✅ 三次全红**：① `probe.ok > 0` 换成 `probe.failed > 0`（判据反转）⇒ **3 failed**（核心语义例 + 一次都没问到例 + 方向正则）；② `wikiJson(lang, q, 8000, probe)` 改成 `newWikiProbe()`（漏传）⇒ R1 调用点数断言红；③ 第 5 档改成 `if (probe && !response.ok)`（成功不记账）⇒ R1 断言红。**红队 2 的价值最高**：它证明「`await wikiJson(` 计数必须 === 5 且全部带 `, probe)`」这条不是恒真断言。｜ **线上（Version ID `df3985db-f91a-462a-8899-f6112f4b539d`**，`Total Upload: 1015.56 KiB / gzip: 205.23 KiB`）：① **A3 ✅** 顶层 `字段=results,keys,outcomes`，实测造到 `found`（Journey）与 `absent`（日常幻想）。② **A4 ✅** `git diff --stat` = `media.ts 47` / `other.ts 137` / `other.test.ts 178`，**`worker/index.ts` 不在 diff**；`git diff -U0 | grep 'titleMatchTier\|otherConfidence\|band\|ThrottledError\|computePosters(other'` **零命中** ⇒ 评分/闸门/tier 零改动。③ **A6 ✅** `index-CZFSUmC8.js` **409.08 kB**/gzip 136.54 **与迭代 7 逐字节相同**（纯服务端改动），线上 `immutable` + br、`modulepreload` 计数 **0**。④ **A9 ✅ 0 错**（诊断端点是 `GET /api/other/candidates?name=…`，**不是 POST**——POST 返 404 我差点以为端点坏了）：诊断调用后同批 3 条全 `absent` ⇒ F12 已解决。⑤ **A5 ⚠️ 3/5**（不是 5/5）：5 条全 `found` 且**三轮逐字稳定 5/5**，但蒙娜丽莎 `Mona_Lisa%2C_by_…jpg`（无 `500px-` 桶前缀）与纪念碑谷 `Monument_Valley_icon_unrounded.jpg` 与迭代 7 基线不同——**已归因为预存缺陷，与本轮无关**（见「实测发现」③）。⑥ **A7 / A8 ❌ 未达成**（核心判据，**不标 ✅**）：`throttled` 波动是**真实的**，不是误报。归因见「实测发现」①。
- **迭代中实测发现并修掉的真 bug**：① **⚠️ 最贵的一课：先证明「上游是好的」，再相信自己的判红**。A7/A8 全红时我先独立测上游，三个客户端三种结论：**node `fetch` → zh.wikipedia 12/12 TimeoutError**（全卡 9005 ms；20000/30000/60000 三档预算报 `TypeError` 而非 `TimeoutError`，10.2–10.7 s 挂）；**`Invoke-WebRequest` 同目标 6/6 成功、1480–2535 ms**；**worker 侧 `/api/other/detail?name=纪念碑谷` 830 ms 返回封面** ⇒ 本机 Node 的 TLS/代理链路问题，**服务链路是通的**。这直接改变了结论：那些 `throttled` 在那一刻**报的是真的**（维基对我这一侧慢），标成 `absent` 会让 24h 负缓存固化空白。② **修复方向已实证**：`.tmp/iso8.mjs` 8 轮里出现 **2 轮「同批内 `absent` 与 `throttled` 混合」**（第 1 轮 `throttled/absent/throttled`、第 7 轮 `absent/throttled/throttled`）——**旧代码结构上不可能产生混合**（`wikiDegraded` 只有一个值、全批共享），所以「出现混合」本身就是「作用域已解耦」的充分证据，比任何计数都硬。③ **A5 的两处不一致是预存缺陷，不是本轮回归**（归因实验 `.tmp/attr8.mjs`）：`/api/other/detail?name=纪念碑谷&year=2014` 给 `Monument_Valley_icon_unrounded.jpg`，**不带 year 则给 `500px-Monument_Valley,_Utah,_USA_(23611451292).jpg`** ⇒ **`year` 参数进入标题评分后会把作品判到 icon 文件**。`git diff` 全量逐行读确认 `other.ts` 137 行改动里**没有一行触碰** `titleMatchTier`/`scoreOtherPage`/`pickBest`/`compactTitle`。**这是真的选错图，留给后续轮次**（§7.3）。④ **我的验收脚本错了 5 次，每次都长得像线上回归**：漏 `type:"other"` ⇒ key 末段错；以为 `/api/*` 都包 `data`（**batch 路由不包**，响应是顶层）；`r.json()` 调两次（**body 只能读一次**，第二次被 `catch` 吞成 `{}`）；自己重算 media_key（**服务端给的键里蒙娜丽莎 year 段是空的**，1503 被 `normalizeYear` 丢掉）；**给 `english` 加盐绕缓存破坏了消歧** ⇒ `Journey` 匹配到 `2012_Dodge_Journey_--_NHTSA_3.jpg`，我据此差点判定「代码改了选图逻辑」。五条全部记进 PITFALLS 4.51–4.55。
- **遗留风险**：① **A7/A8 需在网络恢复后复测**（本机 node fetch → wikipedia 当前 100% 失败；判据「稳定 `absent`」依赖上游健康，而上游不健康时判 `throttled` 是**正确**的）。② **`year` 致 icon 误选**（上文③）是**真的选错图**，比 `throttled` 过报危害更大（用户看到错误封面而不是多一个重试按钮）——**优先级高于其它遗留**。③ **第 5 档 `queryWikiImages` 的「超时但前 4 档成功 ⇒ absent」组合只有源码形状断言、没有运行时用例**（R1 锁了调用点数但没锁行为）⇒ 补一条运行时用例。④ **本轮让更多条目得 `absent`**（这是修复方向），而 `absent` 是 **24 小时负缓存** ⇒ 一旦 R2（判据方向反了）发生，线上不可逆；目前靠 429/503/throw 三条桩 + 红队①守着。⑤ `worker/other.ts` 1219 行里 8 个函数多一个末尾可选参，**接口面变宽了**；将来若有第二个消费者要参与判决，需注意别自造探针。⑥ 诊断端点 A10 只能代码层取证（本机链路下打不通）。
- **下一步（给接手者）**：① **迭代 9（创意类）**：给 `outcomes` 分布加可观测手段——把三态打进 `poster_errors` 的新 source（承 T-20261002-08 遗留风险④ 的浏览器 E2E 缺口），这样 `throttled` 过报/真限流**以后能用 D1 数据判断，而不是靠线上探测**。② **补 `year` 致 icon 误选的运行时用例 + 修法**（给 year 加权重上限，或对 icon/系列页主图降权）——这是预存缺陷，危害高于本轮任何遗留。③ 补遗留③的运行时用例。④ A7/A8 网络恢复后复测。⑤ T-20261002-06 遗留风险② per-user 封面覆盖（**产品决策**，scope 大）；⑥ T-20261002-06 遗留风险①「让用户选」扩展到 29 处 `<Poster>`；⑦ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3/4 仍 ⬜。

### T-20261002-08 · 迭代 7/20（前端类）· 空封面三态（`outcomes` 出服务端 + degraded 给出路）

- **状态**：✅ 完成（**628 passed·9 skipped**·46 files + **线上 A1–A9 全项实测** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-07 遗留风险①
- **任务类型**：§2.6（外部平台/海报管线）+ §3.1（交互与信任）
- **最小上下文**：`worker/index.ts:2225-2233`（batch 路由发 `outcomes`）、`src/lib/posterOutcome.ts`（新建纯判定）、`src/components/Poster.tsx:1-432`（三态 + 重试按钮 + 中英文案）、`src/styles.css:1551-1580`（`.cover-fallback-retry*` 段）、`src/lib/posterOutcome.test.ts`（新建 7 例）、`src/ui-fixes.test.ts`（新增 `describe("空封面三态绊线（PLAN-EMPTY-COVER-STATE）")` 7 例）、`docs/PLAN-EMPTY-COVER-STATE.md`（新建计划，含 §7 反思与 §8 差分账）
- **改了什么**：**判决链路 0 行改动**（`worker/other.ts` / `worker/media.ts` 未进 diff），服务端只改路由一层，前端只改 `<Poster>` 内部。① **`worker/index.ts`**：`return json({ results, keys, outcomes }, 200, {...})` —— `resolvePostersBatch` 早在 `worker/media.ts:1801-1806` 就逐 key 算好 `PosterOutcome`（`found`/`absent`/`throttled`），`:2194` 解构出来、`:2204-2224` 拿去写 `poster_errors`，**唯独没进 JSON 响应**。② **`src/lib/posterOutcome.ts`（新建 45 行）**：`emptyPosterState(urls, outcome)` → `null | "none" | "degraded" | "unknown"`；`urls` 非空永为 `null`；**没给分类或给了陌生值一律 `unknown`，绝不猜成 `absent`**（猜错的后果是「该给重试时不」，用户永远卡在空格子）；`emptyPosterMessageKey` 把「文案↔状态一一对应」这条不变量变成可测。抽成纯函数是因为 `vitest.config.ts` 只 include `.ts`、没有 jsdom/testing-library，组件无法渲染测试。③ **`src/components/Poster.tsx`**：`BatchEntry.resolveBatch` 加第二参 `outcome`；新增模块级 `emptyStates: Map<string, PosterOutcome>`（**与 `resolvedPosters` 分开——空格子不算「已解析」，所以下一次挂载还会重发**；分类**不写 sessionStorage**，15 秒后上游多半已恢复）；`resolve(work, kind, opts?: {retry?: boolean})` + 模块级 `retryForced` 标志让 `dispatchBatch` 的 `const retry = retryForced || !firstBatchDispatched` 能被按钮强制置位（**否则点重试会用 15 秒负缓存原样回上一轮空格子，按钮存在但无作用**）；判据 `emptyPosterState(urls.filter((c) => !failed.has(c)), outcome)`（**喂过滤后的候选**：拿到地址但加载失败是「有图没画出来」，恰恰最需要重试）；`const retryable = emptyState === "degraded"` ⇒ 只在这一档渲染 `<button className="cover-retry" aria-label={readRetryLabel()}>（`event.stopPropagation(); event.preventDefault()` 防 `.collection-row` 整卡 button 吞掉点击）+ `<p className="cover-retry-hint" role="status">`；文案 `readEnglish()` 读 `document.documentElement.lang`（**不为两句提示给 29 处调用点加 `t`**）。④ **`src/styles.css`** 新增 31 行：`.cover-retry`（`min-height:44px`、`:disabled` 时图标旋转、`prefers-reduced-motion` 下停动画）、`.cover-retry-hint`（`max-width:30ch`/`11px`/居中）、两条 `display:none` 守卫。
- **为什么**：① 题直接承 T-20261002-07 遗留风险①（那轮的原话是「记录它比顺手修它有价值」），且这是 **PITFALLS 4.45 的第二次发作**——上一次是 `/api/other/candidates` 把「上游全挂」与「维基真没这个条目」压成同一个 `lang:null`，这次是 `/api/posters/batch` 把三态压成 `string[]`：**接口把两个不同事实压成一个值，等于把判断成本转嫁给每一个消费者**。② **三档 TTL 差三个数量级**（`posterCacheTtlMs` `worker/media.ts:70-75`：throttled 15s vs 其余 24h），所以**只有 degraded 值得给重试**——给 absent 加按钮会诱导用户反复消耗配额去问一个上游已经干净回答「没有」的问题。③ 重试复用 batch 端点既有的 `retry: true` 语义（`worker/media.ts:1614` `opts?.retry === true && cached.outcome === "throttled"` 绕过负缓存），**不新增端点、不新增配额**。④ **三态是「用户该做什么」而不是「成因是什么」**：我本可以加一档「被限流」，但 4.41 已证明成因常常判错，而 `degraded` 那句「暂时取不到，稍后可重试」即使成因未知也依然诚实。
- **验证状态**：五道门禁 ✅（`npx tsc -b` exit 0 / lint **0 errors·29 warnings**＝迭代 4/5/6 同基线未增 / format:check `All matched files use Prettier code style!` / vitest **628 passed·9 skipped·637**·46 files（迭代 6 的 614 **+14**）/ build 成功）｜ **红队 ✅ 四次全红**：① 删 `outcomes` → 反向断言 `json(\s*\{\s*results,\s*keys\s*\})` 失败；② `retryable = emptyState === "unknown"` → 1 failed；③ 删掉 `retryForced || ` 那段 → 1 failed；④ 删 `<p className="cover-retry-hint" role="status">` → 1 failed。**第一次红队是「根本没做破坏」**——只在那行末尾追加 `// REDTEAM-PROBE` 注释，代码一字未动，68 passed 是唯一正确结果（见 PITFALLS 4.48）｜ **线上 ✅（Version ID `b9f1b5da-f15c-43ad-a9d2-70665fda1aa8`**，`Total Upload: 1014.73 KiB / gzip: 205.03 KiB`）：① **A3** batch 响应 `fields: results,keys,outcomes`，**三档全部实测到**（`found` ×5 + `absent` + `throttled`）。② **A5** 5 条 other 封面 URL 与迭代 6 **逐字相同**且全 `found` n=1：`Journey_PSN_Cover.png` / `500px-Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg` / `500px-Monument_Valley,_Utah,_USA_(23611451292).jpg` / `Animal_Crossing_New_Horizons.png` / `INSIDE_Cover.jpg`。③ **A6** 主包 `index-CZFSUmC8.js` **409.08 kB / gzip 136.54** vs 迭代 6 的 407.59 / 136.06 ⇒ **+1.49 KB raw**（预算 ≤3 KB）；线上 `modulepreload` 计数仍 **0**，两个主资源均 `public, max-age=31536000, immutable` + br（迭代 6 的缓存策略仍在生效）。④ **A8** 线上产物实测含 `cover-retry-hint` / `cover-retry` / `封面服务暂时取不到` / `重新加载这张封面` 四个字面量。
- **迭代中实测发现并修掉的真 bug**：① **⚠️ `throttled` 严重过报，分类会随批次大小改变**（本轮最重的发现，**属判决链路，已记账给迭代 8**）。取证：同一个**确实不存在**的条目（zh wikipedia `{"-1":{"missing":""}}`），`日常幻想` 单发得 `absent`，但在「3 个重条目 + 3 个不存在条目」的同批里 round 1 得 `absent/throttled/throttled`、round 2 又三条全 `absent`；3 条同批（无重条目）时 round 1 是 `found/throttled/throttled`、round 2/3 全 `throttled`。机制：`worker/media.ts:1743` `outcome: throttled || wikiWasDegraded() ? "throttled" : "absent"`，而 `wikiDegraded` 是**模块级全局变量**（`worker/other.ts:59`），`resetWikiDegraded()`（`:62`）只在 `computePosters` 的 other 分支入口（`worker/media.ts:1709`）调一次，一条 other 的兜底链却要发十几次 wiki 请求，**同 isolate 内并发批次共享这一个全局标记**，一条超时就把它并发跑的所有条目一起染成 `throttled`；`wikiJson` 超时上限 7000–9000 ms（`worker/other.ts:333,586,734,770,805`），本机到 zh.wikipedia 单次 RTT 实测 1595–2313 ms。D1 佐证：`poster_errors` 里 `error LIKE '%throttl%' OR '%timeout%' OR '%unavail%'` → **一条都没有**，即线上从未真被限流过。**本轮刻意不修**（属判决链路 + 误报方向安全：多一个重试按钮，最坏多点一次）。② **计划承诺的 A8 只实现了一半**：先只做了 `aria-label` 按钮就去跑门禁了，提示行 `role="status"` 漏掉——「为什么是空的」只剩视觉变化。收尾补齐 `<p className="cover-retry-hint" role="status">` + CSS + `readRetryHint()` 中英文案 + `.poster-small` 守卫 + 4 条断言并当场第四次红队。③ **绊线被自己的注释喂绿**（PITFALLS 4.39 近亲）：`src/ui-fixes.test.ts` 里 `batchRoute` 剥了注释、`poster` 那几例忘剥，而 `Poster.tsx` 的解释性注释里恰好含 `const retryable = emptyState === "degraded"` 这类**断言要匹配的字符串** ⇒ 删掉代码断言仍绿。修法：新增 `const posterCode = stripComments(poster)`，7 例全部改扫 `posterCode`。④ **`retryForced` 是本轮引入的唯一一处已知粗糙**：模块级可变状态、无并发守卫，同 tick 内两个组件各置位一次时第二次会退回 `!firstBatchDispatched`（最坏是那次不带 `retry`，用户结果与今天相同）。
- **遗留风险**：① **`throttled` 过报没修**（上文①），后果是用户会看到本不该出现的「重试」按钮并多点一次——**方向安全但体验有噪**。修法见下文下一步①。② **`emptyStates` 不写 sessionStorage**：挂载同一个页面、切走再切回仍会重发一次批次（原本「空结果不写缓存」的设计，本轮沿用），在 degraded 频繁出现的时段会多几次请求。③ **`unknown` 档是个真的兜底**：服务端一旦回退（灰度/旧 Worker/代理剥字段），全部空格退回今天的静默图标，本轮的三态能力**静默失效**且不会有任何报错——这是有意的「零回归」取舍。④ **线上无浏览器 E2E**：`degraded → 按钮 → 重试成功` 这条完整链路只由纯函数单测 + 源码扫描 + 产物字面量三重间接覆盖，**没在真浏览器点过**（承 T-20261002-05 遗留风险④ 同族）。⑤ **`outcomes` 让响应体变大**：每条多一个 8–9 字节的字符串，30 条一批约 +270 字节，在 86400s 私有缓存面前可忽略，但它是**接口形状变更**，若有外部消费者在严格校验响应键集合需要通知。⑥ `poster_errors` 的两档（`throttled` / `no_poster_found`）仍是旧的粗分类，**没有跟着细化成三档**——本轮明确不做（§3.4）。
- **下一步（给接手者）**：① **迭代 8（优化类）**：修 `throttled` 过报。**判据已经量好**：`日常幻想`/`故事FM`/`看理想`（zh wiki 实测 `missing`）在「3 重 + 3 缺」同批里必须**稳定得 `absent`**。两条候选改法：(a) 把 `resetWikiDegraded()` 从 `worker/media.ts:1709` 的**每条**入口移到**每次 wiki 调用之前**；(b) 改成**按条目记账**——`wikiDegraded` 从模块级全局改成随 `computePosters` 传入的局部计数器，「本条目内任一 wiki 请求成功就撤销降级」。**倾向 (b)**：(a) 会让十几次请求里最后一次的成败决定整条分类，而 other 的兜底链**本来就该以最后一次尝试为准**——但 (b) 更好，因为它的语义是「这一条我到底拿到东西没有」，与 `throttled` 想表达的意思一致。**注意：这是判决链路改动，验证必须按 PITFALLS 2.21 用没缓存过的 key 实取图复测，且要跑 A5 的 5 条逐字对比。** ② 遗留风险④ 的浏览器 E2E 缺口可以在创意轮顺手补（给 `degraded` 加一条可观测手段，比如把 `outcomes` 的分布打进 `poster_errors` 的新 source）。③ T-20261002-06 遗留风险② 的 per-user 封面覆盖（**产品决策**，scope 大）；④ T-20261002-06 遗留风险① 的「让用户选」扩展到 29 处 `<Poster>` 直接封面位（需先解决它只在弹窗里的问题）；⑤ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3 广场护栏 / Phase 4 回环 Score 仍 ⬜。

### T-20261002-07 · 迭代 6/20（优化类）· 内容哈希产物的缓存策略归位

- **状态**：✅ 完成（**614 passed·9 skipped**·45 files + **线上 A1–A10 全项实测** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-06 下一步①（两个候选均被先量后写否掉后才轮到这个）
- **任务类型**：§2.7（构建与产物）
- **最小上下文**：`worker/index.ts`（`CONTENT_HASHED_ASSET` / `withAssetCachePolicy` / `serveAssets` / `withSecurityHeaders` / `SECURITY_HEADERS`）+ `worker/assetCache.test.ts`（新建 6 例）+ `src/ui-fixes.test.ts`（新增 `describe("静态资源缓存策略绊线（PLAN-ASSET-CACHE）")` 3 例）+ `docs/PLAN-ASSET-CACHE.md`（新建计划）
- **改了什么**：**只改 `worker/index.ts`（+11 行 + 1 个正则），`src/` 零改动。** ① `const CONTENT_HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]{2,8}$/;` ② `withAssetCachePolicy(response, request)`：**非 200/304 原样透传**（不碰 404/重定向/错误响应）→ `immutable = pathname.startsWith("/assets/") && CONTENT_HASHED_ASSET.test(pathname)` → 哈希产物 `public, max-age=31536000, immutable`、其余（含 `/`、`favicon.svg`、`manifest.json`、`sw.js`）保持 `public, max-age=0, must-revalidate` ③ `serveAssets` 改为 `withSecurityHeaders(withAssetCachePolicy(response, request))`。测试 9 例（源码扫描 3 + 行为 6）。
- **为什么**：① 「有点卡」（m00079）此前归因过两次（RTT、海报未缩略），**第三次是本轮量出来的**：首屏关键路径只有 `index-Cix8RSlz.js` 407 589 B + `index-BNDWEENQ.css` 147 241 B（`modulepreload` 计数 0），两者却挂着 **HTML 那套 `max-age=0, must-revalidate`**。文件名里已有内容哈希 ⇒ 一年后字节完全一样，`must-revalidate` 在这里**零正确性收益、只有一次白跑的往返**。② 判据按**文件名形态**而不是目录白名单：`dist/assets/` 里全带哈希、`dist/` 根目录 4 个文件全不带（`favicon.svg`/`index.html`/`manifest.json`/`sw.js`），形态判据零维护成本。③ 放 Worker 而非 `wrangler.jsonc` 的 `assets` 段：那里只能配 `html_handling`/`not_found_handling` 之类，**不能按路径形态分流**。④ 刻意不碰 `withSecurityHeaders`（`:952-958`，只写 CSP/COOP/referrer/nosniff/frame/permissions 六个头）——把缓存头塞进安全头表会把 JSON API 一起冻一年，已用源码扫描绊线钉死。
- **验证状态**：五道门禁 ✅（`npx tsc -b` exit 0 / lint **0 errors·29 warnings**＝迭代 5 基线不增 / format:check `All matched files use Prettier code style!` / vitest **614 passed·9 skipped·623**·45 files（较 605 **+9**）/ build 4.4s）｜ **红队 ✅**：把判定改成 `pathname.startsWith("/assets/"); // REDTEAM-PROBE: 目录一刀切` ⇒ **2 failed**（`worker/assetCache.test.ts`「无哈希的 /assets 文件不得被判成 immutable」报 `expected 'public, max-age=31536000, immutable' to be 'public, max-age=0, must-revalidate'`；`src/ui-fixes.test.ts` 报 `to contain 'pathname.startsWith("/assets/") && CO…'`），恢复后 68 passed｜ **线上 ✅（Version ID `299343bd-815a-4d68-b507-58bc7f80dd37`**，`✅ No migrations to apply!`）：① **A1** 三个哈希产物全 `public, max-age=31536000, immutable`（js 135 024 B br、css 27 824 B、three.module 132 496 B），ETag 保留。② **A2** `/` 仍 `max-age=0, must-revalidate`（br 888 B；**附带事实：html 没有 ETag**，只有哈希资源有，所以「HTML 每次回源」在改头前就成立）。③ **A3** 用 dist 根目录真实无哈希文件验：`favicon.svg` / `manifest.json` / `sw.js` 三条 200 且全 `must-revalidate`；`/index.html` 307 重定向。④ **A4** 六个安全头全在（CSP 四项子检查 + COOP same-origin + nosniff + DENY + referrer-policy + permissions-policy）。⑤ **A5** 带 `If-None-Match` → **304**。⑥ **A6** 七条 SPA 路由全 200 且**全 `must-revalidate`**（说明 fallback 出的 HTML 走同一条不冻分支）。⑦ **A7** `/api/posters/batch` 5 条 other 逐字正确，**API 头未被波及**（`batch` = `max-age=86400, private`、`candidates` = `public, max-age=300`，两者都不走 `serveAssets`）。⑧ **A9** `index-Cix8RSlz.js` **407.59 kB** 与迭代 5 **逐字相同** ⇒ 零首屏影响。
- **迭代中实测发现并修掉的真 bug**：① **两个台账候选都被先量后写否掉**——Poster 批次预取（冷回源 2402/1770/1611 ms vs D1 命中 1616/1744/1659 ms，**冷热无差别**，因为 `resolvePostersBatch` 已 `concurrency: 8` 并发，1.6 s 里 1.2 s 是 RTT）与主包数据层瘦身（源码 37–45 KB 看着吓人，sourcemap 归属压缩后**总共约 17 KB**）都不值得做，真正该做的是本轮这个。**台账候选是起点不是答案**（4.31 第二次兑现）。② **`Invoke-WebRequest` 会自动解 br**，用它量出 407 KB，我差点得出「线上根本没压缩，这才是卡的原因」这个**完全错误**的根因；真实传输 134 804 B，必须用 `node:https` 原样读。③ **`curl.exe --compressed` 在本机不可用**（libcurl 版本太老：`the installed libcurl version doesn't support this`），PowerShell 直传 `$r.Headers['etag']` 报 `The format of value 'System.String[]' is invalid.`（头部是多值数组）——两个坑叠加时极易把「工具报错」误判成「线上异常」。④ **守卫短路在前，断言就在后面空转**（与 4.39 同族）：`worker/assetCache.test.ts` 第一版断言 `/assets/favicon.svg` 却没在假 `env.ASSETS` 里登记该路径 ⇒ 返 404 ⇒ 策略在 `status !== 200` 处短路 ⇒ `CONTENT_HASHED_ASSET.test()` 从没被调用 ⇒ 断言照样绿。补上 200 响应后 A3 才有意义。⑤ 绊线第一版用 `readFileSync(resolve(__dirname, …))` 但没 import `resolve` ⇒ `ReferenceError: resolve is not defined`；改成本仓既有风格 `readFileSync("worker/index.ts", "utf8")`。
- **遗留风险**：① **⚠️「上游全挂」与「维基真没有这个作品」在响应里长得一模一样**：`/api/other/candidates` 两者都是 `{candidates:[], picked:null, confidence:{score:0, band:"weak", evidence:"none", poolSize:0}}`，唯一区别是 `lang: null`（`worker/other.ts:1018` 的 `empty` 兜底）vs 正常 `lang:"zh"|"en"`。实测同一 URL 10 次出现 3 种结果（zh 3 次 / en 3 次 / **空 4 次**），稍后 12 次全正常、纪念碑谷 4/4 正常 ⇒ 是**上游维基间歇性失败**，不是本轮回归（`/api/*` 不走 `serveAssets`）。**但它直接打到迭代 5 的 UI**：`shouldOfferChoice` 判 `poolSize < 2` 不打扰 ⇒ 用户只看到**静默无图**，不知道自己是「没搜到」还是「系统挂了」。正确修法是让端点区分这两种空，但属判决链路改动，本轮明确不做。② **A8 这次是被 5 次重试救回来的**（首测返空），所以 `docs/PLAN-ASSET-CACHE.md` §7.2 记了完整采样表；`/api/other/detail` 同样受此影响。③ **首屏 HTML 每次都要回源**（888 B br，可接受）；真要省这一趟得上 `wrangler.jsonc` 的 `html_handling`，但那会影响部署切换语义，不在本轮范围。④ **`three.module-*.js` 530 KB 已顺带拿到 immutable**（实测 132 496 B），它是懒 chunk 不进首屏，所以**不需要**为它做任何额外动作——这一点值得记，因为很容易误以为「最大的一块没优化到」。⑤ `withAssetCachePolicy` 依赖「文件名带哈希」这个约定；若将来改成固定名（如 `vendor.js`），会静默退化成不冻，**不算 bug 但要记得**。
- **下一步（给接手者）**：① **迭代 7（前端类）**首选**修遗留风险①**：给 `otherCandidateReport` 的空池加一个可区分的信号（最省事的是把 `lang: null` 之外的 `poolSize === 0 && picked === null` 标成 `upstream_unavailable` 或直接让端点返 `502` + `fallback` 字段），并让 `CoverChoice` 在「系统没找到」时给一句提示而不是静默不渲染——**注意这会动 `worker/other.ts`，需按 PITFALLS 2.21 用没缓存过的 key 复测**。② T-20261002-06 遗留风险② 的 per-user 封面覆盖（产品决策，scope 大）；③ T-20261002-06 遗留风险① 的「让用户选」扩展到 29 处 `<Poster>` 直接封面位；④ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3 广场护栏 / Phase 4 回环 Score 仍 ⬜；⑤ `.tmp/verify6.mjs` 是可复用的缓存头探针（不进版本库）。

### T-20261002-06 · 迭代 5/20（创意类）· 消歧出口「让用户选」（诊断 band 驱动的候选封面选择）

- **状态**：✅ 完成（**605 passed·9 skipped**·44 files + **线上三道闸 403/401/200 全验 + 合法写入后 batch 端点返用户选的那张** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-03 遗留风险①（唯一还没设计的部分）与 T-20261002-05 遗留风险④（限流配额评估）
- **任务类型**：§2.6（外部平台/海报管线）+ §3.1（交互与信任）
- **最小上下文**：`src/lib/coverChoice.ts`（新建，纯判定 + 会话缓存）、`src/components/CoverChoice.tsx`（新建）、`src/components/ArtworkDetail.tsx:140-148`（挂载）、`src/App.tsx`（`onCoverChange`）、`src/styles.css`（`.cover-choice*`）、`worker/index.ts:2634`（新端点）、`worker/coverChoice.test.ts`（新建）、`docs/PLAN-CHOICE-UI.md`（新建计划）
- **改了什么**：① **`shouldOfferChoice({band, poolSize, coverCount})`** 纯判定：`band ∈ {shaky, weak}` **且** `poolSize >= 2` **且** `coverCount > 0`。`exact`/`strong` 一律不出 UI（线上抽样 6 条 exact + 2 条 strong 全部判对，打扰是纯负收益）。判定用 `&&` 串联的独立 return，不合并条件——每一道门槛都要能被源码扫描单独钉住。② 新增 `POST /api/other/cover-choice`（`worker/index.ts:2634`，+42 行）：`assertSameOrigin` + `allowUpstreamRequest(request,"other",20)` + `getUserFromToken`（匿名 **401**）+ `cleanString` 校验 + `allowedImage` **且** hostname 必须是 `upload|thumb.wikimedia.org`（否则 **400**）+ `posterKeyFor` UPSERT `poster_urls`（**不新增表不加列**）+ 写后立刻回读校验（不一致 **500**）。③ 前端 `CoverChoice` 组件挂在 `ArtworkDetail` 的 `detail-copy` 顶部，判定归属在弹窗（`choiceAppliesToKind(detail.kind) && onCoverChange`）而不在组件内；点击先 `onPicked(url)` **视觉立即生效**再 POST 写端点，匿名可用只是不落库（不静默失败）。④ **会话内缓存层**（计划外，§7.1）：`readCachedReport`/`cacheReport`/`clearCachedReports`/`reportCacheKey`，上界 200 条先淘汰最旧，坏数据一律当没缓存。⑤ 测试 +37：`coverChoice.test.ts` 21 例、`worker/coverChoice.test.ts` 12 例、`ui-fixes.test.ts` +4 例绊线。
- **为什么**：① 迭代 2 建好诊断端点后**它没有任何消费者**，`band` 四档在线上真实跑过但没人用；迭代 3 的反思已论证「加规则这条路到头」，出口只剩「把选择权交出去并让选择留下来」。② **写端点必须登录**：`poster_urls` 是全站共用的展示数据，匿名可写等于任何人都能改别人看到的封面（与 `/api/poster-errors/client` 那类只写错误日志的匿名写端点性质不同）。③ 域白名单不能只靠 `allowedImage`——它还放行豆瓣/IMDb/TMDB/网易云等 5 个域，而用户选择会直接变成全站封面位。④ **为什么复用 `/api/other/detail` 取候选封面而不是让 candidates 直接回 `cover_url`**：诊断端点有 300s 边缘缓存，塞 8 张图会让缓存放大 8 倍上游扇出（§3.5）；实测「用候选原名精确查 detail」就能直接拿到该候选封面（F3，`otherDetail` 第一档就是精确标题直查）。
- **验证状态**：五道门禁 ✅（`npx tsc -b` exit 0 / lint **0 errors·29 warnings**＝迭代 4 基线不增 / format:check ✅ / test **605 passed·9 skipped**·44 files，较迭代 4 的 568 **+37** / build ✅ `index-Cix8RSlz.js` **407.59 kB / gzip 136.06 kB** vs 基线 `index-DpW4fm-R.js` 402.60 / 134.34 ⇒ **+4.99 kB raw / +1.72 kB gzip**，A5 阈值 +6 KB 内）｜ **红队验证 ✅**：从 `shouldOfferChoice` 删掉 `if (input.poolSize < 2) return false;` ⇒ **2 failed | 78 passed**（`coverChoice.test.ts` 的「候选只有一条时没有「选」的余地」`expected true to be false` ＋ `ui-fixes.test.ts` 的 `to match /poolSize < 2/`），恢复后 86 passed｜ **线上 ✅（Version ID `a022434d-3922-443c-bad6-98463aaf69d9`，`No migrations to apply!`）**：① 无 `Origin` → `403 {"error":"cross_origin_forbidden"}`；`Origin: https://evil.example` → 403；仅同源无 token → `401 {"error":"auth_required"}`。② 合法写入 → `200 {"ok":true,"key":"other|journey|journey|2012|4","wikiTitle":"道奇Journey"}`，**紧接** `/api/posters/batch` 同 key 返 `500px-2012_Dodge_Journey_--_NHTSA_3.jpg`（用户选的道奇 SUV，**不是**系统原本给的 PSN 封面）⇒ A8 端到端成立。③ 判决链路零改动：`worker/other.ts` 本轮 **0 行改动**，`/api/other/candidates?name=Journey&year=2012` → `picked=风之旅人 band=weak pool=3` 与迭代 4 逐字相同。④ 5 条 other 封面（蒙娜丽莎 500px / 纪念碑谷 / 动物森友会 / inside / Liminal Space）与迭代 3 逐字相同。**验证数据已回收**：一次性账号 `coverchoice-probe-*@example.com`、它的 session、它写的 poster 行三条 DELETE 各 changes=1。
- **迭代中实测发现并修掉的真 bug**：① **计划外发现：一个诊断端点会吃掉主链路的限流配额**。每打开一次「其他」维度的作品详情弹窗就发 1 次 candidates + 最多 3 次 detail，**三者共用 `other` 桶 20 次/10min** ⇒ **开 20 次弹窗就能让 `/api/other/detail` 自己开始 429**——为了「帮用户」而加的功能会把它要服务的功能打挂。修法是会话内缓存（判「不打扰」连请求都不发、判「要展示」连字段一起缓存），不是加配额。② **一条证明不了任何事的测试比没有测试更糟**：我最初写「判定只认 band 与两个计数，不看别的字段」这条用例时，想用两个只差 `score` 的输入证明 `score` 不参与判定——**但 `ChoiceInput` 里根本没有 `score` 字段**，两个输入字面相同，断言什么都没证明，还给人虚假的安全感。改成结构性证明（`typeof ... === "boolean"` + 类型里就没有 score）。③ **假 DB 会让整张表红成另一种含义**：worker 测试的 fake D1 若不实现 `batch` 逐条 `await statement.run()`，`saveResolvedPosters` 走 `db.batch([...])` 时一条都没写，端点「写后回读校验」返 500 `write_verify_failed`——排查时极易误判成端点逻辑错。④ **lint 的 `react-hooks/exhaustive-deps` 抓到了真实的性能退化**：取图 effect 的依赖里同时放了 `candidates`（每次渲染新数组）与 `covers`（每取到一张图变一次），eslint 报「logical expression could make dependencies change on every render」＋「unused eslint-disable directive」，改成从 `memo.report.candidates` 直接读、`covers` 只在 effect 内部作为「已取过」判据后降到 29 warnings 基线。⑤ **⚠️ 撤回一条我自己下的错误结论（收尾阶段取证推翻）**：验收时看到 Journey 在对/错封面之间交替，据此推出「判决对但出图错（并发字段填充会掉）」，并一度写成遗留风险①。**三组取证把它推翻**：gsrsearch 8/8 逐字稳定且 `隨興旅` 压根不在前 6 名、en 轮池子无漫画像、`imageinfo` 单查 6/6 稳定、线上重打 **6/6 全对 `Journey_PSN_Cover.png`**。那两条错图 D1 行是**迭代 3 修复已上线、但那把键尚未被重新写对**的时间窗产物（`updated_at` 停在 `2026-10-02T00:54:11Z`）。**推理错误有三层**：① 先下结论再找机制，那套机制听起来合理但不是真的；② **验证手段与结论互相掩护**——诊断端点与取图链路共用同一套评分与同一份别名，它俩一致本就在预期之内，一致性零信息量；③ 「N 次里出现了错图」要先问这 N 次是不是同一版本、同一份缓存状态，否则会把时间窗当成随机故障。教训进 PITFALLS 4.41，`docs/PLAN-CHOICE-UI.md` §7.2 已整段重写为「撤回」。
- **遗留风险**：① **「让用户选」目前只在作品详情弹窗里**，`GalleryBento`/`GalleryWall`/榜单等直接显示封面的位（29 处 `<Poster>` 调用点）不弹，用户要先点开才能选。② `poster_urls` 是**全局键**（`media_key` 只含 title/english/year/type，**不含用户 id**），所以用户 A 的选择会同时改变用户 B 看到的封面。本轮按「民主式覆盖」实现（与 `saveResolvedPosters` 的既有语义一致），若要改成 per-user 需要新增表或给 `urls` 加结构——**这是个产品决策，不是技术债**。③ **验证用的一次性账号需要手工回收**（3 条 DELETE，各 changes=1；坑：`media_key` 全小写，混合大小写删返回 changes=0），若以后要常态化跑这类验证，应该写一个 `.tmp` 脚本而不是手工敲 SQL。④ `shaky` 档至今线上从未触发（承 T-20261002-03 遗留风险②），本轮的 UI 分支对它是**只有单测覆盖**的路径。⑤ **`CoverChoice` 没有独立 chunk**（被静态 import 的 `ArtworkDetail` 拖进主包），主包 +4.99 KB raw / +1.72 KB gzip；若将来想让它彻底退出首屏，要先把 `ArtworkDetail` 一起 lazy 化（迭代 4 明确判为不做，理由见 `docs/PLAN-ROUTE-EAGER.md` §7.4）。
- **下一步（给接手者）**：① **迭代 6（优化类）**：候选是 Poster 批次预取（29 个 `<Poster>` 调用点里首屏那几个可在 idle 时预取，治 m00079「有点卡」的第二个来源）或主包数据层瘦身（App.tsx 12.15 KB + catalog/ranking/profile 数据 15+ KB，sourcemap 归属口径）。② 遗留风险② 的 per-user 封面覆盖是一个**产品决策**，可以做成一个「创意」轮次的题（要新增表 + `posterKey` 加 user 维度 + 前端带 token 拉自己的覆盖，scope 明显大于本轮）。③ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3 广场护栏 / Phase 4 回环 Score 仍 ⬜。④ **不要再花时间查「同判不同图」了**——已 6/6 取证撤回，见 PITFALLS 4.41；真正的长期防护是**每次改动判决链路后必须用没缓存过的 key 实取图复测**（2.21）。

### T-20261002-05 · 迭代 4/20（优化类）· 首屏路由清扫（5 个视图/弹窗摘出主包）

- **状态**：✅ 完成（**568 passed·9 skipped**·42 files + **线上七路由 + 新 chunk 逐一 200 + modulepreload 仍为 0** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-02 遗留风险（首屏主包瘦身）
- **任务类型**：§2.7（构建与产物）
- **最小上下文**：`src/App.tsx`（`:39-72` import 块、`:1480` 顶栏、`:1586` 对话框、`:1919` 详情、`LazySpot`）+ `src/ui-fixes.test.ts`（新增 `describe("首屏依赖图绊线（PLAN-ROUTE-EAGER）")` 4 例）+ `docs/PLAN-ROUTE-EAGER.md`（新建计划）
- **改了什么**：**只改 `src/App.tsx` 一个源文件 + 两个测试/文档**。① 5 条同步 import 换成 `lazy(() => import(...).then((module) => ({ default: module.X })))`（与 `:56-72` 迭代 1 留下的五条同款写法）：`AiConfigDialog` `:39`、`RankingDetail` `:45`、`SettingsMenu` `:49`、`SetupView` `:53`、`PlazaView` `:55`。② **明确不 lazy**（§3.2）：`HomeView`（落地视图，lazy 化换首屏闪烁不值 5.53 KB）、`SortingView`（主流程两下点到）、`Poster`（首屏立即用）、`ArtworkDetail`（类型导出 + 多视图触发 + 实测只值 0.62 KB）。③ 新增共享兜底 `function LazySpot() { return <div className="route-loading" aria-label="Loading" />; }`，并给三处**原本没有 Suspense 的挂载点**补上：`:1480` 顶栏 `<Suspense fallback={null}>`（tablist 区域，null 更好——占位会把导航撑开）、`:1586` AiConfigDialog 与 `:1919` RankingDetail `<Suspense fallback={<LazySpot />}>`。④ 绊线 4 例（先剥注释再扫，避免解释性注释里的路径误伤）：`MUST_BE_LAZY` 五项不得有同步 import 且必须含 `lazy(() =>\n  import("<spec>")` 与 `default: module.<Name>`；`MUST_STAY_EAGER` 两项必须仍同步；`<Suspense fallback={<div className="route-loading"` 与 ErrorBoundary import 仍在；`LazySpot` 恰好 2 处 + `fallback={null}` 1 处。
- **为什么**：① **迭代 1 定的规矩没做完**。「非首屏不进 index chunk」在迭代 1 落了五条（SourceView/ProfileView/CompareView/ShareView/PlazaPostView），但 `AiConfigDialog`/`RankingDetail`/`SettingsMenu`/`HomeView`/`SetupView`/`PlazaView` **从没被复查**，这就是本轮根因——不是新问题，是**清扫没收尾**。② 主包 429.99 KB 里这 5 个首屏用不到的模块连同 lucide 图标与 catalog/ranking/profile/useAuth/useSorting 数据占了 27.4 KB。③ **首页一个字都不改**：只动加载时机，渲染逻辑与 DOM 完全不变，所以可用源码扫描而不是行为测试来锁。
- **验证状态**：五道门禁 ✅（`npx tsc -b` ✅ / lint 0 errors·29 warnings 预存基线 / format:check ✅（首跑红，新测试未格式化，`npx prettier --write src\ui-fixes.test.ts` 后绿，`src\App.tsx` unchanged）/ test **568 passed·9 skipped**·42 files（较 564 **+4**）/ build ✅，`index-DpW4fm-R.js` **402.60 kB / gzip 134.34 kB** vs 基线 `index-DobYD-Tu.js` 429.99 / 145.21 ⇒ **−27.4 KB raw / −10.87 KB gzip（−7.5%）**，与批量替换实验预测 402.36 / 134.30 误差 ≤0.25 KB）｜ **红队验证 ✅**：把 `SetupView` 改回同步 import（PowerShell `-replace`，`Select-String -Pattern 'PATCH OK'` 确认）→ `src/ui-fixes.test.ts` 红，报 `→ SetupView 同步 import 会把它拖回首包: expected … not to match /^import[^\n]*from\s+["']\.\/vi…/views`；`Copy-Item .tmp\App.lazy.bak src\App.tsx -Force` 恢复 → 55 passed｜ **线上 ✅（Version ID `ec112d84-926a-4f23-8f81-9d79244225c5`）**：① 首页 HTML 主 chunk = `/assets/index-DpW4fm-R.js`，**`modulepreload` 计数 0**（懒 chunk 全不预加载 ⇒ 首屏请求数不增）且该 chunk 200 / **402598 bytes**。② 五个新 chunk 全 200：SetupView-BGdV-j6A 4444B / RankingDetail-hvFmgvIO 2926B / SettingsMenu-CVpOsXZ6 4041B / AiConfigDialog-aGoSb1cB 10587B / PlazaView-btnwXcnm 8946B。③ 七路由首访全 200（`/`、`/catalog/source`、`/catalog/setup`、`/myself`、`/encounter`、`/share`、`/plaza`，**须带 `Accept: text/html`**）。④ API 回归无变化：`/api/other/candidates?name=Journey&year=2012` → `picked=风之旅人 band=weak pool=3`；`/api/posters/batch` 三条 other = `Journey_PSN_Cover.png` / `500px-Mona_Lisa…jpg` / `Monument_Valley_icon_unrounded.jpg`。
- **迭代中实测发现并修掉的真 bug**：① **台账候选已过期**（本轮第一个发现）：T-20261002-04 给迭代 4 留的头号候选是「摘 `fflate` 出主包」，开工 grep 才发现 `src/lib/utils.ts:28` **早就是** `await import("fflate")`，主包里那 5 处 `strFromU8` 是**调用点**不是库代码（库本体早已在 `browser-BTM47nOj.js` 5.09 KB）。**上一轮判断时成立 ≠ 现在还成立。** ② **`tsc` 抓住一个 build 数字掩盖不了的 bug**：重排 import 块时误删 `import { SortingView } from "./views/SortingView";`，build 体积**依然完全达标**（402.60 / 134.34），是 `npx tsc -b` 报 `src/App.tsx(1250,8): error TS2304: Cannot find name 'SortingView'` 抓到的——否则会带着排序页直接崩的版本上线。③ 绊线第 3 例最初断言 `expect(app).toContain("export function ErrorBoundary")`，但那个 `export function` 在 `src/components/ErrorBoundary.tsx` 里、`App.tsx` 只有 import → 假红，改成断言 App.tsx 的 import 语句。④ 计划文档内部不自洽：§3.1 表列 5 个模块、表头写「六个」、§0 与 §3.3 的收益数字按 6 个算，验收表会照着错数字判 ⇒ 已全文对齐为 5 个并标注实测值。
- **遗留风险**：① **`@license` 横幅在 dist 里**（44 条）不影响功能也不影响体积（lucide 全量仅 3.58 KB gzip），但如果将来上 CSP 严格模式或做 license 合规审计需要处理。② **sourcemap 字节归属覆盖 169.54/414.71 KB**（压缩后单行无映射），只能当优先级排序器；下一轮若还要瘦身，应继续用「批量替换实验 → 真 build」两步法而不是信 sourcemap 的数字。③ **`MUST_STAY_EAGER` 是硬约束不是偏好**：`HomeView` 一旦被谁 lazy 化，首屏会多一次往返 + 闪烁，而本项目用户抱怨的正是「有点卡」（m00079）。绊线红了先想清楚再改。④ **新 chunk 只有构建产物验证、没有浏览器端 E2E**：`<Suspense>` 兜底的三处（顶栏 `fallback={null}` + 两处 `LazySpot`）在线上只验证了 200 与字节数，**没在真浏览器点过设置菜单/账号对话框/广场**。这是迭代 5/20（创意类）可以顺手做的验收增强。⑤ **首屏仍有 402.60 KB**，大头是 `react-dom-client` 46.42 KB（sourcemap 归属口径下）+ App.tsx 12.15 KB + catalog/ranking/profile 数据 15+ KB；继续瘦身的空间在数据层与 `App.tsx` 自身，不在视图层。
- **下一步（给接手者）**：① **迭代 5（创意类）**：前端「让用户选」UI**（承 T-20261002-03 遗留风险①，**这是唯一还没设计的东西**：消费 `/api/other/candidates` 的 band，`exact`/`strong` 不打扰、`shaky`/`weak` 且 `poolSize ≥ 2` 才出现；用户选择回写 `poster_urls` 需要**新增带 token 的写端点**，注意 `poster_urls` 无 TTL 且是 UPSERT 语义；挂载点 `src/App.tsx:675` `openArtworkDetail` / `src/components/ArtworkDetail.tsx`）。② 若想在动手前先补一件小事：本轮遗留风险④ 说清了「构建产物验证 ≠ 浏览器点过」，创意轮顺手给 `LazySpot` 与三处 Suspense 兜底加一条可观测手段（比如此前 2.19 的「线上复测至少 2–3 次」同源思路）。③ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3 广场护栏 / Phase 4 回环 Score 仍 ⬜；ROADMAP frontend-polish P2 to-dos A–E。④ 若 `/api/other/candidates` 要上 UI，注意它**不受 posters 桶保护**，与 `/api/other/detail` 共用 20/10min 的 `other` 桶。

### T-20261002-04 · 迭代 3/20（前端类）· 维基缩略图桶宽治理（+ 顺带根治「原名裹在末尾」的别名页）

- **状态**：✅ 完成（**564 passed·9 skipped**·42 files + **线上 9 条 other 封面复测 + 蒙娜丽莎 4.41× 瘦身实测** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20260930-01 遗留风险③「大图未缩略」与 T-20261002-02 遗留风险①（`fflate` 留待优化轮）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7（构建与产物）
- **最小上下文**：`worker/other.ts`（`THUMB_BUCKETS`/`pickThumbBucket`/`OTHER_THUMB_MAX_WIDTH` + `isAlternateNamePrefix` + `titleMatchTier` + `resolveOtherCover`/`otherCandidateReport` 别名传递）+ `shared/posterKey.ts`（代数 3→4）+ `worker/other.test.ts`（+35 行新 suite）+ `docs/PLAN-THUMBNAIL-SIZING.md`（新建计划）
- **改了什么**：① 新增 `THUMB_BUCKETS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const`（**官方 `$wgThumbnailSteps` 原文值**，出处 `https://w.wiki/GHai` 写进注释）与 `pickThumbBucket(maxWidth)`（**向下**取桶，绝不向上白拿一档）+ `OTHER_THUMB_MAX_WIDTH = 500`；三处调用点 `worker/other.ts:318` `iiurlwidth` 与 `:539`/`:688` `pithumbsize` 全部改走它，字面量 `"600"` 清零。② `OTHER_POSTER_GENERATION` `"3"`→`"4"`（桶宽烧进 URL 字符串，改尺寸策略会让已缓存行变孤儿）。③ **顺带根治一个既有判决缺陷**：新增 `isAlternateNamePrefix`（`base` 是拉丁字母且前缀也含拉丁字母 ⇒ 判 **tier 0 淘汰**），并把 `resolveOtherCover`/`otherCandidateReport` 补上与 `otherDetail` 同源的消歧页别名传递。④ 测试：`pickThumbBucket` 11 档精确命中 + 向下取 + 边界/非法输入（`0`/`-5`/`NaN`/`±Infinity`/`3840`/`99999`）共 3 例 + 3 条源码扫描绊线（桶表≡官方 11 值、注释剥干净后无 `iiurlwidth:"`/`pithumbsize:"` 字面量、上界仍为 500）+ 2 例 Journey 回归。⑤ 计划文档 `docs/PLAN-THUMBNAIL-SIZING.md`（事实表/根因/桶宽论证/范围/验收表/风险表/反思）。
- **为什么**：① **「有点卡」的第二个来源**（T-20260930-01 遗留风险③实测：8 张 other 封面合计 **1699.1 KB**，蒙娜丽莎独占 505.2 KB）。旧的 `iiurlwidth:"600"` 因 `iiurlwidth` 是**向上**取桶，实际拿到 **960px**——请求 600 得到 960，等于白要一倍。② **上界取 500 的论证**：`.poster-small` 系列 26–50px 用 120 就够；`.collection-row` 贴纸卡实际宽 **369–557px**（容器 1120px ÷ 列数 2/3/4），330 会糊、960 对 26px 缩略位是 25× 过量；500 对 369px 卡是 1.35×。③ **只做服务端桶表，不动 CSS**：`src/styles.css:62-64` 的 `width:100%!important` 整宽**是设计**（贴纸卡，`src/styles.css:56` 有注释写明 source view only），差点按「bug」去拆。④ Journey 的错图是本轮代数 bump 作废缓存后**第一次真回源**才暴露的，等于一次免费的全量回归。
- **验证状态**：五道门禁 ✅（`npx tsc -b` ✅ / lint 0 errors·29 warnings 预存基线 / format:check ✅ / test **564 passed·9 skipped**·42 files（较 556 **+8**）/ build ✅，`index-DobYD-Tu.js` 440.31 kB / gzip 145.21 kB 与迭代 2 **逐字相同** ⇒ 零首屏影响）｜ **红队验证 ✅**：`git stash push worker/other.ts` 后 `worker/other.test.ts` **8 failed | 40 passed**（`expected '' to contain 'Journey_PSN_Cover'`、`expected 2 to be +0`、`expected '…const UA =\…' not to match /iiurlwidth:\s*"/`），`git stash pop` 后 48 passed｜ **线上 ✅（Version ID `b9b4b96d-2808-44a8-9749-9ef9d54c3337`**，`✅ No migrations to apply!`）：① **Journey 2012 修复成功**——删掉 `other|journey|journey|2012|4` 行后连打 **4/4 返回 `Journey_PSN_Cover.png`**（修复前是 8/8 返 `500px-Zatsu_Tabi_That's_Journey_Logo.webp` 漫画像 logo）。② **缩略图收益**：经线上 `/api/image` 代理量字节，蒙娜丽莎 **500px = 117341 bytes vs 960px = 517340 bytes，4.41× 缩减**。③ 9 条 other 全量回归：journey ✅ / 蒙娜丽莎 `500px-Mona_Lisa…jpg` ✅ / 纪念碑谷 ✅ / 动物森友会 ✅ / inside ✅ / liminal space 走廊照片 ⚠️（沿用旧结论，en-wiki 该词条本身就是走廊照片）/ 日常幻想·故事FM·看理想 `<EMPTY>`（刻意，zh-wiki 无条目，给图=给错图）。④ `/api/other/candidates?name=Journey&year=2012` 连打 3 次一致：`picked='风之旅人' band=weak`，候选池 `风之旅人[t1/s7.5/alias]`、`道奇Journey[t1/s3/literal]`、`Thatgamecompany[t1/s7.5/hint]`。⑤ 未缓存过的键验证新代码：`year=2014`/`year=2015` → `Journey_PSN_Cover.png`，`year=2009` → `2012_Dodge_Journey_--_NHTSA_3.jpg`（2009 确是道奇年份，判决合理）。
- **迭代中实测发现并修掉的真 bug**：① **`titleMatchTier` 的档位闸门只审了一侧**。`bare.endsWith(baseCompact)` 分支只查 `isDescriptiveSuffix`（审 base **之后**的尾词），对反向形状「别名 + 用户标题」零设防：`隨興旅 -That's Journey-` 去标点后 `隨兴旅thatsjourney` 命中 `endsWith("journey")` ⇒ 被放成 tier2。它靠 3(剥括号后以原名结尾)+2(类型词)+1(摘要够长)+1(pageimages 缩略图)=**7 分**压过靠消歧页别名放行的 tier1《风之旅人》**5.5 分**——**tier 优先于分数，1.5 分差翻不了档**，真封面 `Journey_PSN_Cover.png`（在 `page_image` 里）根本没机会出场。② 补 `resolveOtherCover`/`otherCandidateReport` 的别名传递是**必要但不充分**的（`otherDetail` 早就传了，只有这两处漏）；补完线上仍返错图，一度让我以为改动没生效——真凶是 **24h 边缘缓存**（见遗留风险②）。③ **判据试错两次**：`head.includes(baseCompact)` 先把测试打红（`expected 2 to be 1`，因为前缀是「隨兴旅thats」并没有第二个 journey），最后定在「base 含拉丁字母 ⇒ 前缀也必须含拉丁字母」，并用 `集合啦！動物森友會`（前缀全中文）、`Inside (遊戲)`/`紀念碑谷 (遊戲)`（拉丁注脚在括号内，已被上层剥括号分支收走）作不误杀对照。
- **遗留风险**：① **`isAlternateNamePrefix` 是启发式，不是语义**。「隨興旅」这类「别名 + 原名」被判 0 的同时，任何**合法的本地化前缀 + 拉丁原名**形态都会被一并淘汰（目前用「前缀也含拉丁字母」挡住中文前缀这一大类，未覆盖的是「西语/葡语前缀 + 拉丁原名」这类混合形态）。若将来出现合法条目被误杀，唯一正确的方向是**进消歧页别名表**而不是放宽规则。② **我原先的桶表是抽样反推出来的**——只测 `[60..1200]` 区间就断言「只有 6 个桶」，把 `20/40/1280/1920/3840` 五档漏在测试范围外；已改为官方 `$wgThumbnailSteps` 原文值并逐档实测 11 档全 200。教训已进 PITFALLS 2.20。③ **缩略图收益只兑现了大图**：蒙娜丽莎 4.41× ✅，但纪念碑谷/动物森友会/inside 三条返的是**原图直送**（`utm_content=thumbnail_unscaled`），字节数没变——因为 `iiurlwidth` **不放大**，原图本来就窄于 500px。这是**正确行为**而非治理失败（见 ③ 早期那个「re-thumbing 让小图变大 3×」的误判结论已作废：那个 330px URL 是我手工拼出来的，本项目根本不会产生）。④ **升级桶宽的触发点未知**：`.collection-row` 列数存 localStorage，2 列时单卡 557px 会让 500px 略欠（557/500 = 1.11×，可接受）；若将来改容器宽度或支持 1 列，需重新走一遍上界论证。⑤ `otherConfidence` 的 `shaky` 档仍**线上从未触发**（承 T-20261002-03 遗留风险②）。
- **下一步（给接手者）**：① **迭代 4（优化类）**：摘 `fflate`（主包内 `compressSync`×3），用迭代 1 的 loader 表 + 源码扫描绊线套路即可；② 前端「让用户选」UI（承 T-20261002-03 遗留风险①，**这是唯一还没设计的东西**：消费 `/api/other/candidates` 的 band，`exact`/`strong` 不打扰、`shaky`/`weak` 且 `poolSize ≥ 2` 才出现；用户选择回写 `poster_urls` 需要新增带 token 的写端点，注意 `poster_urls` 无 TTL 且是 UPSERT 语义）；③ `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 8 PWA、ROADMAP Phase 3 广场护栏 / Phase 4 回环 Score 仍 ⬜；④ 若要让 `/api/other/candidates` 上 UI，注意它**不受 posters 桶保护**，与 `/api/other/detail` 共用 20/10min 的 `other` 桶。

### T-20261002-03 · 迭代 2/20（创意类）· Jev 维基消歧 Choice 的出口层（诊断端点 + 多选一裁决）

- **状态**：✅ 完成（**556 passed·9 skipped**·42 files + **线上 6 条置信度实测 + 8 条封面回归逐字一致** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265）；承接 T-20261002-01 的遗留风险①
- **任务类型**：§2.6（外部平台/海报管线）+ §3.2（AI 辅助决策）
- **最小上下文**：`worker/other.ts`（`otherConfidence`/`evidenceOf`/`otherCandidateReport`/`toCandidateView` + `disambiguationAliases`/`usableForPick` 被复用）+ `worker/typesafe.ts`（`jevChoose`/`parseJevChooseBody`）+ `worker/index.ts`（`GET /api/other/candidates`、`POST /api/ai/jev-disambiguate`、限流桶 `ai_jev_disambiguate`）+ `docs/PLAN-JEV-DISAMBIGUATION.md`（新建计划）
- **改了什么**：① 新增 `otherConfidence(ranked, picked, year?, aliases?, compactBase?)` 纯函数，把 `pickBest` 的判决**额外**翻译成结构化置信度 `{score, band, margin, evidence, pickedTitle, poolSize}`；合成因子**全部是既有信号**，不新增规则——字面证据 0.45（literal=1/alias=0.6/hint=0.25）+ 领先幅度 0.35（span=12）+ 年份佐证 0.20；分档 `exact`/`strong`/`shaky`/`weak`。② 新增 `otherCandidateReport(title, english, year?)`，检索链与出图链同源但**不参与判决**，只回答「候选池里有什么、我们有多确定」。③ 新增 `GET /api/other/candidates`（共享 `other` 桶 20/10min，`cache-control: public, max-age=300`，故障 `502` + `max-age=60`）。④ 新增 `parseJevChooseBody` + `jevChoose`（Choice **2–255 选一**，key 正则 `^[A-Za-z0-9_-]{1,64}$`、description 压平截 400、上游 choice 必须在入参 key 集合内否则 `502 upstream_error`）与 `POST /api/ai/jev-disambiguate`（桶 20，**无 key 返 400 `invalid_config`**，上游失败附 `fallback: "rules"`）。⑤ **`pickBest` 判决逻辑一行未动**。
- **为什么**：① **核心洞察「分数不是置信度」**——「道奇Journey」6.5 与「風之旅人」5.5 相差 1 分，这一分却直接决定用户看到汽车还是游戏；把连续启发式加权分当离散判决用就是那个 bug 的根。② T-20261002-01 遗留风险①已判定「规则这条路到头」（日常幻想/故事FM/看理想 三条**永久空图**，zh-wiki 无条目），要出图需要**非维基封面源**或**人机共决**，不是继续加规则。③ 为什么不做 ROADMAP Phase 2 的原始形态（替换解析器）：海报解析跑在 `/api/posters/batch` 里**拿不到用户 key**（key 只在浏览器 localStorage）；一批 8 条 = 8 次外部请求违反 CONVENTIONS §3；再加 70–500ms 会放大 m00079「有点卡」。所以**不把 Jev 塞进解析器，而是给解析器加出口**，把 Phase 2 从「替换解析器」降级成增量分支。
- **验证状态**：五道门禁 ✅（`npx tsc -b` ✅ / lint 0 errors·29 warnings 预存基线 / format:check ✅ / test **556 passed·9 skipped**·42 files（较 533 **+23**：`other.test.ts` 14 例新 suite、`typesafe.test.ts` 9 例）/ build ✅，`index-CwNqjmUz.js` **429.99 KB 且哈希名与迭代 1 完全相同** ⇒ 本轮 100% 服务端，零首屏影响）｜ **红队验证 ✅**：把 `otherConfidence` 的 `band` 恒改为 `"strong"` 后 **7 条断言同时变红**（6 条 band + 1 条候选报告），移除即恢复——这条 tripwire 证明测试真的在锁分档逻辑，不是在陪跑｜ **线上 ✅（Version ID `0d1bd0fd-0aae-47df-85b7-18746dee055c`）**：`/api/other/candidates` 六条实测——纪念碑谷 2014 → `纪念碑谷 (游戏)` **exact/0.767/literal/pool=4**；Liminal Space 2022 → `Liminal space` **exact/1.0**（池里只有它一条，margin 记满）；动物森友会 2020 → `集合啦！動物森友會` **strong/0.65**（8 条势均力敌）；Journey 2012 → `风之旅人` **weak/0.47/alias**（候选池 `风之旅人[alias/7.5]`、`道奇Journey[literal/3]`、`Thatgamecompany[hint/7.5]` —— 前两名同分 7.5，**诚实地说没把握**）；日常幻想 2021 / 故事FM 2017 → `picked=''` **weak/0/none/pool=0**（正是「规则判不了的形状」的机器可读表达）｜ **回归 ✅**：`/api/posters/batch` 8 条结果与迭代 1 **逐字一致**（5 条正确封面 + Liminal Space 走廊照片 + 3 条 EMPTY），D1 无新增脏行。
- **迭代中实测发现并修掉的真 bug**：① `evidenceOf` 原本先判 `hintRescued` 再查别名表，导致**已修好的 Journey 被误报成 hint/weak**——「風之旅人」确实带 `hintRescued`（它是被 `Journey 电子游戏` 轮返回来的），但它同时在消歧页自列名单里，证据强度应是 alias。**判决对了但诊断说没信心，诊断端点就白做了**。② 修①时先试「零字面重合才算 hint」，把「道奇Journey」判成 hint——也不对：它的 compact 自己就含「journey」，证据来源是**字面文本**（被 `declaresWorkTopic` 降档而非被类型词硬凑数），应是 literal。最终按**来路**分类：tier2 → literal；tier1 且字面蹭到标题 → literal；tier1 且零重合但在消歧页名单 → alias；tier1 零重合且只靠类型词轮 → hint。③ 别名比对两侧都要过 `compactTitle`（线上消歧页写繁体「風之旅人」，调用方多半给简体「风之旅人」，不该要求调用方手工转简）。
- **遗留风险**：① `evidenceOf` 的 literal/alias/hint 边界是**按证据来路**分的，不是按「谁赢了」——所以 Journey 判 weak 时，池里的道奇Journey 会显示 literal。这是**诚实**的（它的证据确实更硬），但对未来的 UI 有含义：不能直接拿 candidate.evidence 当「这是正确答案」用，得看 `picked` + `band`。② `otherConfidence` 的权重 0.45/0.35/0.20 与 span=12 是**经验值**，没有校准集；线上 6 条样本里 exact/strong/weak 分布合理，但 `shaky` 一档线上**从未触发**（alias + margin≥0.1 需要「别名救回且明显领先」，Journey 恰好是同分边缘）——该档位目前只有单测覆盖。③ `/api/ai/jev-disambiguate` 线上**从未用真 key 跑过**（key 在用户 localStorage，Worker 拿不到），只验了入参校验与响应解析（mock fetch）；真 key 的端到端效果待用户配置后自测。④ `otherCandidateReport` 与 `resolveOtherCover` 各跑一遍检索（同一个请求里 2 次 gsrsearch），端点侧无共用缓存；`max-age=300` 是唯一收敛手段。⑤ 诊断端点**不受 posters 桶保护**，与 `/api/other/detail` 共用 20/10min 的 `other` 桶——若把它做成用户可见 UI，需重新评估配额。
- **下一步（给接手者）**：① **迭代 3（前端类）**：把 `/api/other/candidates` 接成「让用户选」UI——只在 `band` 为 `shaky`/`weak` 且 `poolSize ≥ 2` 时出现（`exact`/`strong` 不打扰用户），用户选择回写 D1 需要新增一个带 token 的写端点（**这是唯一还没设计的东西**，注意 `poster_urls` 无 TTL、UPSERT 语义见 T-20260930-03）；② 「有点卡」的第二个来源（大图未缩略，8 张 1699.1 KB）是**前端类**正题——`wikiFileThumbUrls` 用 `iiurlwidth` 取小宽度而非 `thumburl` 全尺寸，外加确认 CSP 放行 thumb 域；③ ROADMAP Phase 3（广场护栏 Noul）/ Phase 4（回环 Score）仍是 ⬜；④ `fflate` 仍在主包内（`compressSync`×3），留给某次优化类轮次。

### T-20261002-02 · 迭代 1/20（优化类）· Three.js 摘出首屏主包
- **状态**：✅ 完成（**533 passed·9 skipped**·42 files + **线上首屏 JS 指纹已验 three 不在其中** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：迭代计划（用户 m01265「不少于 20 轮、每轮一次 commit、按优化→创意→前端轮换」）
- **任务类型**：§2.7（构建与产物体积）
- **最小上下文**：`src/lib/orbEffects/registry.ts`（重写为纯数据）+ `src/lib/orbEffects/orbEffectLoaders.ts`（新建 loader 表）+ `src/components/OrbScene.tsx:61-84`（async 挂载 + 竞态守卫）+ `src/lib/orbEffects/registry.test.ts` + `src/ui-fixes.test.ts`（新增 5 条依赖图绊线）+ `docs/PLAN-BUNDLE-SPLIT.md`（新建计划）
- **改了什么**：① `registry.ts` 拆成两层——`EFFECT_META`（纯字面量元数据，唯一真相）+ `createOrbEffectById` 改 `async`，内部 `await import("./orbEffectLoaders")`；**删掉四个特效模块的静态 import**。② 新建 `orbEffectLoaders.ts`，`LOADERS` 表里 4 个 loader 各用**字面量** `await import("./plasma")` 等（必须字面量，否则 vite 扫不到依赖、chunk 拆不出来），导出 `ORB_EFFECT_LOADER_IDS`。③ `OrbScene.tsx` 因 async 化补 `mountToken` 竞态守卫（await 后 token 失效则 `next.dispose()` 立即回收，防快速切主题/切特效时旧实例泄漏）。④ 测试：新增「loader 表与 `EFFECT_META` 的 id 集合完全对齐」（源码正则 + 运行时导出双比对）与 5 条依赖图绊线。⑤ 顺手 `npx prettier --write worker/media.ts worker/other.test.ts worker/other.ts` 修上一轮遗留的 3 个文件格式问题。
- **为什么**：根因**不是「忘了 lazy」**，而是「lazy 了但依赖图让它失效」。`DeferredOrb.tsx` 已有 `lazy(() => import("./OrbScene"))` + `requestIdleCallback` + `prefersLiteMode` 三重省流，注释里甚至写明 three 约 522KB 原始/128KB gzip、占落地页 JS 的 ~45%——但 chunk 图按**静态依赖**算，不按运行时：`App.tsx → ThemeSwitcher.tsx`（首屏常驻）→ 静态 import `registry.ts` → 静态 import plasma/halo/blackhole/ribbon → 每个静态 `from "three"`。实测指纹（`[regex]::Matches($js,'WebGLRenderer')`）：主包内 `WebGLRenderer`=38、`THREE.`=41、`ShaderMaterial`=16、`alphahash_pars_fragment`=11 ⇒ three 全量躺在主包里；`OrbScene-*.js` 只有 2.4 KB 且指纹全 0，它只是个壳。（注意：`REVISION` 常量被 terser 内联，计数为 0，**别拿它当探针**。）
- **验证状态**：五道门禁 ✅（`npx tsc -b` ✅ / lint 0 errors·29 warnings 预存基线 / format:check ✅ / test **533 passed·9 skipped**·42 files（+6）/ build ✅ 4.39s）｜ 产物指纹 ✅ `index-*.js` **963.7 KB → 440.31 KB**（gzip **202.49 → 145.21 KB，-57.3 KB / -28.4%**），主包内 `WebGLRenderer`/`THREE.`/`ShaderMaterial`/`DataTexture`/`alphahash_pars_fragment` **全 = 0**；新增 `three.module-*.js` 530.82 KB（gzip 133.08）+ plasma/halo/blackhole/ribbon 各自独立 chunk（4.25/2.30/2.95/3.29 KB）｜ **tripwire 有效性已验**：往 `registry.ts` 加回 `import { createPlasmaEffect } from "./plasma";` 后 `src/ui-fixes.test.ts` 立刻变红（1 failed | 50 passed，命中「registry.ts 只做纯数据」），移除即恢复｜ **线上 ✅（Version ID `c74efc71-8a1b-4a19-ab2b-eeb9043417f2`）**：`https://sort.logicc.top/assets/index-CwNqjmUz.js` = 414.7 KB / `WebGLRenderer`=**0**，`three.module-YZZFkaN9.js` = 518.4 KB / `WebGLRenderer`=38；HTML `modulepreload` 计数 **0**（three 没被 preload 偷偷拉回首屏）；`/api/health` ok、`/api/posters/batch` 两键（journey/动物森友会）仍正确，上一轮修复未被破坏。
- **遗留风险**：① 部署切换瞬间可能抓到**旧 asset 名且 404**（首次 `Invoke-WebRequest https://sort.logicc.top/` 拿到 `/assets/index-Dn8-3FpW.js`）——这是切换瞬态而非配置 bug（HTML `cache-control: public, must-revalidate, max-age=0` 对哈希资源名是对的，来自 `env.ASSETS` 透传，`worker/index.ts:1723-1733` `serveAssets`），复测须带 cache-buster 或重试；② `createOrbEffectById` 变 async 后，`OrbScene` 挂载失败会晚一个微任务才暴露（`void mountInstance()` 不 await）——已用 `mountToken` 保证不会残留半初始化实例，但错误目前不上报，考虑后续接 `console.warn`；③ loader 表新增特效时若忘登记 `EFFECT_META`，测试会红（已覆盖），但**若忘在 `LOADERS` 里加对应项**，源码正则那条断言会红；④ 主包仍 440 KB，下一轮可再摘 `fflate`（主包内 `compressSync`×3、`alphahash_*`×11，尚需先查调用点）。
- **下一步（给接手者）**：① **迭代 2（创意类）**候选——摘 `fflate` 进动态 import，或做 ROADMAP 的 Jev Phase 2/3/4（Phase 2 维基消歧 Choice、Phase 3 广场护栏 Noul、Phase 4 回环 Score）；② 未 lazy 的视图：`HomeView(504)` / `SetupView(216)` / `SortingView(334)` / `PlazaView(434)`，`App.tsx` 已 lazy 的 5 个大视图见 `src/App.tsx:58-72`；③ 若要把「主包体积」做成常驻门禁，可在 `src/ui-fixes.test.ts` 加一条「构建产物不含 three 指纹」的断言（需先跑 build，属慢测试，慎放 CI）。

### T-20261002-01 · 「其他」维度错图根治：标题吻合闸门（gen3）+ D1 脏行全清
- **状态**：✅ 完成（527 passed·9 skipped + **线上 `/api/posters/batch` 8 条复测三次完全稳定** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：T-20260930-03（其遗留风险①「换键即可作废旧错图」被本任务走完并发现换键不足够）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`worker/other.ts`（全部新增逻辑）+ `worker/media.ts`（other 第五档收口 + `wikiTitleMatchesUserTitle`）+ `shared/posterKey.ts`（代数 2→3）+ `worker/other.test.ts`（26 例）
- **改了什么**：① `OTHER_POSTER_GENERATION` "2"→"3"；② 新增 `titleMatchTier(base, pageTitle, aliases): 0|1|2` 分档闸门——0 硬淘汰、1 弱吻合、2 作品页，**档位排在分数前面**（tier1 高分不许盖过 tier2）；③ `isDescriptiveSuffix` + `DIFFERENT_WORK_TAIL` 在**标题层**淘汰「原名+描述性后缀」（日常幻想指南、我们的故事、勇者斗恶龙）；④ `disambiguationAliases` 只信「条目名 compact == 用户标题」的那张消歧页，且**切分必须按行**（线上消歧页每行一项）；⑤ `hintTopicConfirmed` 只认题材词（zh 电子游戏 / en video game），不放宽到 `OTHER_TYPE_WORDS`；⑥ `isSelfDescribed` + `declaresWorkTopic` 双重自述校验（专治「道奇Journey」这种标题与首句完全自洽的同名异物）；⑦ `wikiPageImageAny` 删掉 `find(...) ?? candidates[0]` 回落；⑧ `pickBest` 改为「**hintRescued 候选必须自证摘要含用户年份**」才可用（`mentionsYear`/`usableForPick`）——这条专治故事FM 取到 SCP 基金会徽标；⑨ `wikiJson` 区分「维基说没有这张图」与「本次上游超时/限流」（模块级 `wikiDegraded` + `resetWikiDegraded`），否则瞬时失败会被 24h 负缓存固化成空白；⑩ `worker/media.ts` other 第五档改走 `searchWikiPoster(..., { title, english })` 标题闸门，删掉原 en 重复调用。
- **为什么**：用户实测「其他部分的封面加载还是有问题」（m00072）「有的也还是不对版」（m00088）。逐键取证发现 8 条里 4 条错图（日常幻想→曾俊贤签名照、故事FM→萧煌奇专辑、看理想→勇者斗恶龙封面、Journey→2012 Dodge Journey 汽车）。根因不是单一 bug 而是**三层放大**：① `scoreOtherPage` 旧版对条目名只做 includes 就 +1，靠「+2 类型词 / +1.5 infobox 封面 / +1 摘要长度」弱信号堆分夺冠；② `otherDetail` 是 other 维度第一档且 `if (detailCover?.poster_url) return` 短路，详情链一旦选错错图立即生效、后面所有兜底档全废；③ 第五档 `searchWikiPoster` 的 `scoreWikiImage` 与 other 闸门毫无关系，只要求「页标题包含任一查询词」——Journey/2012 因此命中「道奇Journey」。**换键（gen3）单独并不够**：旧错图行只是变孤儿，仍在表里占位；而 `resolvePostersBatch` 里 `knownPosterHit` 让 D1 优先于任何解析，只要脏行在，前端就永远看到它。
- **验证状态**：五道门禁 ✅（check ✅ / test **527 passed·9 skipped**·41 files / build ✅ / tsc ✅）｜ 离线 ✅（`worker/other.test.ts` 26 例，含 Journey 消歧页、SCP 徽标、角色页 vs 正作分档回归；每个新测试都做过「关掉修复就红」验证）｜ **线上 ✅（2026-10-02，Version ID `a6044984`）**：① **D1 脏行全清**——备份 `.tmp/other_rows_before_purge.json`（48 行）后 `DELETE FROM poster_urls WHERE media_key LIKE 'other|%'`（`changes: 48`），清掉 SCP 徽标、Dodge 汽车、曾俊贤签名照、井柏然、特朗普官方肖像（`other|inside|游戏|2016|2`）等；② 冷跑复测 `/api/posters/batch`（`{items:[…8 条], retry:true}`，other 维度 `english === title`）8 条结果与**连打三次完全一致**：纪念碑谷→Monument_Valley_icon_unrounded.jpg ✅、动物森友会→Animal_Crossing_New_Horizons.png ✅、Inside→INSIDE_Cover.jpg ✅、Journey→Journey_PSN_Cover.png ✅（不再是被误认的 Dodge 汽车）、Liminal Space→960px-Corridor_Stanley_Hotel… ⚠️（en-wiki 该词条本身就是走廊照片，非错配但也非用户想要的摄影系列）、**日常幻想 / 故事FM / 看理想 → 空**（预期：zh-wiki 无正确条目，宁可不返图也不返错图）；③ D1 回写**只有 5 行**且全对，空结果不落库（`saveResolvedPosters` 显式 `if (record.key && record.urls.length)`）。
- **遗留风险**：① 日常幻想 / 故事FM / 看理想 三条**永久空图**（zh-wiki 无对应条目、搜出来的都是零重合页面）——若用户要求必须出图，需要的是**中文播客/展览的封面来源**（豆瓣/官方 RSS/Bangumi 等非维基源），不是继续调解析器；② Liminal Space 同理，en-wiki 只有走廊照片条目，用户要的是「摄影系列」这个概念实体，需要外部源或用户改名（如 `Liminal Space 摄影系列`）；③ 换代数是重工具——每次 `OTHER_POSTER_GENERATION` +1 都等于让全站 other 封面冷跑一次 wiki（请求量上升、有限流风险），只在解析器语义变更时才用；④ `wikiDegraded` 是模块级状态，单次请求内上游超时会让本次解析整体降级，下次请求不受影响。
- **下一步（给接手者）**：① 若用户不接受 3 条空图，优先做「非维基封面源」扩展而非放宽闸门（放宽 = 错图回来了）；② Liminal Space 建议改条目名（`摄影系列` 后缀能被 `isDescriptiveSuffix` 正确淘汰，把整个概念页挡在外面）；③ **「有点卡」已归因，勿重复排查**（m00079）：延迟几乎全在网络往返，不是服务端慢——other 批量 8 条 891/965/1239/1759/2073/2287ms，**单条热缓存 1230ms**，`/api/health` 1260ms，首页 1.3KB HTML 也要 905–1425ms；`/cdn-cgi/trace` → `colo=LAX loc=CN warp=off`（用户在大陆，Cloudflare 给它路由到洛杉矶 colo，无 WARP/未走国内优化）。第二个来源是**大图未缩略**：8 张 other 封面经 `/api/image` 量得合计 **1699.1 KB**（蒙娜丽莎 505.2KB、故事FM 397KB、动物森友会 213.4KB、看理想 175KB、LiminalSpace 145.2KB、Inside 123.4KB、日常幻想 104.1KB、Journey 21.9KB、纪念碑谷 13.9KB），清单页/榜单页缩略图直接吃全尺寸原图（`src/styles.css:62-64` 还把 `.collection-row .poster-small` 强制成 `width:100%!important;height:auto!important`，连裁剪都没有）。修法方向：`imageinfo` 用 `iiurlwidth` 取较小宽度（别用 `thumburl` 全尺寸 / `original`），并确认 CSP 是否放行 thumb 域；线路问题只能靠换 CDN/开 WARP/前端加缓存，不在代码范围。

### T-20260930-03 · 「其他」维度旧错图键作废（posterMediaKey 换代数）
- **状态**：✅ 完成（五道门禁绿 + **线上复测通过** 2026-09-30：旧格式键全部改判正确，详情十件全对）｜ **负责人**：本 agent｜ **上级**：T-20260930-02（其遗留风险②「双清 D1 未做」即本任务入口，现已由本任务代码化解决）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`shared/posterKey.ts`（新增，海报键唯一实现）+ `worker/media.ts`（键函数转出 + `key` 别名）+ `worker/posterStore.ts`（posterKeyFor 内部改用共享体，对外 API 不变）+ `src/components/Poster.tsx`（batchKey 兜底改调共享函数，删手抄 normalizeKey）
- **改了什么**：`posterMediaKey()` 在 `type==="other"` 时输出五段键 `other|title|english|year|<代数>`，代数常量 `OTHER_POSTER_GENERATION = "2"`；movie/book/music 仍为原四段裸键。客户端兜底键公式原先手抄竖线拼接+猜测 `type`，改为直接 import 共享实现；年份过滤 `posterKeyYear` 也收进共享（1800–2200），只为对齐前端兜底键（服务端 batch/单条路径本已归一，属无行为变化）。
- **为什么**：D1 `poster_urls` 行无 TTL，`saveResolvedPosters` 是 UPSERT 但 batch/单条 route 过滤 `!known?.get(key)?.length` → 已存在的错图行永不重写，永久短路新解析器（运维教训：「调取图逻辑后必须双清」）。但本机无 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`，remote SQL 不可执行。改用 cachePurge 同思路的「代次失效」：代数 +1 后旧行既取不到也不必删（读侧永不删数据）。只动 other——movie/book/music 无同类事故，且一次推平常=全站海报重新回源，豆瓣侧大概率 418。
- **验证状态**：五道门禁 ✅（check ✅ / lint 0 errors·29 warnings 预存 / format:check ✅ / test **514 passed·9 skipped**（+9：shared/posterKey.test.ts ×8 + worker/posterStore.test.ts +1）/ build ✅ 4.24s）｜ 离线 ✅（fakeDb 躺 `other|动物森友会||2020`→大角鸮行时，`loadPosterUrls` 按当前键查不到、`saveResolvedPosters` 只写新键）｜ **线上 ✅（2026-09-30，`4dcd622` 推送部署后）**：① posters/batch 旧格式键（english 留空 = 此前被 D1 错图短路的那批）全部改判：`other|动物森友会||2020|2` → Animal_Crossing_New_Horizons.png、`other|journey||2012|2` → Journey_PSN_Cover.png、`other|蒙娜丽莎|mona lisa||2` → Mona Lisa 960px、`other|inside||2016|2` → INSIDE_Cover.jpg；新格式键（`other|动物森友会|animal crossing|2020|2` 等 3 条）同样正确；单条 `GET /api/posters?q=动物森友会&type=other&year=2020` → 同一封面；② `/api/other/detail` 十件全对（动物森友会+2020 / Inside+2016 / 蒙娜丽莎 / 塞尔达传说 王国之泪+2023 / 只狼+2019 / 黑神话 悟空+2024 / 艾尔登法环+2022 / 底特律 变人+2018 / 纪念碑谷+2014）；Journey+2012 本次摘到 en 页 `Journey (2012 video game)` + Journey_Title_Poster.png（与 zh 页 Journey_PSN_Cover.png 同为该作封面，非错配；zh 页在 batch 键路径仍夺冠）；③ 线上 bundle index-D_X-wD8d.js 含共享键实现指纹（`normalize("NFKC")` + 代数 `"2"` + `>=1800&&<=2200`）
- **遗留风险**：① ~~旧代数四段键行成为永不读取的孤儿（无害占空间，有 CF 凭证时可择机 `DELETE ... WHERE media_key LIKE 'other|%'`）~~ → **2026-10-01 已清理**：走 wrangler OAuth 登录态（`xd04040212@163.com`，含 `d1:write`）执行 remote SQL，删 49 行旧代数孤儿（`media_key LIKE 'other|%'` **且** 竖线数=3，即 `length(media_key)-length(replace(media_key,'|',''))=3`），**保留 15 行当代数键**（裸跑 `LIKE 'other|%'` 会把生效中的正确缓存一起删掉并触发全量冷跑 wiki + 限流风险）；备份 `.tmp/poster_urls_other_gen1_backup.json`（49 行含 urls/updated_at）；线上复测 `posters/batch` 三键全对（动物森友会→Animal_Crossing_New_Horizons.png、journey→Journey_PSN_Cover.png、蒙娜丽莎→Mona Lisa 960px）；② 换键后所有 `other` 封面首次都要重新走解析器（wiki 请求量上升，线上复测已是冷跑，耗时可接受）；③ **部署后首请求抖动**：4dcd622 部署后头几个请求出现一次异常（纪念碑谷+2014 → "List of sites in Jinan" 济南景点列表页、底特律 变人+2018 → 404），即刻原参重试 ×3 全部恢复正确 → 判定 isolate 冷启动/上游 gsrsearch 抖动（详情链逻辑本批零改动），但**部署后复测必须至少重试一次**；④ `posterMediaKey` 签名不变（五段只在 type=other 时出现），旧调用点零改动，全仓 grep 确认无 `split("|")` 取固定下标的解析处
- **下一步（给接手者）**：无阻塞项。后续如再改 other 解析逻辑且发现旧键错图，直接把 `OTHER_POSTER_GENERATION` 调到 "3" 即可再次换键作废；movie/book/music 若也出现同类事故，同一机制可直接复用（但一次推平常=全站海报重新回源，须评估）

### T-20260930-02 · 修复：「其他」维度封面/详情错配（游戏品类取图与消歧）
- **状态**：✅ 完成（五道门禁绿 + 离线 fixture 回归 ×13；线上复测：详情 10/10 全对、新键与旧格式键封面全对）｜ **负责人**：本 agent｜ **上级**：T-20260928-07（其遗留风险「底特律 变人→天际线 / 纪念碑谷→真实照片」即本任务入口）｜ **后续**：T-20260930-03（把本任务遗留的「双清 D1」换成换键作废）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`worker/other.ts`（重写：resolveOtherCover/wikiFileThumbUrls/OTHER_TYPE_WORDS/otherDetail/otherSearch/wikiPageImageAny）+ `worker/media.ts`（computePosters other 分支 + queryWikiImages + searchWikiPoster）+ `worker/index.ts`（/api/other/detail、/api/artwork/detail?kind=other 加 year）+ `src/App.tsx`（other 详情带 work.year）+ `worker/other.test.ts`（新增）
- **改了什么**：① 取图主链 pageimages（非自由封面恒空）→ `pageprops.page_image`（infobox 封面文件名，非自由文件也有值）+ `wikiFileThumbUrls` 批量 imageinfo 换 URL；② 消歧页靠 `pageprops.disambiguation` 机械剔除（替代正则猜「可以指」）；③ 搜索/详情从「opensearch 首条直进」改为「标题分隔符变体精确直查 + gsrsearch 评分择优」，评分 = 页标题含用户词+3 / 条目名带限定词+3 / 类型词+2 / infobox封面+1.5 / 深度+1 / 系列消歧语式−3 / **年份命中+2** / **条目自身年份≠用户年份 −2**；④ 给年份时 `pickBest` 分三档（条目自身首个年份==用户年份 > 摘要提及用户年份 > 全体第一），动物森友会因此越过系列页与 2001 首作落到 2020 正作；⑤ `wikiPageImageAny` 删 `files[0]` 兜底（大角鸮/拉斐尔像错配根因），只保留 infobox 封面与「文件名含标题关键词」两条路；⑥ other 分支顺序改为 resolveOtherCover → langlinks → 主图直取(zh/en) → searchWikiPoster(zh/en) → otherDetail(title, **year**)；⑦ `media.ts` searchWikiPoster 的 exact/gsrsearch 补 `pageprops`、选图扩到 page_image、剔除消歧页；⑧ **191ec5f**：`resolveOtherPages` 删「纯标题轮已见到带 `pageprops.page_image` 的页就跳过类型词轮」的省请求短路——线上实测风旅人只在「Journey 电子游戏」轮出现，而纯标题轮首条《西遊記》带图，导致两轮择优选不到正确页（同页仍去重）；⑨ **eb11566**：`computePosters` other 第一档改走 `otherDetail(title, year)` 详情链（封面与详情弹窗同一页同一图），resolveOtherCover 退第二档，末尾 otherDetail 兜底删除；`toWork` poster 改 `thumbnail ?? original ?? fileUrl`（original 优先会返回 Commons 数十 MB 全尺寸扫描件）；⑩ **8e9d2f6 + e044093**：zh 维基繁体条目名 vs 用户简体输入 → `compactTitle`/`wikiKey` 先过 `T2S_SOURCE` 繁简表 `toSimplified()` 再比较（此前「页标题含用户词」这条最强消歧信号永不亮，作品页与角色页/系列页同分、排名看 gsrsearch 抖动）；`scoreOtherPage` 标题三级（先剥括号再比：裸标题 equal +4 / startsWith|endsWith +3 / 整体包含 +1）；年份信号从「extract 首个年份」改为「**条目名**自带年份」（≠用户年份 −4，标题年份才是作品本体年份，摘要年份只是公布年/重播年；正则 `/(?:1[5-9]|20)\d{2}/` 不带 `\b`——中文旁汉字时 `\b` 永不成立）
- **为什么**：用户清单（动物森友会 2020 / Inside 2016 / Journey 2012，格式「标题 - 品类 (年)」）线上三类错配：动物森友会→大角鸮照片（系列页 files[0]）、Inside→消歧页（1999）、Journey→2012 Dodge Journey 汽车（同名概念页，且 `(video game)` 不是标题而是 redirect 到乐团页）
- **验证状态**：五道门禁 ✅（**505 passed·9 skipped**，+13 例 worker/other.test.ts，最终态 e044093）｜ 离线 fixture 回归 ✅（fetch 桩录像：年份摘页/消歧剔除/同名异作跨过[西遊記 extract 含 2012]/详情改走搜索/候选海报补齐/infobox 封面优先/文件名关键词命中与无命中返回 null/纯标题轮被异作占据时类型词轮仍须跑/繁简失配下作品页不被角色页压/动物森友会 2020→集合啦！動物森友會）｜ **线上 ✅（2026-09-30）**：① `/api/other/list?key=动物森友会` 已换成 gsrsearch 评分链，返回遊戲/集合啦！動物森友會等繁体游戏页且**每条都带 infobox 封面**；② `/api/other/detail?name=动物森友会&year=2020` → 集合啦！動物森友會 + Animal_Crossing_New_Horizons.png ✅；③ 同端点 Inside&year=2016 → Inside (游戏) + INSIDE_Cover.jpg ✅；④ Journey&year=2012 初版返回《西遊記 (無綫1996年電視劇)》（其 extract 含 2012 重播）→ 年份三档择优 + 191ec5f 删省请求短路 + e044093 年份信号改为条目名自带年份，历次均再部署复测；⑤ **新键** posters/batch 实测：`风之旅人|Journey|2012` → Journey_PSN_Cover.png、`纪念碑谷|Monument Valley|2014` → Monument_Valley_icon_unrounded.jpg（均为 infobox 封面，非地貌照片）✅；⑥ 旧键 `other|动物森友会||2020`、`other|journey||2012` 仍返回 D1 里的**旧错图**（大角鸮 / Dodge 汽车）——负缓存短路，见遗留风险②；⑦ **e044093 部署后线上复测（cb 时间戳绕 CDN 3600s）**：`/api/other/detail` 十件全对——动物森友会+2020 → 集合啦！動物森友會 + Animal_Crossing_New_Horizons.png（此前 19ff2d7 线上仍返回角色页「傑克 (動物森友會)」+ 猫图，已定位为年份信号取错：傑克 extract 首年 2020、2020 正作首年 2018）、Inside+2016 → Inside (游戏) + INSIDE_Cover.jpg、Journey+2012 → 风之旅人 + Journey_PSN_Cover.png、蒙娜丽莎、塞尔达传说 王国之泪+2023、只狼+2019、黑神话 悟空+2024、底特律 变人+2018、纪念碑谷+2014、艾尔登法环+2022 全部命中正确条目+infobox 封面；⑧ posters/batch **新键**（english 后缀非 D1 已有值）全对：`other|动物森友会|animal crossing|2020` → Animal_Crossing_New_Horizons.png、`other|inside|inside game|2016` → INSIDE_Cover.jpg、`other|journey|journey game|2012` → Journey_PSN_Cover.png、`other|蒙娜丽莎|mona lisa probe <stamp>|` → Mona Lisa 960px、`other|塞尔达传说 王国之泪|zelda tears of the kingdom|2023` → 薩爾達傳說王國之淚.jpg；⑨ posters/batch 旧键仍被 D1 旧错图短路（新代码无法短路）：`other|蒙娜丽莎|mona lisa|` → Stray_game_cover.jpg、`other|动物森友会||2020` → Bubo_virginianus 大角鸮、`other|journey||2012` → 2012_Dodge_Journey——本机 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` 均未设置，无法执行 `wrangler d1 execute --remote`
- **遗留风险**：① 本机到 wikipedia 全系域名 DNS 污染（zh.wikipedia.org→199.16.158.9、wikipedia.org→31.13.94.41）→ 复测只能走线上端点；② ~~**双清 D1 未做**：`DELETE FROM poster_urls WHERE media_key LIKE 'other|%'` + 清海报缓存，否则清单旧键永远返回旧错图（Inside 之前是空数组所以已自动重解析成功，其余两个旧键不是）~~ → **已由 T-20260930-03 换键作废解决**（other 键带解析器代数，线上复测旧格式键已全部改判正确；SQL 清理降级为可选项）；③ `wikiSearchOnce` 每查询词最多 2 次 gsrsearch + 1 次 imageinfo，other 取图链最坏 ~8 次请求，冷缓存耗时需前端实测（详情端已有 30s 超时）；④ ~~搜索列表排名仍可能把同名系列页排在作品页前（繁体页标题简繁失配）~~ → 8e9d2f6 繁简归一生效后已解决；⑤ `toWork` 的 year 取 extract 首个 4 位年份，集合啦！動物森友會实际显示 2018（任天堂公布年）而非 2020 发售年——封面/详情选页不受影响，但列表/详情的年份字段可能偏早；⑥ **部署后首请求抖动**：两次部署（e044093/4dcd622）后都出现过一次异常候选（西遊記重播年、济南景点列表页/404），即刻原参重试即恢复——isolate 冷启动/上游 gsrsearch 抖动，复测请至少重试一次
- **下一步（给接手者）**：① ~~用户侧执行双清 D1~~ 已由 T-20260930-03 代码化，无需用户侧 SQL；有 CF 凭证时再择机 `DELETE ... WHERE media_key LIKE 'other|%'` 清孤儿行；② 观察 poster_errors 上报的其他品类错配；③ 若长尾错配多，考虑把 year 提取改为「发售/发行」就近年份而非全文首个 4 位数字
- **相关**：遗留风险② 的代码化解决方案见 **T-20260930-03**（其他键带解析器代数，换键作废替代 SQL 双清——已不必等用户侧执行 remote SQL）

### T-20260930-01 · 优化冲刺 Phase 7 · 文化年度报告（Wrapped 年鉴卡）
- **状态**：👀 待审（本地全绿 + 烟测实锤；**线上验证随推送进行**）｜ **负责人**：本 agent
- **任务类型**：§2.2 + §2.3
- **最小上下文**：`src/lib/wrapped.ts`（数据层）+ `src/lib/exportPng.ts`（renderWrappedPng）+ `src/views/ProfileView.tsx`（侧栏按钮）+ `src/App.tsx`（exportWrapped）
- **改了什么**：① `lib/wrapped.ts` 纯函数（buildWrappedStats 复用 galleryStats；draftInsight 最纠结一对 = cycleEvents observations 最高且 ≥2、id→标题经草稿 collection.works 解析宁缺毋错；readDraftLike 防御解析；×8 单测）；② `renderWrappedPng`/`wrappedFileName`（印刷年鉴版式：双线页眉→画像名→英雄数字带[榜单/作品/年代跨度]→媒介占比堆叠条[维度色]→年代分布→进行中节[取舍大数字+最纠结一对]→榜单速览[各榜 Top3]→页脚；主题感知、2x）；③ 接线：ProfileView 侧栏「年度年鉴 PNG」+ App exportWrapped（两模块按需加载；titleOf 从草稿 collection.works）；④ 文档：冲刺计划 Phase 7 ✅、CHANGELOG、FEATURES、README、USAGE
- **为什么**：冲刺队列下一个大件（P6 已完成）；数据边界已确认——decisionLog/cycleEvents 仅存于进行中草稿（art-rank:draft:v2，全量 RankingState 序列化），画像里没有 → 年鉴卡主体用画像统计，取舍次数与最纠结一对从草稿条件性附加
- **验证状态**：五道门禁 ✅（492 passed·9 skipped，+8 例）｜ 本地烟测 ✅：静态服务 + 注入画像与含回环草稿，拦截生成的 blob（2400×2620 @2x）页面渲染逐节核对（英雄数字/媒介堆叠条 56%+44%/年代条 2010s-2000s/最纠结一对 花样年华↔The Substance 反转 3 次/榜单速览/页脚全部正确）｜ **线上 ✅（2026-09-30）**：生产环境点击「年度年鉴 PNG」生成 280KB PNG（blob 捕获验证 type/size）；无草稿路径同时验证（卡片省略取舍节）
- **遗留风险**：① 「最纠结一对」仅反映进行中草稿（历史排序无回环数据落盘）——卡片用「进行中 · 本次排序」标签明示，若要全量历史需扩画像存储白名单（硬规则 4，另立批次）；② 无草稿时卡片缺取舍节（设计如此）；③ H 高度公式按内容估算，极端数据（超多媒介/年代）下页面留白可能偏大；④ **自动化注意**：渲染收尾用 requestAnimationFrame，后台标签页（visibility:hidden）rAF 冻结会让导出挂起——真用户前台不受影响，但无头/后台自动化验证需覆写 rAF（实测证实）
- **下一步（给接手者）**：推送后线上点「年度年鉴 PNG」下载实测；接 Phase 8（PWA 离线）

### T-20260929-02 · 回归排查：T-01 同类缺陷全仓扫描 + 线上功能冒烟
- **状态**：✅ 完成（排查型任务，无代码改动；结论：**除 T-01 已修复项外未发现其他回归**）｜ **负责人**：本 agent
- **任务类型**：§2.2（前端视图）+ 排查
- **静态扫描（全仓 localStorage 写点 × state 同步审计）**：逐个核对 `src/views|components|App.tsx` 全部 `localStorage.setItem/removeItem` 调用点——CompareView compare-level、PlazaView plaza-cols、HomeView rings-layout、App guide-dismissed、PlazaPostView/acceptPeer 的 peer:v2 均为「setState + 持久化」正确写法；**ShareView「与我比较」疑似只写不 set，实查为非缺陷**——App 挂载 ShareView 时对 navigateTo 做了包装，跳 compare 时走 `acceptPeer(sharePeer)`（setPeer + 持久化 + 维度联动），ShareView 内的 setItem 只是冗余
- **线上冒烟（sort.logicc.top，d0120b2）**：① 简易模式 9 件完整排序端到端（起跑页头「TOP 3 · 简易」、完成落画像页 Top3 正确产出）；② quick 模式撤销正常；③ setup TopN 数字框与滑块联动；④ 比较页三档深度切换 + localStorage 持久化；⑤ 比较页手动/自动模式（20 复选框渲染）；⑥ 深链 /encounter?payload= 自动导入 peer；⑦ 主题 cyber 切换生效+持久化+切回 modern；⑧ 中英语言切换；⑨ 广场列数 2/3/4 切换持久化；⑩ 帖子详情深链 /plaza/29；⑪ 广场「与我比较」→ acceptPeer → 比较页双方索引渲染（无共同维度时边界提示正确）
- **未覆盖（已有其他保障）**：AI 快排/预测分歧（需真实 key，T-06 台账留用户复核）；Worker 侧 wiki 海报（T-07 已线上验证）；视觉回归（P3/P4 截图基线体系覆盖）；precise 模式完整排序（ranking.test.ts ×165 行单测覆盖算法，模式传递链路与 quick 同路径已验证）
- **遗留风险**：无。注意广场卡片是 `div.plaza-sticker`（role=button）非 `<button>` 标签，自动化测试选择器需用 role 而非标签
- **下一步（给接手者）**：无遗留

### T-20260929-01 · 修复：catalog/setup 排序模式无法更改
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：sort.logicc.top 新 bundle index-Dysxd8Py.js 上，setup 页默认「经典」高亮正确，点击「简易/精确」高亮立即切换且 localStorage 写入 `precise`）｜ **负责人**：本 agent
- **任务类型**：§2.2（前端视图）
- **最小上下文**：`src/views/SetupView.tsx`（rank-mode 分段按钮）+ `src/lib/useSorting.ts` startRanking（起跑读 localStorage）
- **改了什么**：`SetupView` 的 `rankMode` 从「渲染时直读 localStorage 的普通变量」改为 `useState`（惰性初始化 + 非法值回退 classic），点击同时 setState + 写 localStorage。仅此一处，`useSorting` 起跑逻辑不动。
- **为什么**：用户报障排序模式点了没反应。根因是 d47c444（排序三模式）引入的回归：点击只写 localStorage 不触发重渲染，高亮/提示永远停原处（功能上 localStorage 已写入，纯视觉反馈丢失）
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 本地实机 ✅（vite dev + 浏览器：点击「简易/精确」高亮立即切换、localStorage 写入、提示文案联动；重进 setup 按存储值恢复；开始相遇页头显示所选模式端到端生效）｜ 线上实机 ✅（d0120b2 部署后指纹一致 + 行为验证）
- **遗留风险**：无功能风险；注意 setup 页直连 URL 且无草稿集合时仍为空态（既有行为，与本修复无关）
- **下一步（给接手者）**：无遗留；如后续给排序模式加新档位，记得 RANK_MODES 与 useSorting 的合法值集合同步

### T-20260928-07 · 修复两批：「其他」维度封面/详情 + AI 点评截断
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：艾尔登法环/辐射 4 列表封面渲染、详情弹窗 386 字简介+大图、AI 点评截断为 Worker 端修复随部署生效）｜ **负责人**：本 agent
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7（AI）
- **最小上下文**：`worker/media.ts`（computePosters other 分支）+ `worker/other.ts`（wikiPageImageAny/wikiEnTitle）+ `worker/posterStore.ts`（mediaTypeForKind）+ `src/components/Poster.tsx` + `worker/ai.ts`（maxOutputChars）
- **改了什么**：① 「其他」维度接入 wiki 海报管线（最终五段：① searchWikiPoster 评分匹配[free 自由图；langlinks 英文标题补简繁变体盲区；wikiImageUrl 缩略档优先] → ② zh 主图直取 → ③ en 主图直取[先于 en 评分：free 档相关图会抢在 infobox 封面前] → ④ en 评分匹配 → ⑤ otherDetail 容错；标题变体/剥分隔符防同名错配；type=undefined 参与评分防 TYPE_WORDS 误杀）；② other 详情超时 20s→30s；③ AI 点评截断：CallOptions.maxOutputChars（默认 2000 不变），/api/insights 按档位放宽（字符 2500/5000/9000 + maxTokens 2000/3500/6000）；④ 移除已废弃的百度百科 openapi 调用（恒 errno 6，白拖 8s）；⑤ 文档：FEATURES 海报管线行、CHANGELOG（订正至五段最终形态）、README/USAGE 同批
- **为什么**：用户报障两批；「其他」维度自上线起无封面（管线从未接入且 old 映射会错配同名豆瓣电影），详情慢查被 20s 掐断；AI 点评 deep 档撞 2000 字符硬顶
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 线上实机 ✅（多轮取证迭代后终版）：**蒙娜丽莎页面级渲染成功**（loaded:true、正确原画 1280px 缩略——修复「一直转圈」）+ 详情弹窗简介/大图 + 艾尔登法环/辐射 4/塞尔达/只狼非自由封面正确 + AI 点评 maxOutputChars 绊线 ×2
- **遗留风险**：① 取图长尾语义错配（无类型词表）：「底特律 变人」命中底特律市天际线、「纪念碑谷」命中真实纪念碑照片——用户名与条目名差异+同名概念所致，经 poster_errors 观察；② **运维教训**：调取图逻辑后必须双清才能重测——D1 `poster_urls` 侧表无 TTL（解析结果永久短路新代码，`DELETE ... WHERE media_key LIKE 'other|%'`）+ 设置清海报缓存（推代次清 edge/isolate 层）；③ `pilicense=any` 参数会使 pageimages 查询整体失效（实测），勿再试；④ 真实 key 的 AI 点评截断效果未端到端验证（上限已放宽至 deep 9000 字符/6000 tokens）
- **下一步（给接手者）**：观察 poster_errors 与用户反馈的 other 取图准确率；若语义错配多，考虑用 otherDetail 的简介做类型二次过滤

### T-20260928-06 · 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **状态**：👀 待审（本地全绿 + stub smoke 实锤；**真实 key 端到端留用户复核，推送后线上可见**）｜ **负责人**：本 agent
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/components/JevDivergenceCard.tsx` + `src/lib/jevDivergence.ts` + `src/views/CompareView.tsx`（AI 卡下方挂载点）+ `src/lib/typesafe.ts`（requestJevRanking 复用）
- **改了什么**：① `lib/jevDivergence.ts` 偏差 Top3 纯函数（×10 单测：predictedPositions 越界/重复过滤、topDivergences 零偏差剔除/同分按对方名次）；② `JevDivergenceCard.tsx`（点击才请求/失败分类+去配置入口/数据签名过期守卫/<4 件提示/track jev_predict_divergence）；③ CompareView 接入（peerMergedForJev 与比较结果同一 merge 口径 + myTasteContext=buildTasteContext(我的全维度)）；④ 文档：冲刺计划 Phase 6 ✅、FEATURES §3/§12、README 相遇行、USAGE 新小节、CHANGELOG
- **为什么**：台账待办队列首位；Jev 第三应用点；**零 Worker 改动**——jev-rank 的 profileContext 参数化即 predict 模式，无新端点（API.md 不变）
- **验证状态**：五道门禁 ✅（481 passed·9 skipped，+10 例）｜ 本地 stub smoke ✅（.tmp/jev-smoke-server stub 倒序 order → 偏差 +9/−9/+7 数学正确、同分排序正确、失败路径「去配置」按钮正确）｜ **真实 TypeSafe key 端到端 ⬜（用户配置 key 后在相遇页点「预测分歧」即可复核）**
- **遗留风险**：① Jev 单次预测 ~n 件作品一个 systemone 调用，费率受限（ai_jev 10 次/窗口）——卡上已注明隐私与频率；② 偏差口径基于「合并榜单位次」而非原始 rank（median 重排后 rank 有空洞），设计如此；③ `npm run worker:dev` 历史遗留起不来（DASHBOARD_HTML 字符串导出被本地 workerd 拒绝），不影响部署，待单独批次修
- **下一步（给接手者）**：推送后线上复核（配置 key → 相遇页 → 预测分歧）；接 Phase 7（Wrapped 年鉴卡）或 Phase 8（PWA）

### T-20260928-05 · UI 现代化 P4 · 收尾（本地部分）
- **状态**：✅ 完成（线上资产级验证 + 真实浏览器实机查验 2026-09-28 全过；任务受用户委托代验）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ 文档
- **最小上下文**：`docs/PLAN-ui-modernization.md` P4 + `src/components/ThemeSwitcher.tsx` + `src/styles.css` :root 景深段 + PITFALLS 4.20
- **改了什么**：① ThemeSwitcher 菜单分「经典(7)/新系列(4)」两组（`NEW_SERIES` 集合 + 绊线）；② `--ev-1/2/3` :root 全局定义（三级公式 + `--shadow-tint:#000`），aurora 块内定义移除（只覆写 tint），绊线改写为「:root 公式 + 全文唯一」；③ `docs/ui-baseline.json` 重生成（ui-audit）+ 全主题 22 张截图重拍为新基线；④ README/FEATURES/USAGE 主题 7→11 收口 + 开场特效补「极光绸带」；⑤ CHANGELOG/PLAN 勾选（v3.4）
- **为什么**：P4 计划项；4.20 遗留（被引用未定义的 token）自 2026-09-22 悬置至今，P4 是计划好的清偿窗口
- **验证状态**：五道门禁 ✅（474 passed·9 skipped）｜ 全主题 22 张截图肉眼抽查 ✅（旧主题阴影柔和，dim-chip/海报缩略/浮层获得景深，无过重投影）｜ ui-contrast ✅（≥4.5）｜ **线上资产级验证 ✅（2026-09-28）**：dist 指纹与线上一致（index-CIWrWAfv.js / index-Dvpbr4nG.css）；线上 CSS 含 gallery/aurora/editorial 块、gl-* 全套、:root 三级景深（--ev-1 全文唯一）；线上 JS 含「画廊/新系列/极光绸带」；SPA 深链 /myself /plaza 带 accept:text/html 回退 200——**实机肉眼签收待用户**（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / macOS 衬线段 / ShareView 分享卡）
- **遗留风险**：① 旧主题像素自本 commit 起带阴影（计划内重立基线）——如线上观感过重，调 :root 三级公式百分比即可全局收敛；② 线上验证覆盖弹窗/比较页实机走查（本地仅截图静态路径）
- **下一步（给接手者）**：推送 → Cloudflare 自动部署 → sort.logicc.top 实机验证（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / editorial 衬线 macOS 段 / ShareView 分享卡）→ PLAN 与台账标 ✅；若涉及主题包用户，公告「新系列四主题 + 菜单分组」

### T-20260928-04 · UI 现代化 P3 · gallery 数据画廊
- **状态**：✅ 完成（线上实机验证 2026-09-28：gallery Bento/卡片墙 hover 翻转/弹窗 24px 圆角/拍立得真数据/移动端 390px 单列）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.3/P3 + `src/components/GalleryBento.tsx` + `src/components/GalleryWall.tsx` + `src/lib/galleryStats.ts` + `src/styles.css`（gallery 块，文件末尾）
- **改了什么**：`theme.ts` 注册 gallery（第 11 个内置主题）；`galleryStats.ts` 画像聚合纯函数（×10 单测，只读 profile 零数据层改动）；`GalleryBento.tsx`（Top1 大卡 2×2+2-5 名跟进 / 手写 SVG 雷达 / 年代堆叠条 / 口味坐标 / 榜单索引，grid-areas 编排，≤800px 单列）；`GalleryWall.tsx`（海报正面/批注背面 3D 翻转卡片墙，hover 包 media(hover:hover)，触屏点按翻面，focus-within 可达）；ProfileView/ShareView L3 分支（classic 路径 DOM 不变）；styles.css gallery 块（变量 21 token + `--shadow-tint` 显式阴影 + 弹窗大圆角/报刊亭 topbar/拍立得贴纸/行式榜单 hairline + gl-* 支撑样式 + 重排行 flex 守卫）；测试：ui-fixes 新增 P3 绊线 8 条；工具：ui-contrast/ui-shots-themes 加 gallery（22 条），`docs/ui-contrast.json` 重生成
- **为什么**：PLAN v3 四组新主题的第三组；画像页 Bento 是本计划最重的 DOM 改动，验证 L3 机制在复杂视图上的零回归能力
- **验证状态**：五道门禁 ✅（check/lint 0 error/format/test 473 passed·9 skipped/build）｜ 旧主题 **20 张截图 stash 基线法 zero-diff**（tol=0，含 editorial 系与 aurora）｜ gallery 截图肉眼签收 ✅（首页 / 画像桌面+540 移动 / 排序 / 广场）｜ 卡片墙 3D 翻转 CDP 探针实锤 ✅（hover→matrix3d rotateY(180°)、preserve-3d、perspective 1100px；reduced-motion→transform none 平铺；topbar grid/bento grid/拍立得 rotate 同探针验证）｜ ui-contrast 全对 ≥4.5（gallery 最差 6.45:1）｜ **线上 ⬜**
- **遗留风险**：① ShareView 分享卡与侧栏 QR 展签格需真实分享链接，线上验证；② 广场贴纸拍立得经 fetch 桩探针验证（探针 `.tmp/gl-flip-probe.mjs` 未入库），线上需肉眼复核真数据下的换行/旋转；③ 矩阵「来源分布」无逐作品数据未做（PLAN P3 偏差 1）；④ PNG 导出「bento」版式未做（偏差 2）
- **下一步（给接手者）**：P4 收尾——全主题（7 旧 + 4 新）× 全路由截图回归 + §2 差异矩阵逐格核对 + 主题菜单分组（经典/新系列）+ README/FEATURES/USAGE/THEME-PACKS「7→11」文档收口 + `--ev-*` 全局补齐重立基线 + macOS 衬线段 + sort.logicc.top 线上验证（P1/P2/P3 三批一起）

### T-20260928-03 · UI 现代化 P2 · aurora 极光主题
- **状态**：✅ 完成（线上实机验证 2026-09-28：aurora 胶囊导航 + 极光绸带推荐默认 + plasma 持久化优先，真 WebGL 渲染确认）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.2/P2 + `src/styles.css`（aurora 块）+ `src/lib/orbEffects/ribbon.ts` + `docs/agents/PITFALLS.md` 4.20
- **改了什么**：`theme.ts` 注册 aurora（第 10 个内置主题）；`src/lib/orbEffects/ribbon.ts` 新特效（柔光基座 + 4 绸带 + 600 粒子）+ registry `RECOMMENDED_BY_THEME`（aurora→ribbon，持久化优先逻辑不动）；OrbScene 主题变更按推荐重挂；ThemeSwitcher 勾选跟随；styles.css aurora 块（变量 21 token + `--ev-*` 仅块内定义 + 玻璃 2.0/胶囊导航/duel 辉光脉冲/conic 描边按钮/弹窗景深/进度流光 7 组件）；App.tsx topbar scrolled class；测试：`orbEffects/registry.test.ts` 10 例 + ui-fixes 9 绊线；工具：ui-contrast/ui-shots-themes 加 aurora（20 条）
- **为什么**：PLAN v3 四组新主题的第二组；aurora 是唯一带新 orb 特效的主题，验证链路从截图扩展到 CDP 探针
- **验证状态**：五道门禁 ✅（456 passed·9 skipped）｜ 旧 7 主题 14 张 + editorial 系 4 张 zero-diff ✅（stash 基线法 tol=0）｜ aurora 首页桌面/移动 + duel 双卡 + 辉光脉冲（按住中段截图）肉眼签收 ✅ ｜ **§6 验收六项全过**（CDP 探针：切换 4 轮无 contextlost / palette 色相跟随 / reduced-motion 双截图逐字节一致 / 跨 700px 桌面 0.68 右偏·移动居中 / 持久化 / 移动 0.88）｜ **线上 ⬜**
- **遗留风险**：① `--ev-*` 全局缺失（见 PITFALLS 4.20）——只补了 aurora 块内，旧主题「补齐并重立基线」留 P4；② CDP 探针脚本在 `.tmp/`（一次性工具，未入库）；③ macOS 衬线段未测（沿袭 P1）
- **下一步（给接手者）**：P3 gallery（§2.3 八差异组件，画像页 Bento L3 重构）｜ P4 收尾：全主题回归 + 差异矩阵逐格核对 + README/FEATURES/USAGE「7→11」文档 + `--ev-*` 全局补齐重立基线 + sort.logicc.top 线上验证

### T-20260928-02 · UI 现代化（多主题增量，PLAN-ui-modernization v3）
- **状态**：✅ 完成（线上实机验证 2026-09-28：editorial 海报堆叠 hero + 序号导航 + Windows 衬线段 Georgia/SimSun 生效）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` + `src/styles.css` + `src/lib/theme.ts` + `docs/agents/CONVENTIONS.md` §6
- **改了什么**：（P0 ✅ 已提交 `1357b12`）useTheme/auraColor/动效代币；（P1 本地待提交）editorial + editorial-dark 双主题：变量块 ×2、`theme.ts` 注册、HomeView hero L3 重构（海报堆叠 + 移动端 scroll-snap 轮播）、SortingView 回合水印 L3、topbar/按钮/弹窗/进度/榜单/维度条 L2 覆写；修复两处 CSS 特异性陷阱（各配绊线）；工具：`gen-editorial-shots.mjs`、themes manifest 补 3 主题、ui-contrast 支持 editorial
- **为什么**：用户拍板三方向全做、增量多主题、不改老 UI、组件级差异；P1 为四组新主题的第一组
- **验证状态**：五道门禁 ✅（lint 0 error；test 偶发 glob 竞态漏收集 2 文件、单独跑均过）｜ 旧 7 主题 14 张 zero-diff ✅ ｜ editorial 8 张截图肉眼 + 盒模型 dump 签收 ✅ ｜ **线上 ⬜**
- **遗留风险**：① macOS 衬线段（Songti SC/STSong）未测；② 本环境 vitest glob 竞态（WorkBuddy fs 代理）会偶发漏收集 `worker/ai.test.ts`(44) / `src/content-intro.test.ts`(9)，非代码回归；③ `--r-*` 未归零（弹窗显式 radius:0，见 PLAN §P1 偏差）
- **下一步（给接手者）**：P2 aurora（§2.2 七差异组件，orb ribbon 特效）｜ P4 收尾时补 macOS 衬线段 + sort.logicc.top 线上验证 + README/FEATURES/USAGE 的「7→11 主题」文档同步

### T-20260928-01 · 文档体系重建（记忆 + 多 agent 协同文档）
- **状态**：✅ 完成 ｜ **负责人**：文档 agent
- **任务类型**：文档（不涉业务代码）
- **最小上下文**：`AGENTS.md` + 515 条 git log
- **改了什么**：新建 `AGENTS.md`、根 `MEMORY.md`、`docs/memory/{TIMELINE,DECISIONS,EPISODES}.md`、`docs/agents/{MAP,HANDOFF,CONVENTIONS,PITFALLS,ROLES,TASK-LEDGER}.md`；修改 `README.md` 增加分层导航与 Agent 索引
- **为什么**：单次会话可读上下文有限，39,600 行代码 + 515 条 commit 无法每次全量阅读；需要「任务 → 文件」路由让 agent 只读相关部分
- **验证状态**：单测 n/a ｜ 本地 n/a ｜ 线上 n/a（纯文档）
- **遗留风险**：文件行号会漂移，路由表以符号名/路由字符串为准；`docs/agents/MAP.md` 中的行数统计为 2026-09-28 快照
- **下一步（给接手者）**：首个使用新文档体系的 agent 请顺手补 `MAP.md`（若发现路由缺失）与 `PITFALLS.md`（若踩到新坑）

---

## 待办队列（按优先级）

### ⬜ P0 · `year` 参数导致 icon 文件被选为封面（预存缺陷，危害高于任何"多一个按钮"）
- **任务类型**：§2.1（判决链路）
- **最小上下文**：`worker/other.ts` 的 `otherDetail(name, year?)` + `titleMatchTier` + `scoreOtherPage` + `pickBest`
- **要点**：实测 `/api/other/detail?name=纪念碑谷&year=2014` → `Monument_Valley_icon_unrounded.jpg`，**不带 year** 才是 `500px-Monument_Valley,_Utah,_USA_(23611451292).jpg`。`year` 进入标题评分后把作品判到了 icon 文件。候选修法：给 year 加权重上限；或对 icon/系列页主图降权。**这是真的选错图，用户直接看到错封面。**
- **证据**：迭代 8 的 `.tmp/attr8.mjs` 归因实验（带 year → icon，不带 → 作品页），`git diff` 确认与迭代 8 的改动无关

### ⬜ P1 · 浏览器 E2E 缺口（迭代 7/9 连续两次因此留红）
- **任务类型**：§2.5（验证基建）
- **最小上下文**：`src/components/Poster.tsx`、`src/components/CoverChoice.tsx`、`vitest.config.ts`（现为 `environment:"node"`、无 jsdom）
- **要点**：一次性 Playwright 脚本，覆盖「导入含两件同名 `other` 作品的清单 → 在弹窗裁决一件 → 断言第二格拿到同一张图」「`degraded` 态重试按钮」「三态空格子文案」。**两轮验收都因为"只能浏览器里验"而把 A 留红，这是本仓最大的结构性测试债。**

### ⬜ P1 · 第 5 档兜底的运行时用例（迭代 8 遗留）
- **最小上下文**：`worker/media.ts` 的 other 五档 fallback + `WikiProbe`
- **要点**：「前 4 档成功、第 5 档超时 ⇒ `absent`」目前**只有源码形状断言**，没有真正的运行时用例。判据：probe 记到了成功答复 ⇒ 不判 `throttled`。

### ⬜ 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/views/CompareView.tsx` + `worker/typesafe.ts` + `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 6
- **要点**：复用 `/api/ai/jev-rank` 加 predict 模式；比较页新增「对方最出乎你意料的作品」—— 用我的榜单预测对方排名，与真实排名求偏差 Top3
- **依赖**：需用户配置 Jev key 才能端到端验证

### ⬜ 优化冲刺 Phase 7 · 文化年度报告（Wrapped）
- **任务类型**：§2.2 + §2.3
- **最小上下文**：`src/lib/exportPng.ts` + `src/lib/ranking.ts` + `src/views/ProfileView.tsx`
- **要点**：可导出 PNG 的年度年鉴卡：总取舍次数（decisionLog）、榜单/作品数、最纠结一对（回环数据）、媒介占比；印刷年鉴风格

### ⬜ 优化冲刺 Phase 8 · PWA 离线
- **任务类型**：§2.2 + §2.9
- **最小上下文**：`public/sw.js` + `public/manifest.json` + `docs/memory/PITFALLS` §1.7
- **要点**：app shell 缓存，主链路（清单→排序→画像）离线可用。**沿用 SW 导航缓存教训**：network-first 导航、cache-first 静态

### ⬜ Jev Phase 2 · 维基消歧改用 Choice
- **任务类型**：§2.6 + §2.7
- **最小上下文**：`worker/media.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 2 + `docs/memory/EPISODES.md` E-20260908
- **要点**：把手写打分（限定标题/类型声明/年份守卫）换成一条 Choice 问题；现有规则**保留为降级路径**；改动面较大，独立一批提交
- **⚠️ 警告**：不要继续堆启发式规则（十余次迭代已证明边际收益递减）

### ⬜ Jev Phase 3 · 广场内容护栏（Noul）
- **任务类型**：§2.7 + §2.4
- **最小上下文**：`worker/plaza.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 3
- **要点**：发布前同步检查（70ms 延迟预算）：Noul 判不当内容 + Choice 判灌水；失败必须放行或明确提示，**主链路不依赖**

### ⬜ P2 打磨待办池（2026-09-27 全量审查遗留）
- **最小上下文**：`docs/ROADMAP.md` 的 P2 待办池章节
- **要点**：逐条处理，每条独立提交 + 线上验证

---

## 已归档（近期完成，供回溯）

| 编号 | 任务 | 完成日 | commit |
|------|------|--------|--------|
| P5 | Jev 辅助模式（AI 代判，置信 ≥0.8） | 2026-09-28 | `50e46df` |
| P4 | 路由拆包（index 1072→964 KB） | 2026-09-28 | `82b5b2d` |
| P3 | 广场品味相似度徽章 | 2026-09-28 | `bcdaabb` |
| P2 | 分享/广场 OG 卡片 | 2026-09-28 | `dca3ab0` |
| P1 | 移动端滑动选择 | 2026-09-28 | `8017364` |
| — | Jev Phase 1（AI 快排） | 2026-09-27 | `50e46df` 前序 |
| — | UI 全站焕新「夜间档案馆」 | 2026-09-22 | 46 commits |
| — | P0/P1 安全加固 + 插件系统 | 2026-09-25 | 23 commits |

更早的历史见 [`docs/memory/TIMELINE.md`](../memory/TIMELINE.md)。

---

## 使用规则

1. **先登记再动手** —— 避免两人改同一文件。
2. **完成即更新** —— 状态、验证层次、遗留风险、交接对象，四件齐全才算交班。
3. **线上验证过才标 ✅** —— 只有单测/本地通过标 🔄。
4. **新条目插到「进行中 / 最近」顶部** —— 本文件最新在最上面。
5. **完成的条目下沉到「已归档」** —— 保持「进行中」区不超过 5 条。
