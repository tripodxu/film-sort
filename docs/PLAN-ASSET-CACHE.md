# PLAN-ASSET-CACHE — 迭代 6/20（优化类）· 内容哈希产物的缓存策略归位

> 立项：用户 m01265 的 ≥20 轮轮换计划（优化类）。承接 T-20261002-06 下一步①「Poster 批次预取 / 主包瘦身」——
> **本轮先量后写，把这两个候选都否掉了，才轮到这个真问题**。

## §0 一句话

内容哈希产物（`/assets/index-<hash>.js`、`.css`）现在挂着 **HTML 那套 `max-age=0, must-revalidate`**，
导致每次冷启动都要为 407 KB 的主包和 147 KB 的样式重传一遍 134 KB + 27 KB 并等一趟 RTT；
把哈希文件名换成「不可变一年」、只给 `index.html` 留 `must-revalidate`，
**不删一个字节、不改一行渲染逻辑**，只改一处响应头策略。

## §1 事实表

| # | 事实 | 取证方式 |
|---|------|---------|
| F1 | 首屏关键路径**只有两个文件**：`index-Cix8RSlz.js` 407 589 B、`index-BNDWEENQ.css` 147 241 B；`modulepreload` 计数 **0**（懒 chunk 全不预加载） | 线上 `/` HTML 正则扫 `(?:src\|href)="(/assets/[^"]+)"` |
| F2 | 两者 `cache-control` 都是 **`public, max-age=0, must-revalidate`**，`cf-cache-status: HIT` | `node:https` 原样读响应头（PowerShell `Invoke-WebRequest` 不解 br，量出来是 407 KB 明文，**差点得出「没压缩」的错误结论**） |
| F3 | 实际传输是 **br**：`index.js` 线上 **134 804 B**、`.css` **27 902 B**、`three.module` 132 507 B；`content-length` 头不存在（分块编码） | 同上，`content-encoding: br`，落盘字节数 |
| F4 | 强 ETag 存在：`W/"033abfdb1ee969ea6b983a26198a91e0"`（js）、`W/"05a52ab55cee7167edae4dd48d072bd3"`（css） | 同上 |
| F5 | 该头不是我们代码设的：`serveAssets`（`worker/index.ts:1728-1738`）只做 `env.ASSETS.fetch` + `withSecurityHeaders`，而 `withSecurityHeaders`（`:952-958`）**只写 `SECURITY_HEADERS`（CSP/COOP/referrer/nosniff/frame/permissions）**，不含 `cache-control` ⇒ 头来自 Workers 静态资源默认策略 | 读源码 + `grep cache-control` |
| F6 | `wrangler.jsonc:7-11` 的 `assets` 段**没有 `html_handling` / `not_found_handling` / 自定义头配置**，即走默认 | 读配置 |
| F7 | 单文件 RTT 就有 **300–4693 ms** 波动（同一文件连打 3 次：1083 / 300 / 444 ms），HTML 3174 ms | 见 §1 测量记录 |
| F10 | **`.html` 没有 ETag，只有内容哈希资源有**（`/` 的 `etag` 是 `undefined`）⇒ 「HTML 每次都回源」在改头之前就已经成立，不是我本轮造出来的 | `node:https` 读 `/` 的响应头 |
| F11 | **`dist/assets/` 里全是带哈希的文件，无哈希文件都在 `dist/` 根目录**：`favicon.svg` / `index.html` / `manifest.json` / `sw.js` ⇒ 判据只要看「文件名形态」，不必给目录开白名单 | `Get-ChildItem dist`、`Get-ChildItem dist\assets` |
| F8 | **Poster 批次不是瓶颈**（否掉台账候选①）：4 条 other 冷回源 **2402 / 1770 / 1611 ms**，D1 命中 **1616 / 1744 / 1659 ms** ⇒ **冷热无差别**，因为 `resolvePostersBatch`（`worker/media.ts:1871`）已按 `concurrency: 8` 并发，4 条 ≈ 1 次解析，1.6 s 里 1.2 s 是 RTT | `.tmp/timing2.ps1`，每轮先 `DELETE FROM poster_urls WHERE media_key LIKE …` 强迫真回源 |
| F9 | 主包 407.59 KB 里 react-dom 约 46 KB、App.tsx 12.15 KB、catalog 6.01 / ranking 4.88 / useSorting 3.84 / profile 2.46 KB——**数据层总共约 17 KB**，再拆也换不来两位数 KB | 迭代 4 的 sourcemap 归属（F5/§4.33：只覆盖 169.54/414.71 KB，**只当排序器**）+ 本轮文件体积复核（catalog 37.79 KB / ranking 45.47 KB / useSorting 31.27 KB / profile 30.98 KB 源码，但**压缩后归属只有 6.01 / 4.88 / 3.84 / 2.46 KB**） |

## §2 根因

「有点卡」（m00079）此前被归因过两次：一次是 RTT（`colo=LAX`，用户在中国被路由到洛杉矶），一次是海报没缩略（迭代 3 已修，4.41×）。
**第三次归因是本轮量出来的：内容哈希产物被当成 HTML 一样对待。**

- 文件名里已经带内容哈希（`index-Cix8RSlz.js`），**内容变了文件名就变**——这是不可变资源（immutable），
  一年后它和今天的字节完全一样，`must-revalidate` 在这里**没有任何正确性收益，只有一次白跑的往返**。
- 真正需要 `must-revalidate` 的只有 `index.html`（它指向当前哈希，且是部署切换的入口）。
- 现状的后果：**每次冷启动/硬刷新**都要重新下载 134 KB（br）+ 27 KB（br）并等 1–4 s RTT；
  而同一份资源在 Cloudflare 边缘是 `HIT`，说明**服务端完全具备长期缓存的能力，只是我们没告诉浏览器可以用**。

## §3 方案

### 3.1 改什么
`worker/index.ts` 的 `serveAssets` 里，按路径分流 `cache-control`：

- `/assets/*` 且**带内容哈希**（文件名匹配 `-<8~64 位十六进制/base64url>.`）⇒ `public, max-age=31536000, immutable`
- 其余（`index.html`、无哈希的静态文件）⇒ 保持 `public, max-age=0, must-revalidate`

判定用**文件名正则而不是目录白名单**，理由：`dist/` 里还有 `favicon`、字体等无哈希文件，
按目录一刀切会把它们也钉成一年——而 `/assets/` 之外的路径（`/api/*`）根本不经过 `serveAssets`。

### 3.2 为什么放在 Worker 而不是 `wrangler.jsonc`
`assets` 段能配 `html_handling`，但**配不了「按文件特征给不同 cache-control」**；
`run_worker_first: true` 已经是现状，所以响应必然经过 Worker，在 `serveAssets` 里改是唯一能表达这条规则的地方。

### 3.3 兜底
- **不动 `withSecurityHeaders`**，只动 `serveAssets` 内的响应头——CSP 等安全头必须原样透传。
- **HTML 不动**，部署切换语义（`must-revalidate` + `max-age=0`）原封不动。
- 不删 ETag：即使某天缓存过期，`If-None-Match` 仍能拿到 304。

## §4 不做什么

- 不改 vite 配置、不加 `manualChunks`、不碰 chunk 划分。
- 不给 `/api/*` 加缓存（`json()` 的 `no-store` 保持不变）。
- 不做 Service Worker（Phase 8 PWA 仍是 ⬜）。
- 不动字体/图片的缓存策略（它们本来就不在 `/assets/` 的 JS/CSS 路径上，本轮不扩散）。

## §5 验收

### 5.1 测量方法
- 缓存头：`node:https` 原始请求（`Invoke-WebRequest` 会自动解 br，把字节数放大 3 倍，**不能用**）。
- 传输量：落盘字节数。
- 二次访问：`If-None-Match` 走 304。
- 首屏耗时：HTML + 两个关键资源的 `wall` 计时。

### 5.2 验收表

| # | 维度 | 判据 | 结果 |
|---|------|------|------|
| A1 | 行为 | 哈希产物返回 `max-age=31536000, immutable` | ⬜ |
| A2 | 行为 | `index.html` 仍是 `public, max-age=0, must-revalidate` | ✅ `/` → `must-revalidate`（br 888 B）。**附带事实：html 没有 `etag`**（只有哈希资源带强 ETag），所以「HTML 每次都回源」这一条本来就成立 |
| A3 | 行为 | 无哈希文件（如 `favicon.svg`）**不得**被判成 immutable | ✅ 用 `dist/` 根目录里真实存在的四个无哈希文件验：`/favicon.svg` 200 `must-revalidate`、`/manifest.json` 200 `must-revalidate`、`/sw.js` 200 `must-revalidate`；`/index.html` 直接 307 重定向（无头，正常）。**注意 `sw.js` 是这一栏的关键样本**——Service Worker 脚本被冻成一年是最难排查的一类线上事故 |
| A4 | 安全 | `content-security-policy` 等 6 个 `SECURITY_HEADERS` 原样透传 | ✅ 6 条头全在：CSP（`default-src 'self'` / `img-src` 含 `upload.wikimedia.org`+`thumb.wikimedia.org` / `frame-ancestors 'none'` / `upgrade-insecure-requests`）、`cross-origin-opener-policy: same-origin`、`x-content-type-options: nosniff`、`x-frame-options: DENY`、`referrer-policy: strict-origin-when-cross-origin`、`permissions-policy: camera=(), microphone=(), geolocation=()…` |
| A5 | 兼容 | 带 `If-None-Match` 的请求仍能拿到 304（不被我们改头破坏） | ✅ 带 `If-None-Match: W/"033abfdb…"` → **304**。ETag 仍随哈希资源透传（`W/"033abfdb1ee969ea6b983a26198a91e0"`） |
| A6 | 回归 | 7 条 SPA 路由仍 200（须带 `Accept: text/html`，见 PITFALLS 4.35） | ✅ 七条全 200，且**七条都是 `must-revalidate`**——说明 SPA fallback 返回的 HTML 走的是同一条「非哈希 ⇒ 不冻」分支 |
| A7 | 回归 | `/api/posters/batch` 4 条 other 封面逐字不变 | ✅ 5 条全对：journey=`Journey_PSN_Cover.png`、蒙娜丽莎=`500px-Mona_Lisa%2C_by_Leonardo_da_Vinci…jpg`、纪念碑谷=`Monument_Valley_icon_unrounded.jpg`、动物森友会=`Animal_Crossing_New_Horizons.png`、inside=`INSIDE_Cover.jpg`（与迭代 3 逐字相同）。**API 头未被波及**：`batch` = `max-age=86400, private`、`candidates` = `public, max-age=300`，两者都不走 `serveAssets` |
| A8 | 回归 | `/api/other/candidates?name=Journey&year=2012` → `picked=风之旅人 band=weak pool=3` | ✅ 3/3 命中该值。**但这个验收项差点写成 ❌，过程见 §7.2** |
| A9 | 产物 | build 产物**哈希名与字节数逐字不变**（本轮只改 Worker 响应头） | ✅ `index-Cix8RSlz.js` **407.59 kB**、`index-BNDWEENQ.css` **147.24 kB** —— 与迭代 5 **逐字相同** |
| A10 | 门禁 | tsc / lint 0 errors·29 warnings / format:check / vitest 全绿 / build | ✅ tsc exit 0；lint **29 problems (0 errors, 29 warnings)**＝迭代 5 基线不增；format:check `All matched files use Prettier code style!`；vitest **614 passed·9 skipped·623**（45 files，1 skipped file）＝较迭代 5 的 605 **+9**；build 4.4s |

### 5.3 绊线设计

**两份**，`src/ui-fixes.test.ts` 3 例（构建期源码扫描）+ `worker/assetCache.test.ts` 6 例（行为）：
1. 源码扫描①：存在 `CONTENT_HASHED_ASSET` 正则 + `max-age=31536000, immutable` 字面量 +
   **完整判定表达式** `pathname.startsWith("/assets/") && CONTENT_HASHED_ASSET.test(pathname)`；
2. 源码扫描②：`immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"`
   这个三元本身（两个分支的文案都要在）；
3. 源码扫描③：**`withSecurityHeaders` 函数体内不得出现 `cache-control`**——这是唯一能挡住
   「有人把缓存头塞进安全头表、把 JSON API 一起冻一年」的那条；
4. 行为（假 `env.ASSETS`）：三个哈希产物 immutable / `/` 保持 `must-revalidate` /
   `/assets/favicon.svg` 与 `/assets/orbit-zoom.png` 保持 `must-revalidate` /
   未知路径 404 **头不被改** / 6 条安全头逐条在 / 7 条 SPA 路由仍 200 且仍要求 `Accept: text/html`。
   **假 ASSETS 必须给每个断言路径都登记 200**，否则断言会在守卫短路处空转（§7.3）。

### 5.4 红队 ✅
把判定改成 `const immutable = pathname.startsWith("/assets/"); // REDTEAM-PROBE: 目录一刀切` ⇒ **2 failed**：
- `worker/assetCache.test.ts`「无哈希的 /assets 文件不得被判成 immutable」：`expected 'public, max-age=31536000, immutable' to be 'public, max-age=0, must-revalidate'`；
- `src/ui-fixes.test.ts`「哈希产物的判定靠文件名形态，且不按目录一刀切」：`expected … to contain 'pathname.startsWith("/assets/") && CO…'`。
恢复后 68 passed。

## §6 风险表

| # | 风险 | 处置 |
|---|------|------|
| R1 | 部署后用户拿到旧哈希的 JS 一年 | 哈希变了就是新 URL，HTML `must-revalidate` 保证立刻指向新文件；旧文件留着无害 |
| R2 | 某个**无哈希**的 `/assets/` 文件被误判 | 正则要求 `-<hash>.` 形态；A3 + 红队专门验这条 |
| R3 | 改头时把 CSP 弄丢 | A4 逐条断言 6 个头 |
| R4 | 304 语义被破坏导致每次仍全量下载 | A5 |
| R5 | 收益被 RTT 淹没看起来「没变快」 | 缓存头的收益**在第二次访问才兑现**（对同一用户），首访收益是 0；验收看**头的值**而不是墙钟 |

## §7 反思

### 7.1 两个台账候选都是被「先量后写」否掉的，而这正是本轮最大的收获
本轮开门就写了计划，但计划的**题**是量出来的，不是选出来的：台账 T-20261002-06 下一步①给了
「Poster 批次预取 / 主包瘦身」两个候选，逐个量完发现两个都不值得做——

- **Poster 批次预取**：冷回源 2402/1770/1611 ms vs D1 命中 1616/1744/1659 ms，**冷热无差别**。
  根因是 `resolvePostersBatch` 已按 `concurrency: 8` 并发，4 条 ≈ 1 次解析，1.6 s 里 1.2 s 是 RTT。
  **预取一批等于提前烧掉同一个桶的配额，换不来任何时间。**
- **主包数据层瘦身**：源码体积看着吓人（catalog 37.79 KB / ranking 45.47 KB / useSorting 31.27 KB /
  profile 30.98 KB），但 sourcemap 归属里压缩后**总共约 17 KB**。按 4.33，sourcemap 的数字只能排序
  不能承诺——所以这次是**两边都量**：文件体积决定「值不值得动」，sourcemap 决定「先动谁」。

真正的题是自己量出来的：**首屏关键路径只有两个文件，407 KB + 147 KB，而它们挂着 HTML 的
`max-age=0, must-revalidate`**。修它**不删一个字节**，比上面两个候选都便宜、都确定。
教训：**台账候选是起点不是答案**（这是 4.31 的第二次兑现——上一轮我照着台账干 fflate，库早就不在主包里了）。

### 7.2 一个验收项差点被我写成 ❌，而它其实既不是回归也不是故障
A8（`/api/other/candidates`）第一次实测返 `picked='' band=weak pool=0`、177 字节。按 4.41 的教训
我很警惕，但这次我没有直接下结论，而是去量化了它：

| 采样 | 结果分布 |
|------|---------|
| `Journey&year=2012` × 10（换 cache-buster 绕 300s 边缘缓存） | **3 种结果**：zh/风之旅人/weak/3 ×3、en/`Journey (2012 video game)`/exact/5 ×3、**空 ×4** |
| `Journey&year=2012` × 12（稍后重测） | **12 次全部正常**（zh ×11 + en ×1），零退化 |
| `纪念碑谷&year=2014` 间隔 30s × 4 | 4/4 正常（`exact/0.767/pool=4`，与迭代 2 逐字相同） |

结论：**上游维基的间歇性失败**，不是本轮回归（本轮只改静态响应头，`/api/*` 不走 `serveAssets`）。
但真正值得记下来的是**它暴露的一个设计问题**，本轮**不动它**（见 §4）：

> **「上游全挂」和「维基真没有这个作品」在响应里长得一模一样**——都是
> `{candidates:[], picked:null, confidence:{score:0, band:"weak", evidence:"none", poolSize:0}}`，
> 唯一区别是 `lang: null`（`other.ts:1018` 的 `empty` 兜底）vs 正常结果的 `lang:"zh"|"en"`。

这直接打到了迭代 5 刚上线的 UI：`CoverChoice` 的 `shouldOfferChoice` 判 `poolSize < 2` 就不打扰，
所以用户看到的是**静默无图**——不会崩、不会报错，但用户也永远不知道自己点的那个作品「系统没找到」。
**正确的修法是让端点区分这两种空**，但那属于判决链路的改动，本轮（优化类、只改响应头）明确不做，
已作为遗留风险交给下一轮。**记录它比顺手修它有价值**：一个把「诚实」和「故障」混成同一个值的接口，
下一次有人读它会得出错误结论。

### 7.3 守卫短路在前，断言就在后面空转——这条坑和 4.39 是同一族
`worker/assetCache.test.ts` 第一版把 `/assets/favicon.svg` 写进了断言，但**假 `env.ASSETS` 里没登记这个路径**，
于是 `env.ASSETS.fetch` 返 404 → 策略在 `if (response.status !== 200 && !== 304) return response;` 处短路 →
`CONTENT_HASHED_ASSET.test()` 根本没被调用 → 断言照样通过。**测试在保护一个它从没执行到的分支。**
补上 200 响应后 A3 才有意义。识别方法很朴素：**看断言路径有没有真的走到被测函数**。
（4.39 是「断言恒真」，这条是「断言没执行」，两个方向都会给人虚假的安全感。）

### 7.4 这次踩到的两个测量坑，都差点让我得出错误的根因
1. **`Invoke-WebRequest` 会自动解 br**。用它量 `index-Cix8RSlz.js` 出来是 407 KB，我盯着这个数字想
   「所以线上根本没压缩，这就是卡的原因」——**结论完全错了**。真实传输 134 804 B。必须用 `node:https`
   原始请求才能看到 `content-encoding: br` 和落盘字节。**任何「量传输量」的结论都要先确认探针不解压。**
2. **`curl.exe --compressed` 在本机不可用**（libcurl 版本太老，报
   `the installed libcurl version doesn't support this`），`If-None-Match` 从 PowerShell 直接传
   `$r.Headers['etag']` 会报 `The format of value 'System.String[]' is invalid.`（头部是多值数组）。
   两个坑叠加时容易把「工具报错」误当成「线上行为异常」。

### 7.5 缓存头的收益看的是头的值，不是墙钟
R5 在计划里就写了这个判断，线上验证时它救了本轮：如果我拿「改完之后首页快了多少」当验收，
会得到 0——**首访收益就是 0**（浏览器手上什么都没有），收益在**第二次访问同一 URL** 才兑现。
所以本轮 A1–A6 全部是**断言头的值**，A9 才是产物指纹，**没有一项是拿墙钟当证据的**。
这也是 2.x 里「性能注释不是证据」那条的老规矩在缓存语境下的具体形态。

### 7.6 诚实的范围账
本轮**只改了一处响应头**（`worker/index.ts` +11 行 + 1 个正则），`src/` 零改动。
- 有意**不做**：`favicon.svg` / `manifest.json` / `sw.js` 虽然是无哈希文件，但它们**加起来只有 1.4 KB**，
  而且是「变了必须立刻生效」的文件（尤其 `sw.js`——Service Worker 脚本被冻住是最难排查的事故）。保持 `must-revalidate` 是对的。
- 有意**不做**：真正的收益大头在 `three.module-*.js` 530 KB，但它是懒 chunk，**首屏根本不加载**，
  本轮的头策略已经顺带覆盖了它（实测 immutable + 132 496 B），不需要额外做什么。
- **计划外**：§7.2 那个「空池子二义性」是本轮发现但**明确不在本轮范围**的缺陷。
- **计划外**：`.tmp/` 下加了 4 个测量脚本（`assetHeaders.mjs` / `verify6.mjs` / `verify-unhashed.mjs` / `regress6.ps1`），
  它们不进版本库，但如果有下一轮要复测缓存策略，`verify6.mjs` 是可以直接复用的探针。
