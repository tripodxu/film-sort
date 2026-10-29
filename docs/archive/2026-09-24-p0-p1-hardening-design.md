# P0/P1 安全、数据完整性与生产验证设计

日期：2026-09-24  
状态：已获用户批准，待实施  
范围：当前仓库 `film-sort3`；先修复 P0/P1，再通过本机代理 `127.0.0.1:10081` 部署并复验 `https://sort.logicc.top/`。

## 1. 目标与非目标

### 目标

- 阻断详情 URL 和 AI endpoint 的 SSRF/redirect 风险，统一外部响应预算。
- 让 QR 登录凭证、OAuth exchange、验证码和 Plaza 写入具备明确的所有权与一次性语义。
- 修复 quick 排序快照、画像身份/重排/批注清空、认证同步竞态等确定性正确性问题。
- 为每次修改提供先失败后通过的回归测试，并在部署前完成本地门禁和 D1 migration 演练。

### 非目标

- 本阶段不做 `App.tsx` 大规模拆分、PNG 渲染器重构、Durable Object 迁移或完整 PWA 图标体系；这些保留为后续 P2。
- 不删除现有生产数据，不执行不可逆的表重建；所有 migration 必须向后兼容旧 Worker/旧数据。
- 不把无法在当前 Workers 运行时可靠实现的 DNS 私网解析宣称为完全解决；本阶段对字面 IP、协议、端口、重定向和最终 host 做严格限制，并在报告中保留 DNS 限制说明。

## 2. 方案与取舍

采用“分批、可回滚、每批可验证”的方案：

1. **安全批次**：先写失败测试，再实现统一 URL/redirect/body policy，修复详情、AI、mailer 和 QR owner binding。
2. **数据正确性批次**：修复 ranking/profile/notes/auth sync，补充画像和同步回归测试。
3. **服务端完整性批次**：验证/修正 OAuth、验证码和 Plaza 写入；采用条件更新、批量事务或可证明的 changes 语义，新增兼容 migration。
4. **发布批次**：全量门禁 → 本地 D1 migration 两次 → 通过 `127.0.0.1:10081` 代理执行远端 migration/deploy → 真实 HTTPS 复验。

不采用只改字符串校验的方案，因为当前缺陷涉及跨文件状态、并发和外部响应；也不在本阶段引入新的 Durable Object binding，以免把安全修复与部署拓扑变化混在一起。

## 3. 设计与文件落点

### 3.1 Outbound policy

新增 `worker/outbound.ts`，提供小型 Interface：

- `parseAllowedUrl(value, policy)`：协议、精确 host、端口、路径和可选 subject 校验。
- `fetchBounded(input, policy)`：timeout、manual redirect、每跳 host 校验、MIME 和最大响应字节。
- `readBoundedText/Json`：将流式读取限制在 policy 上限内。

`worker/media.ts`、`worker/ai.ts`、`worker/mailer.ts` 通过该 Seam 使用策略；不改业务返回结构。详情 URL 不再使用 `includes()` 判定 host，AI model 名按 path segment 编码，模型列表与生成请求共享 redirect/body 规则。`worker/mailer.ts` 在生产未配置通道时返回失败，不写 OTP；开发兜底由显式环境开关控制。

### 3.2 QR owner binding

修改 `worker/netease.ts`、`worker/douban.ts` 和 `worker/index.ts` 的 issue/poll 调用：

- issue 在已有认证上下文中登记 `key → owner_user_id`、provider、TTL；必要时新增 `qr_transactions` D1 表。
- poll 先校验 key 的 owner、TTL 和一次性状态，再使用当前 `userId` 写 Cookie；不匹配时返回稳定错误，不消费事务。
- isolate 内 Cookie jar 继续作为短期凭证缓存；若 durable owner 不匹配或 jar 缺失则 fail-closed。
- 成功、过期、风险和显式断开都清理事务；不得把上游 Cookie 写入日志。

### 3.3 Ranking/profile/sync

- `src/lib/ranking.ts`：quick 估算在状态创建前取整，保证快照合法值域；保留旧快照兼容读取。
- `src/lib/profile.ts`：统一 ID 最大长度、显式 ID 唯一性、identity 去重、重排集合完全相等和 merge 数量/字节上限。
- `src/lib/useAuth.ts`：增加 hydration gate；云端恢复完成前不自动 PUT；异步操作带 generation/AbortController；明确 logout 对 pending sync 的策略。
- `worker/account.ts` / `shared/storedItem.ts`：用字段是否出现区分“未修改”和“显式空对象”，让 `{}` 能清空 notes；冲突合并同时保留 profile/notes。

### 3.4 OAuth/verification/Plaza

- `worker/account.ts`：Google 必须 `email_verified === true`；OAuth exchange 和验证码消费使用条件删除/更新并检查 `meta.changes`；失败时不丢验证码；避免并发重放。
- `worker/plaza.ts`：统一对象/枚举/布尔/分页校验；禁止 null/字符串 truthiness；固定或严格验证 `post_type`；parent 必须属于同 post；点赞/评论/计数使用条件写入或 D1 batch，并处理嵌套删除。
- 新 migration 只添加索引、唯一约束或兼容列/表；先在本地 D1 连续应用两次，确认旧数据可读取后再远端应用。

### 3.5 发布和回滚

- 使用 `HTTPS_PROXY`/`CURL_PROXY=http://127.0.0.1:10081` 访问 Wrangler 和生产 URL；不把代理配置写入仓库。
- 远端顺序：备份/确认当前 Worker 版本 → migration → deploy → 健康/静态资源/API 复验。
- 任何 migration 或 smoke 失败即停止，不继续 deploy；代码回滚使用上一 Worker 版本，若 migration 已应用则保持向后兼容而不执行破坏性回滚。

## 4. 测试策略

每个行为先增加最小失败测试并运行确认失败，再实现：

- ranking 序列化/撤销/草稿旧快照。
- URL host/redirect/IP/超大 body；AI 模型名；mailer 未配置。
- QR owner mismatch、重复 poll、过期。
- profile 重复 ID、重排集合、merge cap、notes clear。
- auth hydration/账户切换/pending sync。
- OAuth/验证码并发消费；Plaza null/boolean/parent/counter/删除。

本地验证顺序：

```text
npm run check
npm run lint
npm run format:check
npm test -- --run
npm run build
npm audit --package-lock-only --registry=https://registry.npmjs.org
npm audit --package-lock-only --omit=dev --registry=https://registry.npmjs.org
```

真实远端复验至少包含：`/`, `/api/health`, `/api/posters` 的安全拒绝样例、静态资源响应头、一个不需要账号的公开 API，以及 HTTPS 重定向/缓存行为；不在生产执行破坏性 POST/DELETE。

## 5. 成功标准

- P0 安全路径的失败测试在实现前失败、实现后通过。
- 现有 303 passed / 9 skipped 基线不减少，新增测试通过。
- TypeScript、lint、format、build 全部通过；audit 的生产依赖结果明确记录。
- 远端 migration 可重复执行，Worker 部署成功，`https://sort.logicc.top/` 返回预期页面和健康 API。
- 交付报告更新为“已验证的修复/仍未解决的限制”，不把静态缓解误称为完整安全保证。
