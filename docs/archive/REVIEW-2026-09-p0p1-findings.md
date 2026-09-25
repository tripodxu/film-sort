# 全仓代码库审阅报告

> 审阅范围：当前工作目录 `E:\mimo\temp\5\film-sort3` 的 155 个版本控制文件；其中 24 个为 D1 migration。`.goatgauge-data/`、`.tmp/`、`dist/` 等被忽略的浏览器、测量和构建生成物不作为业务源码审阅对象。
>
> 本轮只做审阅、证据整理和验证，没有修改业务代码。报告将确定性缺陷、需要运行环境验证的静态风险、以及可选架构改进分开。

## 1. 结论摘要

### 做得较好的部分

- 画像/分享/广场写入大多经过 `shared/storedItem.ts` 的字段白名单与 512 KiB 上限；这是很好的防脏数据护栏。
- 写接口普遍有同源检查，账号/分享/广场多数有请求体和限流护栏；AI、邮件、图片等外部调用已有部分超时。
- 当前静态门禁可重复通过：TypeScript、Prettier、Vitest、生产构建均成功；本次新鲜测试结果为 20 个测试文件、19 个通过、1 个跳过，303 passed、9 skipped。
- 测试覆盖了排序、画像解析、投影、海报缓存、载荷白名单、限流窗口等纯函数/模拟路径；这为修复提供了较好的回归面。

### 最重要的上线前风险

1. **P0/安全**：用户可控详情 URL 的 host 校验是子串匹配，且跟随未复核的 redirect；存在 SSRF/非预期上游读取风险。
2. **P0/安全**：自定义 AI 的模型列表请求没有与生成请求使用同等的 redirect/DNS/IP 策略，模型名还会直接进入 URL 路径。
3. **P0/凭证完整性**：网易云/豆瓣 QR code 在内存中只按外部 key 关联，轮询时按“当前请求用户”写入 Cookie；key 泄露或并发串线时可能把外部账号凭证写到另一账户。
4. **P0/P1/配置安全**：邮件通道全部未配置时默认 `ok: true` 并把验证码写日志；生产误配会绕过真实发信验证。
5. **P1/数据正确性**：quick 排序估计值可为小数，但快照校验要求整数；撤销和草稿恢复会失败。该问题已用当前源码在 Node 24 上复现。
6. **P1/数据完整性**：画像 ID 长度口径、重复 ID、重排集合校验、云端批注清空语义、认证恢复与自动同步时序都存在边界缺口。

### 当前质量基线

| 命令 | 新鲜结果 | 说明 |
|---|---|---|
| `npm run check` | exit 0 | TypeScript project check |
| `npm run lint` | exit 0；25 warnings，0 errors | 主要为 Hook 依赖和未使用变量 |
| `npm run format:check` | exit 0 | Prettier 全部通过 |
| `npm test -- --run` | exit 0；303 passed / 9 skipped | 19 files passed，1 skipped |
| `npm run build` | exit 0 | `index.js` 524.84 kB、`OrbScene` 521.68 kB；Vite 给出 >500 kB chunk 警告 |
| `npm audit --package-lock-only --json --registry=https://registry.npmjs.org` | exit 1；1 critical、4 high、3 moderate | 主要落在 Vitest/Wrangler 等开发依赖；`--omit=dev` 结果为 0 |

> 绿色测试不等于这些运行时边界安全：当前 Vitest 是 Node 环境，未覆盖真实 Cloudflare Workers、D1、浏览器组件、OAuth 回调、Service Worker、并发请求和外部上游。

## 2. 严重程度与证据规则

- **P0**：在合理的生产暴露面下可能造成凭证泄露、SSRF 或认证绕过；上线前应阻断或加临时开关。
- **P1**：可造成数据丢失、跨账户数据污染、资源滥用、明显用户故障或可被稳定触发的安全缺陷；应在近期迭代修复。
- **P2**：性能、可维护性、可观测性、文档和交付流程改进；可排入后续迭代。
- “确定性缺陷”表示从当前代码路径即可推出触发条件；“静态风险”表示依赖 Cloudflare 网络行为、并发时序、外部服务或部署配置，需集成环境复现。

## 3. P0：上线前应处理的缺陷/风险

### SEC-01：详情路由的 SSRF 防线可被子串和 redirect 绕过

- **类型**：静态安全风险；可由公网 GET 触发。
- **证据**：`worker/index.ts:2048-2093` 接受客户端 `url`；`worker/media.ts:1977,2062` 只检查 URL 是否包含 `book.douban.com/subject/` 或 `movie.douban.com/subject/`。`worker/media.ts:1914-1935` 使用 `redirect: "follow"`，最终 URL 没有重新验证 hostname，响应也没有应用层字节上限。
- **触发**：提交类似 `https://attacker.example/book.douban.com/subject/123` 的 URL，或让允许 host 重定向到非允许 host；上游返回超大 HTML。
- **影响**：Worker 可能代替请求者访问攻击者控制的或非预期的主机，消耗上游/网络资源；具体能否触达内网取决于 Cloudflare 网络策略，但应用层不应把它当作安全边界。
- **修复方向**：用 `new URL()` 后做精确 `protocol=https`、`hostname`/端口白名单和 subject ID 形态校验，最好由 subject ID 构造规范 URL；所有跳转手动逐跳检查并限制跳数；对最终响应校验 content-type，并使用 `Content-Length` + 流式读取上限。
- **成本**：中（2–4 人日，含测试）。
- **验证**：本地 mock `允许 host → 127.0.0.1/evil host`、跨协议、非图片/HTML 超大 body，确认每个请求都被拒绝；补 Worker 集成测试而非只测字符串函数。

### SEC-02：自定义 AI 的 endpoint 校验和模型列表路径不一致

- **类型**：静态安全风险。
- **证据**：`worker/ai.ts:372-407` 只对用户 URL 做字面 host/协议检查，没有 DNS 解析后的私网/元数据地址校验；`worker/ai.ts:412-431` 将 `model` 直接拼进 Gemini 路径；生成请求在 `worker/ai.ts:599-618` 使用 `redirect: "manual"`，但模型列表 `worker/ai.ts:740-777` 使用默认 `fetch`，会跟随 redirect，并携带 API key。
- **触发**：配置一个会重定向的公网域名，或让 DNS 在校验后解析到内网/元数据地址；模型名包含路径分隔符（当前正则允许 `/`、`:`）。
- **影响**：API key 可能被发送到非预期主机；自定义配置可访问内网服务或构造出意外 endpoint。
- **修复方向**：自定义 AI 统一经过一个 outbound policy Module：严格协议/端口/host 策略、DNS/IP 复核或产品级 host allowlist、所有请求 `redirect:"manual"` 并只允许安全跳转；模型名按单个 path segment 编码；模型列表与生成请求共用同一 Seam。
- **成本**：中到高（3–6 人日；DNS 安全策略需结合 Workers 能力验证）。
- **验证**：测试重定向到 `127.0.0.1`、RFC1918、IPv6、混合 DNS 答案、超长/含 `..` 的模型名，以及每一跳是否仍携带 key。

### SEC-03：QR 登录凭证没有绑定发起账户

- **类型**：静态凭证完整性风险；高概率出现在 key 泄露、同一浏览器多账户/多标签页并发场景。
- **证据**：网易云 `worker/netease.ts:376-438` 的 `unikey` 轮询拿到 `userId` 后直接 `saveProviderCookie(env, userId, ...)`；`worker/netease.ts:186-209` 的 QR jar/channel map 只按 `unikey` 存。豆瓣 `worker/douban.ts:26-64,119-149` 的 `qrJar` 同样只按 `code` 存，轮询时用当前请求的 `userId` 写 `dbcl2`。
- **触发**：账户 A 获取的 `unikey/code` 被账户 B 或另一标签页拿到；或者两个请求在确认瞬间交错。
- **影响**：外部平台登录 Cookie 可能被写入错误账户，造成跨账户数据越权或用户连接状态错配。
- **修复方向**：二维码 key 应成为带 TTL、一次性消费、owner binding 的服务端事务；至少在持久层保存 `owner_user_id`，轮询时使用 `DELETE ... WHERE owner=? AND key=?` 或条件更新确认 owner。D1/KV 不应只依赖 isolate 内存；成功/失败/过期都清理事务。
- **成本**：高（4–7 人日，含并发和隔离测试）。
- **验证**：A 签发、B 轮询、A 轮询、重复轮询和确认后重放，断言只有 A 能得到 `confirmed`/写入 vault；增加跨标签页 race 测试。

### SEC-04：邮件双通道未配置时 fail-open，并把 OTP 写日志

- **类型**：确定性配置缺陷；生产误配时成为认证绕过风险。
- **证据**：`worker/mailer.ts:144-177` 在 Resend 和 luckycola 都未配置时返回 `{ ok: true, reason: "dev" }`；`worker/mailer.ts:172-175` 直接把邮箱、用途和验证码写入日志。`worker/account.ts:355-367` 只看 `ok`，因此验证码流程会认为邮件已成功。
- **触发**：生产没有 `RESEND_API_KEY`、luckycola 任一配置。
- **影响**：攻击者可绕过真实邮箱投递验证（尤其结合日志/错误通道泄露时）；OTP 出现在日志，形成敏感信息泄露。
- **修复方向**：开发兜底必须显式要求 `ENVIRONMENT=development`（或明确的 dev secret），生产默认 fail-closed 并返回 503；生产启动/健康检查应报告 mailer 未配置；日志不得包含 OTP。
- **成本**：小到中（1–2 人日，含部署配置校验）。
- **验证**：无 mailer 配置的 production/local 测试均不能得到 `ok:true`；开发开关下只返回可用性提示，不把验证码写入日志；检查 `issueVerificationCode` 失败时不会留下可消费验证码。

## 4. P1：近期应修复的缺陷与数据完整性问题

### DATA-01：quick 模式快照无法反序列化

- **类型**：确定性缺陷；已复现。
- **证据**：`src/lib/ranking.ts:190-197` 的 quick 估算使用 `(itemCount - topN) * 1.3`，没有取整；`src/lib/ranking.ts:577-579` 直接保存该值；`src/lib/ranking.ts:1059-1082` 的 `hasBaseShape` 要求 `estimatedTotalComparisons` 为整数；`src/lib/ranking.ts:1161-1192` 因此抛错。`src/lib/useSorting.ts:657-667` 的撤销快照和 `src/lib/useSorting.ts:747-753` 的草稿保存会消费该序列化结果。
- **触发**：quick 模式在 `itemCount > topN` 时点击一次选择后撤销，或保存/恢复草稿。
- **影响**：用户操作失败、进度丢失；事件处理器还可能直接抛异常。
- **修复方向**：在生成端使用统一的 `ceil`/整数估算，或在反序列化端允许有限非负数并迁移旧快照；不要让显示估算值成为状态机合法性的约束。
- **成本**：小（0.5–1 人日）。
- **验证**：对所有模式、不同 item/topN 组合执行 `serialize → deserialize` 回归测试；覆盖首次撤销、连续撤销、草稿恢复和旧版本快照。

### DATA-02：画像身份与重排不变量没有在写入端闭合

- **类型**：确定性数据完整性缺陷。
- **证据**：`shared/storedItem.ts:90-93` 允许 ID 最长 200 字符；`src/lib/profile.ts:44-45,101-128` 的画像解析默认只接受 160 字符。`src/lib/profile.ts:83-90` 按 title/year/creator 去重但没有拒绝重复显式 ID。`src/lib/profile.ts:314-333` 的 `reorderRanking` 只检查输出长度；重复 ID 或“外来 ID + 缺失 ID”的同长度组合可以生成重复名次。`src/lib/profile.ts:352-378` 合并画像没有限制榜单数/总字节。
- **触发**：共享投影写入超长 ID、两个不同作品显式使用相同 ID、拖拽重排传入重复集合，或合并很多本地/云端榜单。
- **影响**：保存成功但刷新丢条目、重复作品/名次、localStorage/D1 超过产品上限。
- **修复方向**：建立一个唯一的 `validateRankingDocument`/`projectRanking` Module，统一 ID 长度、唯一 ID、identity、rank 连续性、数量和字节上限；写入前拒绝无法无损修复的输入，读取端只做兼容迁移。重排必须验证 `new Set(newOrder)` 与原 ID 集合完全相等。
- **成本**：中（2–4 人日）。
- **验证**：超长 ID、重复 ID、重复 identity、外来/缺失 ID、20+ 榜单和接近 512 KiB 的 property-based 测试；验证 localStorage 与 Worker 投影结果相同。

### DATA-03：空批注无法清空云端旧值

- **类型**：确定性语义缺陷。
- **证据**：`shared/storedItem.ts:242-251` 将空批注编码为 `null`；`worker/account.ts:728-737` 用 `COALESCE(excluded.notes, old_notes)` 保留旧值；`src/lib/useAuth.ts:80-101,161-165` 在本地为空时省略 `notes`，与“未提供即保留”叠加。
- **触发**：用户在云端已有批注的画像上删除全部批注，再同步/重登。
- **影响**：云端批注继续存在，删除无法同步；可能重新出现在其它设备。
- **修复方向**：明确 API 语义：字段缺失=保留，字段存在且 `{}`=清空；Worker 按“是否提供”更新，不把空值和未提供混为一谈。冲突合并必须同时处理 profile、notes 和 revision。
- **成本**：小到中（1–3 人日）。
- **验证**：已有批注→全部删除→同步→重新拉取；另一设备删除；冲突合并和网络重试后仍只保留明确结果。

### DATA-04：认证恢复、自动同步、登出之间存在时序数据风险

- **类型**：静态/可复现的异步正确性风险。
- **证据**：`src/lib/useAuth.ts:431-464` 挂载时只恢复账户信息和批注，没有先 hydrate 云端 profile；`src/lib/useAuth.ts:397-408` 随后可在 900ms 后自动 PUT 本地 profile。`src/lib/useAuth.ts:68-101` 没有请求代际或 AbortController；`accountAuth` 的 `setTimeout` 没有取消。`src/lib/useAuth.ts:349-395` 登出同步失败后仍清除本地数据；同步失败时 `syncPending` 可能被 `break` 丢弃。
- **触发**：已有本地画像和云端画像不同，刷新/快速登录；用户在 PUT 尚未完成时登出或切换账户。
- **影响**：旧响应覆盖新账户状态、尚未同步的本地修改丢失、云端数据被本地旧版本覆盖。
- **修复方向**：把“会话 hydrate → 用户确认/版本比较 → 才允许自动同步”做成一个深 Module；每个异步操作带 request generation/AbortController，失败保留 pending 并在 online/可见性恢复时重试。登出应明确“丢弃未同步修改”或先提示/保存。
- **成本**：高（4–7 人日，需 UI 和同步协议一起调整）。
- **验证**：用延迟 Promise 模拟 A/B 账户、快速刷新、登出、断网、409/500；断言任何旧响应都不能写入新会话，且 pending 修改有明确最终状态。

### DATA-05：OAuth/验证码交换不是一次性原子操作

- **类型**：并发静态风险；可导致 token 重放或验证码丢失。
- **证据**：`worker/account.ts:527-540` 先 `SELECT oauth_exchanges` 再 `DELETE`，两次请求可同时返回同一 token；`migrations/0015_oauth_exchange.sql:2-8` 明文保存 bearer token。`worker/account.ts:329-354` 验证码发码是 DELETE 后 INSERT；`370-398` 是 SELECT 后 DELETE；`418-431` 先消费验证码再插入用户/创建 session，失败时验证码已丢失。`worker/account.ts:729-736` 仍用 COALESCE。`worker/account.ts:269-277` 将 Google 缺失的 `email_verified` 当作已验证。
- **触发**：同一 exchange code/验证码并发重放；改密过程中用户表更新或 session 创建失败；provider 返回缺字段的 userinfo。
- **影响**：会话 token 被多次消费、重置/注册失败后无法重试、异常 OAuth 响应可能错误并号到已有邮箱账号。
- **修复方向**：使用带条件的状态转换（`UPDATE ... WHERE consumed=0` 并检查 changes）或 D1 batch/事务；exchange 只存 token hash，消费后不可逆删除；验证码加 pepper/唯一 `(email,purpose)` 约束和过期清理；Google 必须 `email_verified === true`；改密/注册把用户更新、验证码消费、会话创建设计成一个可恢复流程。
- **成本**：高（5–8 人日，需 migration 和并发测试）。
- **验证**：并行兑换/改密/注册，断言最多一个成功；注入用户表/session 写入失败；检查异常 OAuth userinfo 不并号。

### PLAZA-01：点赞、评论、回复和计数缺少同事务/同帖约束

- **类型**：确定性并发/数据完整性风险。
- **证据**：`worker/plaza.ts:456-480` 先查点赞再 INSERT/DELETE，计数另一次 UPDATE；并发请求会撞 UNIQUE 或漂移。`worker/plaza.ts:528-539` 只验证 parent_id 是正整数，不验证父评论属于同一 post；`worker/plaza.ts:559-564` 删除评论和更新计数分离。`worker/plaza.ts:705-727` 管理员只删除直接回复，孙回复可能使 FK 删除失败。`worker/account.ts:892-910` 删除账户时删用户产生的评论/点赞，却没有修正其它帖子的 counter。
- **触发**：双击点赞/评论、两个标签页同时操作、跨帖 parent_id、嵌套回复、删账户。
- **影响**：500、计数与真实行数不一致、孤儿/深层评论无法删除、后续列表和排序结果不可信。
- **修复方向**：把 Plaza 写操作收敛到 D1 repository Module：单条条件 SQL 或 batch 事务，使用 changes 驱动计数；数据库约束 parent 的同 post/深度（可用触发器或限制一层回复），并增加 `ON DELETE CASCADE` 或显式递归清理；提供定期 counter rebuild 校验任务。
- **成本**：高（5–8 人日，需 migration）。
- **验证**：并发测试 + 计数重算；插入跨帖 parent；多层回复删除；删账户后核对所有受影响 post 的 count。

### PLAZA-02：帖子形状、布尔值和请求体校验不一致

- **类型**：确定性输入校验缺陷。
- **证据**：`worker/plaza.ts:187-197,286-295` 对 JSON `null` 没有对象检查，访问 `body.post_type` 可抛异常；`worker/plaza.ts:217-218,304-305,684` 用 truthiness，把字符串 `"false"`/`"0"` 当 true；`worker/plaza.ts:270-345` 允许 PUT 修改 `post_type/kind`，改类型而不提供 items 会留下不兼容 JSON；评论在 `505-541` 没有和通用 body 相同的实际字节上限。`worker/plaza.ts:49-54` 的 page/limit 可接受 `Infinity`。
- **触发**：发送 `null`、字符串布尔值、只改 post_type、或 chunked/缺失 Content-Length 的大评论。
- **影响**：500、可见性被错误修改、旧数据形状损坏、D1 查询异常/资源消耗。
- **修复方向**：统一 `readJsonObject` + schema validator；只接受 `true/false/0/1`；固定 `post_type` 为不可变字段或要求同事务验证新 items；所有 body 读取后以实际 UTF-8 字节数限制；分页只接受有限正整数。
- **成本**：中（2–4 人日）。
- **验证**：null/array/string boolean/Infinity/chunked body/跨类型编辑的 Worker 请求测试；检查错误码恒为 4xx 而非 500。

### OPS-01：外部响应体和路由级上游预算不完整

- **类型**：静态资源/可用性风险。
- **证据**：`worker/media.ts:249-287,1902-1948` 的 upstream/detail `fetch` 跟随 redirect 并直接 `text()`；`worker/ai.ts:632-640,769-777` 直接 `json()`；`worker/mailer.ts:56-64,106-112` 直接 `text()`，没有统一 abort/字节上限。`worker/index.ts:1855-1914` 的 Douban top/suggest 和 `1916-1946` 的单条 `/api/posters` 没有 route-level limiter，而批量海报 `1948-1950` 才有。
- **触发**：恶意/异常上游返回超大 body、慢响应；大量唯一 query 造成 cache miss。
- **影响**：Worker 内存/CPU/出站额度被单请求或恶意请求耗尽，外部服务被放大查询。
- **修复方向**：抽象一个 bounded upstream fetch Module，统一 timeout、redirect、content-type、最大字节、重试分类；所有会触发外部请求的 route 统一走对应限流 bucket；图片只允许明确 MIME 并限制响应体。
- **成本**：中到高（4–7 人日）。
- **验证**：mock 慢 body、超大 body、3xx、错误 MIME；并发压测单条/批量海报和详情；确认达到预算后稳定返回 429/502。

### OPS-02：两级限流不是原子计数，缺少 IP 时所有请求共用 anonymous

- **类型**：并发静态风险。
- **证据**：`worker/index.ts:173-232` 先读 Edge Cache、再写 Cache；两个 isolate 可同时读到同一个 count 并都放行。`worker/index.ts:197-198` 只取 `cf-connecting-ip`，缺失时统一为 `anonymous`。`worker/rateWindow.ts:54-62` 的 5000 条淘汰还会提前放宽旧窗口。
- **触发**：并发请求、预views/本地无 CF header、攻击者制造大量不同 key。
- **影响**：实际预算大于声明值，匿名环境出现互相限流或绕过。
- **修复方向**：对安全敏感 bucket 使用 Cloudflare 原生 rate limiting/Durable Object 等原子计数；key 使用可信平台 header，缺失时采用明确策略；为统计、账号、posters 分开预算。
- **成本**：中到高（3–6 人日，取决于绑定）。
- **验证**：并行 100 请求断言最多 limit 个成功；无 CF header 的测试环境行为固定；故障时安全策略 fail-closed 或有监控。

### OPS-03：管理登录、公共统计和高成本读取缺少专用预算

- **类型**：确定性资源风险。
- **证据**：`worker/index.ts:1708-1710` 的 `/api/admin/login` 没有调用 `allowUpstreamRequest`，会在 PBKDF2/legacy hash 前被反复触发；`worker/index.ts:1683-1685` 的 `/api/stats` 公共且无 limiter，`getStats:1128-1147` 每次扫描 analytics_events。`worker/index.ts:1855-1946` 的单海报/榜单查询也没有统一预算。
- **影响**：密码验证 CPU 消耗、统计查询 D1 成本和公共上游额度被反复诱导。
- **修复方向**：管理登录独立低限额+失败退避/告警；统计改为定时预聚合或短 TTL 缓存并限流；所有外部查询统一 bucket。
- **成本**：中（2–4 人日）。
- **验证**：连续错误登录/统计请求被 429；统计压测下 D1 查询数和响应延迟在预算内。

### OPS-04：错误、分享 JSON、URI 和 CSV 边界处理不统一

- **类型**：确定性健壮性/输出安全问题。
- **证据**：`worker/index.ts:2882-2895` 对分享 `row.profile` 直接 `JSON.parse`；`2911-2913` 的 `decodeURIComponent` 没有局部捕获；`2960-2969` 对非 HttpError 把 `err.message` 放进 500 响应；`worker/index.ts:1823-1845` CSV 只 quote，不中和 `= + - @`，`days` 也没有有限整数范围。
- **触发**：旧/损坏分享行、畸形 URL 编码、触发内部异常、管理员导出含公式的标题。
- **影响**：可预期请求变成 500、错误细节泄露、Excel 公式注入、异常参数放大查询。
- **修复方向**：所有持久 JSON 读取使用统一 decoder，损坏行返回可观测的 4xx/空数据；错误响应只返回稳定错误码+trace id；CSV 单元格对危险前缀加单引号并限制 days=1..365。
- **成本**：小到中（1–3 人日）。
- **验证**：注入 null/坏 JSON/坏 percent encoding/CSV 标题 `=HYPERLINK(...)` 的测试。

## 5. P2：性能、体验和交付质量建议

### PERF-01：PNG 导出的图片并发和 Canvas 内存没有硬预算

- **证据**：`src/lib/exportPng.ts:154-214` 最多对 80 个条目并发请求海报；每个条目可保留 4 个 URL，随后 `215-221` 用 `Promise.all` 加载最多约 320 张图片。`loadImage:88-96` 没有 timeout/cancel；`239-242` 创建 2x Canvas，240 条目和长榜单可能造成很高像素面积。
- **触发**：大榜单、慢 CDN、移动设备或多次导出。
- **影响**：主线程卡顿、网络连接耗尽、`canvas` allocation 失败或标签页崩溃。
- **修复方向**：有界 worker pool（例如 4–8 并发）、统一 AbortController/超时、ImageBitmap 或 object URL 释放；导出前按 `W*H*scale²` 预算并自动降分辨率/条目数；保留文字 fallback。
- **成本**：中（2–4 人日）。
- **验证**：用 80 个延迟图片 mock 验证并发上限、超时和取消；在低内存移动模拟环境导出 240 条目。

### PERF-02：海报缓存的限流分类、singleflight 和缓存键有优化空间

- **证据**：`worker/media.ts:1196-1243` 的 `searchCover` 明确抛出 `ThrottledError`，但 catch 又 `return undefined`，调用方无法区分瞬时限流和永久缺失；`worker/media.ts:1444-1475` 没有跨请求 in-flight singleflight；`985-1023` 的 intro cache key 只有 type+title，遗漏 creator/year；`186-209,249-287` 的 domain map 没有完整生命周期清扫。
- **触发**：同一海报被多个标签页同时请求、同名不同年份作品、长期运行的高基数 domain。
- **影响**：上游被重复请求、限流结果被错误缓存 24 小时、同名作品简介串缓存、isolate 内存增长。
- **修复方向**：让 `ThrottledError` 穿透到 outcome；加入按 key 的 singleflight；缓存键纳入 creator/year；所有 isolate map 采用 TTL+上界清扫。批量接口的限流和类型白名单可作为单条接口的参考实现。
- **成本**：中（3–5 人日）。
- **验证**：并行同 key 只触发一次上游；限流响应只短暂负缓存；同名不同年份不共享 intro；高基数 key 内存有界。

### FRONT-01：异步视图存在 stale response 和依赖缺口

- **证据**：当前 lint 的 25 个 warning 中，PlazaView `src/views/PlazaView.tsx:54-56,126-139`、PlazaPostView `src/views/PlazaPostView.tsx:80-82`、SourceView 多处 effect 都提示缺失依赖。Plaza list/load、QR 轮询、换码和 playlist/status 请求没有统一取消或 request generation；`src/views/PlazaPostView.tsx:110-126` 点赞未检查 `response.ok`。
- **触发**：快速切换筛选/搜索/账户、关闭弹窗、重复点击、网络慢响应。
- **影响**：旧结果覆盖新结果、loading 状态错乱、错误 HTTP 被当作成功并错误增减计数。
- **修复方向**：抽取统一 async resource coordinator：AbortController + sequence/version + 明确 loading/error/finally 状态；所有成功分支先检查 `response.ok` 和 payload schema。
- **成本**：中（3–5 人日）。
- **验证**：延迟/乱序 fetch mock、账户切换、重复点赞和组件卸载测试；最终 lint warning 清零并加浏览器测试。

### FRONT-02：分享隐私、清除数据范围和路由边界需要产品化

- **证据**：`src/App.tsx:894-906,951-975` 生成单榜单分享时仍发送整个 `notes`；`src/App.tsx:629-645` 的“清除本地数据”不清 AI config、偏好、Plaza link 等；`src/lib/useRouter.ts:18-23` 用 `startsWith("/share")`，`/shared`、`/sharefoo` 会被当作分享页；`src/views/SortingView.tsx:99-102` 对 `worksById.get(...)!` 假定持久化数据一定完整。
- **触发**：分享单个榜单；共享设备清除数据；访问相似路径；旧草稿缺少作品 ID。
- **影响**：批注意外泄露、用户误以为所有隐私已清除、错误页面/渲染崩溃。
- **修复方向**：单榜分享默认不带 notes，批注按明确 opt-in；拆分“清除画像”“清除偏好”“清除 AI 凭证”；路由使用精确正则；恢复排序前交叉校验 `sourceIds` 与 works 集合，缺失时安全回到可恢复页面。
- **成本**：小到中（2–3 人日）。
- **验证**：分享 payload 快照测试、清除后逐项检查 localStorage、路径表测试、损坏草稿测试。

### DELIVERY-01：依赖审计和 Node 版本不匹配

- **证据**：`package-lock.json:6425-6448` 的 Wrangler 4.129.0 要求 Node `>=22`；`.github/workflows/ci.yml:13-15` 使用 Node 20；`README.md:197-200` 却写 Node `>=18`。新鲜 `npm audit` 报 1 critical、4 high、3 moderate，修复建议包含 Vitest 5/Vite 更新；`npm audit --omit=dev` 为 0，说明主要是开发/部署工具链暴露面，不是当前生产依赖的直接漏洞。
- **影响**：CI 与本地/部署运行时不一致；开发服务器和 Wrangler 暴露已知漏洞；部署排障困难。
- **修复方向**：统一 `.nvmrc`/`engines`/CI 为 Node 22 或更高；分批升级 Vitest/Vite/Wrangler，升级后重新锁文件；在 CI 增加 audit、dev server 不对公网暴露的检查。
- **成本**：中（1–3 人日，可能有 breaking changes）。
- **验证**：干净 Node 22 环境 `npm ci`、全门禁、Wrangler 本地迁移和 dry-run；生产依赖与开发依赖分别审计。

### DELIVERY-02：Service Worker 会长期保留旧构建资源

- **证据**：`public/sw.js:1,13-20,46-59` 使用固定 `art-rank-v2`；非导航同源资源 cache-first，历史 hashed asset 没有版本清理；`38,54` 的异步 `cache.put` 没有 `event.waitUntil`，Worker 可能在写入前终止；`src/main.tsx:24-28` 只排除 localhost/127.0.0.1，LAN/preview 非生产环境仍注册 SW。
- **影响**：旧资源驻留、离线回退内容不一致、非生产开发被旧缓存干扰。
- **修复方向**：缓存名带 build hash；activate 清理同源旧版本；用 `waitUntil` 包住 put；对 hashed assets immutable、对 manifest/favicon 使用 network-first/短 TTL；只在 `import.meta.env.PROD` 注册。
- **成本**：小到中（1–3 人日）。
- **验证**：两次构建/激活后检查 Cache Storage；断网首屏；LAN preview 确认不注册；更新资源不会继续命中旧版本。

### DELIVERY-03：测试、lint 和迁移交付门禁不足

- **证据**：`vitest.config.ts:3-7` 只有 Node 环境和三类纯 `.test.ts`；`eslint.config.js:19-36` 排除 `gd-proxy/**`；`tsconfig.node.json:10-12` 不包含 scripts/gd-proxy；`package.json:17` 的 deploy 直接执行 build、远端迁移、deploy；`.github/workflows/ci.yml:17-22` 没有 D1 migration dry-run、Worker 集成、浏览器 E2E、coverage 或依赖审计。
- **影响**：异步/数据库/部署问题只能上线后暴露；`migrations/0017_poster_errors_source.sql:1-5` 明确要求旧环境手工 ALTER，远端迁移并非真正可重复。
- **修复方向**：增加 Miniflare/Workers 集成测试、D1 schema/并发测试、React 浏览器 smoke/E2E、迁移本地演练和部署 dry-run；给 gd-proxy 独立 Deno typecheck/lint；把 deploy 拆为 check、backup、migrate、deploy 四步。
- **成本**：高（5–10 人日，取决于测试基础设施）。
- **验证**：在 CI 中从干净 checkout 应用 migration 两次、启动本地 Worker、跑关键认证/分享/广场/图片流程；失败时不让 deploy 继续。

### DOC-01：文档与实际代码存在多处漂移

- **证据**：`docs/ARCHITECTURE.md:373-400` 写 23 个 migration/0022，实际为 24 个/0023；`docs/ARCHITECTURE.md:560-570` 写 18 个测试文件、273 passed；`README.md:193,197-200,246-250` 的测试、Node 和 migration 说明已过时；`docs/API.md:1248-1257` 引用不存在的 `scripts/mail_sender.py`，实际实现为 `worker/mailer.ts`，且把生产 fail-open 写成开发行为；`docs/CLOUDFLARE.md:66` 写 PBKDF2 60 万次，`worker/account.ts:32-85` 实际常量是 100,000，注释也有 100k/600k 混用。
- **影响**：部署者使用错误 Node/迁移流程，安全人员误判密码成本，新维护者按不存在的脚本排障。
- **修复方向**：建立文档 CI 检查：统计 migration/test、校验文档引用文件存在、README 环境版本从单一 `.nvmrc` 读取；同步更新 API/安全说明和归档文档索引。
- **成本**：小到中（1–3 人日）。
- **验证**：在 CI 运行引用扫描和统计断言；人工 review 文档与代码的版本/限制口径。

### A11Y-01：焦点恢复和交互语义仍有可访问性缺口

- **证据**：`src/components/FocusTrap.tsx:3-49` 打开时聚焦第一个元素，但关闭时没有恢复到触发元素；`src/components/ExpandableNote.tsx:16-35` 使用 `<p role="button">` 而非原生 button。
- **影响**：键盘/屏幕阅读器用户在弹窗关闭后失去位置，非原生控件的 Enter/Space/焦点行为依赖手写逻辑。
- **修复方向**：FocusTrap 记录 `document.activeElement` 并在 cleanup 恢复；ExpandableNote 改为 button，保留文本样式和事件；增加 axe/键盘回归。
- **成本**：小（0.5–1 人日）。
- **验证**：键盘打开/关闭 modal、Tab/Shift+Tab、屏幕阅读器语义测试。

### TOOL-01：本地工具的边界和路径安全不足

- **证据**：`scripts/ui-shot.mjs:44,91-92,136` 将 manifest `name` 直接拼入输出文件；`scripts/ui-shot.mjs:97-102` 的静态服务器对 URL pathname 缺少 containment；`scripts/ui-diff.mjs:192-210` 目录模式只遍历 A，缺失 B 不会报错且 diff 不会设置非零退出码；`scripts/ai-mock-server.mjs:19-22,40-44,108` CORS `*`、默认全接口监听、body 无上限。
- **影响**：恶意/错误 manifest 可写出输出目录外文件；视觉回归可能误报通过；开发 mock 可被局域网滥用或内存耗尽。
- **修复方向**：所有输出路径 `resolve` 后验证在根目录内；UI diff 检查目录双边并以 mismatch 非零退出；mock 绑定 `127.0.0.1`、限制 body/速率、不要在生产运行。
- **成本**：小（1–2 人日）。
- **验证**：`../`、缺失 B、超过限制 body、超大并发请求的脚本测试。

### MEM-01：session token、OTP、admin token 的存储与可观测性需要分层

- **类型**：可选安全加固；当前不是已证明的直接 XSS 漏洞。
- **证据**：`src/lib/useAuth.ts:48` 将 bearer token 放 localStorage；`worker/account.ts:162-173` 和 `worker/index.ts:1372-1379` 将 session/admin token 明文写入 D1；`migrations/0015_oauth_exchange.sql:4` 明文存 OAuth exchange token；`worker/index.ts:2935,2974-2991` 将 `/api/admin/**` 排除在普通 API 日志之外。
- **触发**：浏览器同源 XSS、数据库读取权限扩大、日志/备份泄露。
- **影响**：token 可直接冒用，管理员危险操作缺少统一审计可见性。
- **修复方向**：优先 HttpOnly/Secure/SameSite cookie + CSRF 方案，或至少只存 token hash；敏感表字段加密/哈希；admin login/reset/删除加入受控审计事件（不记录 token/OTP）。
- **成本**：高（涉及前端会话迁移和 API 合约）。
- **验证**：XSS 模拟、token 轮换/撤销、审计字段和敏感日志扫描。

## 6. 架构深化机会（可选，不以文件行数为目标）

这些不是要求立刻拆文件，而是寻找能把复杂度集中、提供更大 **Leverage** 和 **Locality** 的 **Module / Interface / Implementation / Depth / Seam / Adapter** 机会。

### ARCH-01：认证与云同步 Module

- **Module**：`AccountSession` / `ProfileSync`，而不是把 hydrate、notes、自动同步、冲突、登出散落在 `useAuth` 和 `App`。
- **Interface**：应只暴露 `hydrate(session)`、`applyLocalChange()`、`sync()`、`resolveConflict()`、`logout(strategy)`，并声明 revision、pending、error 和取消语义。
- **Implementation**：当前逻辑在 `src/lib/useAuth.ts:68-464`、`src/App.tsx:1509-1525`；账号登录、云端 API、localStorage 各自承担部分责任。
- **Depth**：把“等待远端版本、合并 notes、重试、网络恢复、账户切换隔离、登出策略”隐藏在少量接口后，调用者只表达意图。
- **Seam**：会话 token/session version；UI 不应直接拼 profile/notes PUT。
- **Adapter**：`CloudProfileAdapter`（HTTP）、`LocalProfileAdapter`（localStorage）、测试用的延迟/失败 Adapter。
- **Leverage**：一键修复本次发现的清空批注、stale response、logout data loss、冲突不合并 notes。
- **Locality**：认证时序、隐私和同步测试集中在一个 Module，App 不再承载 2496 行的全局副作用。

### ARCH-02：排序文档与持久化 Module

- **Module**：`RankingDocument` codec + ranking transition。
- **Interface**：`create/transition/undo/serialize/deserialize/projectToProfile`，并明确 ID、identity、rank、估算值和版本迁移规则。
- **Implementation**：当前 `ranking.ts`、`useSorting.ts`、`profile.ts`、`shared/storedItem.ts` 各自维护一部分不变量。
- **Depth**：把快照校验、兼容迁移、作品查找和结果投影放在一个小接口后，算法调用者无需知道 localStorage/画像细节。
- **Seam**：排序状态持久化格式；旧 v1/v2 快照迁移可作为 Adapter。
- **Adapter**：`localStorage` 草稿、cloud profile、导入 JSON。
- **Leverage**：quick 撤销 bug、重复 ID、重排丢项、草稿损坏渲染会共享同一验证路径。
- **Locality**：排序不变量、回归测试和迁移说明集中，减少跨文件口径漂移。

### ARCH-03：受限上游请求 Module

- **Module**：`BoundedUpstreamFetch`。
- **Interface**：输入 URL policy、协议、headers、body、timeout、maxBytes、redirect policy，输出受限响应/typed error。
- **Implementation**：media、AI、mailer、import、GD proxy 目前各自写 `fetch`、重试和解析，安全规则重复但不完全一致。
- **Depth**：一次实现 SSRF/redirect/MIME/大小/计时器清理，调用者只选择“搜索/详情/图片/邮件”等策略。
- **Seam**：Worker outbound fetch 前；测试用 fake fetch Adapter。
- **Adapter**：Douban/百科/Resend/AI API/GD proxy 各自的 host 和 body 限制。
- **Leverage**：覆盖 SEC-01、SEC-02、上游资源耗尽和图片 SSRF 风险。
- **Locality**：安全审查只需审一个 Module；每个外部服务的特殊规则以配置/Adapter 表达，而不是散落在路由中。

### ARCH-04：Plaza 领域写入 Module

- **Module**：`PlazaRepository`。
- **Interface**：`createPost/editPost/toggleLike/addComment/deleteComment`，返回领域结果和计数。
- **Implementation**：当前 `worker/plaza.ts` 混合 HTTP 解析、D1 SQL、状态机和计数更新；`migrations` 只提供部分约束。
- **Depth**：把同帖 parent、一次性消费、计数一致性、可见性布尔和 post_type 不变量封装在 Interface 后。
- **Seam**：D1 `batch/prepare` 前；用内存 fake repository 测竞态前先定义语义。
- **Adapter**：D1 Adapter、migration fixture、未来 KV/关系存储 Adapter。
- **Leverage**：点赞/评论/删除/账户删除共享一致性逻辑，前端不必猜测 counter。
- **Locality**：完整性 bug 和并发测试可在一个 Module 完成，避免每个路由各自修补。

## 7. 推荐实施顺序与验收门槛

### 第一阶段：先控风险（上线前）

1. 暂时关闭/限制用户可控 detail URL 和自定义 AI model-list 入口，或先加入严格 host/redirect 策略。
2. 让 mailer 在生产缺配置时 fail-closed；确认 `COOKIE_ENC_KEY`、AI key、admin password 等生产 secret 已显式配置。
3. QR 事务增加 owner binding；OAuth/验证码改为一次性条件消费；暂停未审计的旧 share JSON 行。
4. 依赖升级前确认 Node 22+；不要把 `npm audit` 的开发工具漏洞误报成生产依赖漏洞，但也不要继续使用已知有 critical advisory 的 Vitest UI 路径。

### 第二阶段：保证数据正确性

1. 修复 ranking snapshot、profile identity/ID/reorder、notes 清空和 merge caps。
2. 引入 session hydrate gate、request generation 和明确的 logout/pending 策略。
3. 为 Plaza 建 repository/事务和 migration 约束，修复 parent/counter/delete。
4. 把所有 route 的实际 body、JSON 形状、布尔/枚举/分页参数统一到 schema 校验。

### 第三阶段：资源和用户体验

1. 统一 bounded upstream fetch、所有上游 route budget 和原子 rate limit。
2. PNG 有界并发/像素预算；海报 singleflight、cache key、限流 outcome 和内存清理。
3. 前端 async coordinator、分享 notes opt-in、清除数据范围、Service Worker 缓存版本化。
4. 补 D1/Worker/browser/E2E 测试、gd-proxy 门禁、迁移演练和 CI audit。

### 每次合并的最低验收

```text
npm run check
npm run lint
npm run format:check
npm test -- --run
npm run build
npm audit --package-lock-only --registry=https://registry.npmjs.org
```

另外必须运行本地 D1 migration 两次、关键 Worker route 的集成测试，以及浏览器 smoke：登录/恢复/退出、quick 排序撤销/草稿、批注删除、分享、QR 轮询、Plaza 点赞/评论。只有这些场景都通过，才可以把“测试全绿”当作发布依据。

## 8. 审阅限制

- 没有在本次会话中连接生产 D1、Cloudflare Workers、OAuth provider、邮件服务或真实浏览器；网络策略、provider 响应和 D1 并发行为需在 staging 复现。
- `npm audit` 是锁文件在官方 registry 的静态结果；生产依赖 `--omit=dev` 当前为 0，但开发服务器/部署工具仍有风险。
- 没有改业务代码，因此本报告的“修复方向”和成本是实施建议，不是已完成的变更。

## 9. 实施状态（2026-09-25 · 分支 `feature/p0-p1-hardening` · 已部署）

> 本节由实施阶段补写。每条记录状态、落点文件与验证方式。远端迁移与部署均 exit 0；
> 生产 Worker 版本 `57b8d4d0-e0dd-423d-ad28-e140834df189`（回滚目标 `a7ad81c5`）。

### P0：全部修复

- **SEC-01 已修复**：`worker/outbound.ts`（新增：精确 host 白名单、manual redirect 逐跳复核、超时、字节上限流式读取）+ `worker/media.ts`（`includes()` 子串校验改为精确 host + `/subject/<纯数字>` 路径校验，详情抓取走 `fetchBounded`）。验证：`npm test -- --run worker/outbound.test.ts`（16 用例）；生产复验：`evil.example` 详情样例未触达未授权 host。
- **SEC-02 已修复（DNS 限制按设计保留）**：`worker/ai.ts`（模型名按单个 path segment 编码、模型列表改走 `fetchBounded` 与生成请求共享策略、响应限幅 1 MiB）+ `ai.test.ts` 新增含 `/` 模型名与 302 跳转用例。字面 IP/localhost/`.internal`/metadata 拒绝保留；**DNS 解析后指向私网的残余风险为已知限制**（设计文档 §1 非目标）。
- **SEC-03 已修复**：`migrations/0024_qr_transactions.sql` + `worker/qrTransactions.ts`（登记/owner 查询/条件一次性消费/过期清理）+ `worker/index.ts`（签发登记、轮询先验 owner，缺失/过期/他人 key 返回 `qr_expired_or_invalid`）+ `worker/douban.ts`（QR 图仅允许 doubanio 图床、image-only MIME、256 KiB 上限）。验证：`npm test -- --run worker/qrTransactions.test.ts`（真 SQLite 语义）+ 本地 D1 演练（FK 强制、owner 命中、`changes=1`）。
- **SEC-04 已修复**：`worker/mailer.ts`（生产缺配置 fail-closed 返回 `mailer_unconfigured`；开发兜底需显式 `ENVIRONMENT=development|test`，日志不再含邮箱/验证码；上游响应限幅）。本地取码改走 send-code 响应的 `dev_code`（生产不可达）。验证：`npm test -- --run worker/mailer.test.ts`。

### P1：全部修复（token 静态哈希一项按设计延后）

- **DATA-01 已修复**：`src/lib/ranking.ts` quick 估算创建时 `Math.ceil`；反序列化对旧版有限小数归一。验证：`npm test -- --run src/lib/ranking.test.ts`（quick round-trip + 旧快照归一）。
- **DATA-02 已修复**：`src/lib/profile.ts`（ID 上限对齐 storedItem 的 200、显式 ID 冲突确定性去重、`reorderRanking` 要求集合完全相等、`mergeProfiles` 20 榜单上限）。验证：`npm test -- --run src/lib/profile.test.ts`。
- **DATA-03 已修复**：`worker/account.ts`（`Object.hasOwn` 区分"未提供=保留"与"显式 `{}`=清空"）+ `src/lib/profileSync.ts`（新）+ `useAuth`/`App.tsx`（同步/保存/登出 PUT 始终携带批注映射，冲突合并同请求提交合并后批注）。验证：`npm test -- --run src/lib/profileSync.test.ts`。
- **DATA-04 已修复（核心）**：`useAuth` 水合门（云端恢复完成前不自动 PUT）、会话代际校验、AbortController、登出先中止/清定时器再清本地；登录/OAuth/刷新统一走 token 驱动的水合 effect。完整 revision 向量冲突协议仍属后续。
- **DATA-05 已修复**：`worker/verification.ts`（新：条件 DELETE 消费验证码、OAuth exchange 一次性独占、Google `email_verified === true` 严格解析）+ `worker/account.ts`（签发 batch 化、注册/改密先变更后消费 + 失败补偿、回调清除 oauth_state cookie）。验证：`npm test -- --run worker/verification.test.ts`。**token/OTP 静态哈希延后**——需重建表迁移，本阶段明确不做。
- **PLAZA-01 已修复**：`worker/plaza.ts`（点赞 `INSERT OR IGNORE`/条件 DELETE + changes 驱动计数、评论删除递归整棵子树并按剩余行数重算计数）+ `worker/account.ts`（删账户后受影响帖子计数重算）。验证：`npm test -- --run worker/plazaIntegrity.test.ts`。
- **PLAZA-02 已修复**：`worker/plaza.ts`（共享 body 对象解析、可见性只收 true/false/0/1、分页非有限数回落、`post_type` 不可变、评论体字节上限）。

### P2：部分触及，其余按计划未动

- **OPS-01 部分修复**：详情/AI/邮件/豆瓣 QR 与账户接口已限幅；海报 searchCover、网易云 weapi、维基百科等上游与路由级预算仍开放。
- **DELIVERY-01 部分修复**：Node 22 统一（CI `node-version: 22`、`engines`、`.nvmrc`）；依赖升级未做。
- **DOC-01 部分修复**：mailer 语义、PBKDF2 实际 10 万次、迁移数 25、`scripts/mail_sender.py` 失效引用已同步；文档 CI 校验未建。
- **FRONT-01 部分修复**：useAuth 层异步已代际化；Plaza/Source 等 view 层 stale-response 仍开放。
- **OPS-02 / OPS-03 / OPS-04 / PERF-01 / PERF-02 / FRONT-02 / DELIVERY-02 / DELIVERY-03 / A11Y-01 / TOOL-01 / MEM-01 未动**（限流原子性需 Durable Object/原生限额；Service Worker 版本化；PNG 预算；分享 notes opt-in；CI 集成测试门禁等）。
- **ARCH-01..04 部分落地**：`outbound.ts`（ARCH-03 Seam）、`qrTransactions.ts`、`verification.ts` 作为小型 Module 引入；大规模重构按计划不做。

### 部署与复验证据（2026-09-25）

- 远端迁移 `0024`/`0025`：exit 0；二次 apply 显示 "No migrations to apply"（可重复）。
- 部署：`npx wrangler deploy` exit 0 → Version `57b8d4d0-e0dd-423d-ad28-e140834df189`。
- `GET /`：200，CSP/COOP/Permissions-Policy 头在位；`GET /api/health`：200 `{"ok":true,...,"database":"ok"}`。
- SSRF 样例（`evil.example/book.douban.com/subject/123`）：未触达未授权 host（响应来自白名单内 GD 兜底，属既有行为）；CSV 注入形状的 `/api/posters` 请求 400。
- 浏览器 smoke：标题 `ART/RANK · 我的艺术人格`，无 console error，无网络失败。
- 质量门禁：check/format/build exit 0；lint exit 0（25 条 warnings 全部为存量）；测试 359 passed / 9 skipped（原 303 基线全保留，新增 56）；audit 生产依赖 0 漏洞、开发依赖 exit 1（如实记录，非生产暴露面）。

### 残余限制（诚实清单）

1. DNS rebinding 无法在 Workers 应用层彻底解决（需平台能力，设计文档已声明）。
2. token/OAuth exchange/OTP 仍明文列存储（MEM-01），哈希化需重建表迁移。
3. 限流仍为 Cache API 读改写（非原子），缺 IP 时共用 `anonymous`（OPS-02）。
4. `/api/admin/login`、`/api/stats` 仍无专用预算（OPS-03）；CSV 公式注入未中和（OPS-04）。
5. 生产的 mailer fail-closed 分支仅在"双通道全未配置"时可达——生产已配置 Resend，无法在不发真实邮件的前提下从外部验证，依据为单元测试。
