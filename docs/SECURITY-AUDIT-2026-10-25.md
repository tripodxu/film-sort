# 全量安全审计（2026-10-25，T-20261025-03）

> 范围：worker 全部（认证/会话/验证码/管理面/数据面/出站代理/OG）、shared/、src/ 客户端、构建配置。
> 方法：路由表逐分支核对 + 危险模式机械扫描（XSS sink / SQL 拼接 / 裸 fetch / 密钥 / cookie 标志 / CORS）+ 热点文件精读。
> 性质：**纯审计，未改任何代码**。修复建议见各条；优先级排序见文末。
>
> **修复批勘误（2026-10-25，T-20261025-04 `19b54f2`/`3996f9f`）**：M1 中「登录无限流」的主张**有误**——
> 分派层 `worker/index.ts` `/api/account/` 段早已把 login/register/send-code/change-password/oauth-exchange
> 归入 `account_auth` 严桶（8 次/10 分/IP，index.ts:3271-3280）；审计时只读了 account.ts 路由体、漏看分派层闸门。
> M1 保留并已修复的是另外两点：时序枚举（哑哈希缺失，已补固定零盐等耗时）与禁用判定先于验密（已后置）。
> 其余 M2/M3/M4/L3/L4 均已修复并上线（版本 `c5b6d923`）。

## 结论

整体安全质量**高**。八条硬规则（MEMORY §3 C1–C10）逐条验证全部保持：验证码原子消费、SQL 全参数化、CORS/CSRF 收紧、图片代理白名单严格、白名单编码出口剔除 posterUrls、管理面板转义全程在位、客户端零 XSS sink、用户 API key 纯转发不落盘。发现 4 个 medium（集中在**限流缺失**与**一处 C2 字面偏离**）、6 个 low（多为既知决策或纵深不一致），无 high、无可利用的注入/越权/XSS/SSRF 直接路径。

## Medium

### M1 · /api/account/login 无限流 + 响应时序可枚举注册邮箱

- 证据：`worker/account.ts:413-433`——登录分支无任何 `allowUpstreamRequest`/rateWindow；且 `if (!user || !(await verifyPassword(...)))` 短路求值：用户不存在时**跳过 100k 轮 PBKDF2**，存在与否的响应时间差明显。
- 配合面：`send-code`（account.ts:443-446）直接回 `email_exists`(409) / `email_notfound`(404)，邮箱存在性本来就是明示的（UX 取舍），时序只是把枚举成本降到零请求体。
- 攻击场景：撞库（无速率限制，仅靠 CF 边缘兜底）+ 批量枚举有效邮箱。
- 建议：① 登录前加 `allowUpstreamRequest(request, "auth", N)`（原语已有，index.ts:1957 同款）；② 用户不存在时执行一次哑 PBKDF2（等耗时，消除时序差）。

### M2 · /api/admin/login 无限流，密码策略偏弱

- 证据：`worker/index.ts:1944 → 1443-1478`——handleAdminLogin 无 rateWindow；改密处 `newPassword.length < 6`（index.ts:1585）为唯一策略。
- 缓解：`timingSafeEqual` 比较在位；token 为 32 字节 CSPRNG；7 天会话。但管理面可重置全部数据（reset scopes 含 accounts 全删），撞破一个密码即最高权。
- 建议：admin/login 挂 `auth` 桶限流；最小长度提到 10（存量不受影响，改密时生效）。

### M3 · media.ts `upstream()` 绕过 fetchBounded（C2 字面偏离）

- 证据：`worker/media.ts:286-290`——裸 `fetch(url, { redirect: "follow" })`，无逐跳白名单复核、无响应字节上限；`outbound.ts` 的 fetchBounded（manual redirect + 每跳 parseAllowedUrl + content-type 门 + 超时）未覆盖此路径。
- 调用面已逐个核实（风险收敛）：`proxyImage` 先过 `allowedImage()` 严格白名单（锚定正则/禁 userinfo/port/https 升级，media.ts:2494-2512）；其余调用全部是**常量** douban/music.163 URL。要达成 SSRF 需白名单 CDN 自身开放重定向——低概率但非零；无字节上限在大响应下有内存压力。
- 建议：`upstream()` 改 `redirect:"manual"` + 每跳过域名校验 + 响应读取设上限；或整体迁移到 fetchBounded（douban 需要 cookie/UA 定制头，需 policy 扩展）。

### M4 · /api/image 匿名无限流

- 证据：`worker/index.ts:2258-2259`——`proxyImage(url.searchParams.get("url"))` 直通，无 rateWindow（对比 `/api/posters/batch` 有独立桶 + 413 上限）。
- 缓解：白名单图源 + `cache-control: max-age=86400` + content-type/nosniff 校验，攻击价值低；但变体 query 可刷缓存 miss 消耗站点 CF 流量配额。
- 建议：加 `allowUpstreamRequest(request, "image", N)` 一行。

## Low

| # | 发现 | 证据 | 说明 |
|---|------|------|------|
| L1 | 会话/exchange token 明文存表 | `user_sessions`/`admin_sessions`/`oauth_exchanges` 按 token 等值查询（account.ts:160/34, verification.ts:128） | verification.ts:4 已声明「token-at-rest 哈希本阶段明确不做」——既知既登记决策；D1 泄露才会兑现 |
| L2 | 分享码 48bit | index.ts:3325 `randomUUID().slice(0,12)` | 在线猜需 ~2.8e14 次 + 过期窗口，可接受；URL 成本允许的话可放全 32 hex |
| L3 | 密码最小 6 位（用户注册同款） | account.ts:373 | 现代标准偏低，建议 8 位起步（存量不受影响） |
| L4 | account.ts:66 注释漂移 | 写「轮数保持 OWASP 600k」，实际 `PBKDF2_ITERATIONS = 100_000`（C1 修复后注释未跟上） | 误导下一棒，一行修正 |
| L5 | assertSameOrigin 覆盖不均 | 仅 index.ts 17 处；account.ts/plaza.ts 0 处 | 全部敏感面为 Bearer-header（localStorage token）而非 cookie → CSRF 天然免疫；纵深不一致而非漏洞 |
| L6 | 比较页「粘贴任意 URL」由浏览器直 fetch | App.tsx:1196 `await fetch(url)` | 非 SSRF（客户端执行）；渲染走 React 转义无 sink，影响限于社工链接把攻击者 JSON 显示为对照画像 |

## 验证为「保持」的项（抽样列举）

- **验证码体系**（verification.ts）：EXISTS 守卫把「验证码有效」与「数据变更」并成同一条 SQL（语句级原子）、5 次尝试上限、60s 冷却、一次性 OAuth exchange（条件 DELETE + changes 判定）、Google `email_verified !== true` 拒并号。设计质量高于常见水准。
- **plaza 数据面**：全部 mutation 有属主校验（plaza.ts:324/424/445/475/615 五处 `user_id !== user.id → 403`）；私有帖仅作者可见（104/180）；payload 字节上限 + `encodeStoredWorks/encodeStoredRankings/encodeStoredNotes` 白名单编码出口剔除 posterUrls（C4 保持，plaza.ts:281-292）。
- **SQL**：全参数化；全仓仅 3 处模板字符串进 SQL，均为常量表名（account.ts:976 二值三目、index.ts:1278 固定列表、plaza.ts:79 占位符串）——不可注入。
- **CORS/CSRF**：OPTIONS 一律 405；`assertSameOrigin` 要求 Origin 相符或 `Sec-Fetch-Site: same-origin`，双缺拒绝。
- **图片代理**：`allowedImage` 锚定正则（无子域通配越界）、禁 userinfo/port、https 强制升级；`proxyImage` 校验 content-type 为图片 + nosniff。
- **og.ts / dashboardHtml**：用户可控文本全部过 `ogText`（转义+截断+压平空白）/ `esc()`（C6 保持，index.ts 管理面板逐字段抽查通过）。
- **客户端**：`dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` 全仓 **0 命中**（React 转义覆盖）；两处 `target="_blank"` 均带 `rel="noopener noreferrer"`；自定义主题导入白名单校验（KNOWN_VARS + 字符集正则 + `url(` 显式封禁 + 括号配平，themeRegistry.ts:257-266）。
- **密钥面**：git 无 .env/secret 文件；用户 AI key 经 worker 纯转发不落盘（C5 保持）；OAuth state cookie `HttpOnly; Secure; SameSite=Lax`，一次性清理（account.ts:626/655）。

## 修复优先级建议

1. M1+M2（同款手法：挂既有 `auth` 限流桶 + 登录哑哈希 + 密码下限上调）——半小时级，收益最大。
2. M4（一行限流）。
3. M3（upstream 收口到 fetchBounded 语义，需 policy 支持自定义头/cookie）。
4. L4 注释修正随手带上；L1/L2/L5 记录在案维持现状；L3/L6 可在下一次账户相关迭代顺带。

## 复现/取证材料

- 机械扫描命令与命中清单见审计过程（会话内）；关键行号已内嵌各条。
- 基线：HEAD `1deff71`。
