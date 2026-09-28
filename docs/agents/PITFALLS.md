# PITFALLS — 踩坑档案

> **开工前扫一眼你所在分类的条目，能省掉大量调试时间。** 每条都来自真实事故。
> **发现新坑请补进来**（按分类追加到对应小节末尾），这是文档体系里最需要持续生长的一份。

---

## §1 平台类（Cloudflare Workers / workerd）

| # | 现象 | 根因 | 对策 |
|---|------|------|------|
| 1.1 | 注册 / 改密 / 重置密码**全线崩溃** | PBKDF2 600k 迭代 —— workerd（含 `nodejs_compat` 的 `node:crypto`）拒绝 >100k | 硬上限 **100,000**；哈希格式自带 iterations 便于将来上调 |
| 1.2 | 依赖在 Node 上正常、线上一挂 | 本地 Node ≠ workerd 运行时 | **平台能力必须在目标运行时实测**，不能按 Node.js 假设写代码 |
| 1.3 | `esbuild` classic JSX 报 React 未定义；`react-dom/server` 在 workerd 解析到 Node 构建 | 双运行时差异 | 显式 `import React`；用 `server.browser` entry（React Email 集成时的解法） |
| 1.4 | `D1` bind 不接受 `undefined` | D1 绑定类型限制 | 可选字段统一转 `null` |
| 1.5 | 邮件发送报 `code_-14` / `invalid-key` | **PS 管道 stdin 把 CR 混进 secret**，密钥被污染 | 密钥用干净的 Buffer 重新设置（5 个 secret 全部重设才解决） |
| 1.6 | 后台管理看板登录失效 | 内联脚本里的模板字符串转义错误 | 服务端渲染内联脚本时对模板字面量做转义；看板图表已自托管摆脱外部 CDN |
| 1.7 | 部署更新不生效 | Service Worker 导航缓存单键污染 | SW 只缓存 SPA 壳；导航请求 network-first |

---

## §2 网络类（外部平台 / 反爬 / CSP）

**⚠️ 四类故障现象高度相似（都表现为"功能全挂"），但解法完全不同。排查时先分清是哪一类：**

| 类别 | 现象 | 解法 |
|------|------|------|
| **网络不通** | 全部超时 / ECONNREFUSED | 换出口（CF 被封 → Deno Deploy 走 GCP 出口可达） |
| **被反爬** | 418 / 302 跳到安全页 | 走代理；改 UA / 节流 / 退避；豆瓣图片**必然 418**，一律走图片代理 |
| **被 CSP 拦** | **浏览器静默失败**，表现为降级到失败的 Worker 端点 | 同步 CSP `connect-src` / `img-src` —— 极易误判为上游故障 |
| **被限流 / 风控返空** | HTTP 200 但 body 为空 | 分层降级（开放接口 → weapi 加密通道）+ 分片 + 退避 |

具体事故：

- **2.1 音乐试听全链失败**：CF Worker 出口、gdstudio、网易云出口全部被封 → 最终走 Deno Deploy。上线后仍然全挂 → 是 CSP `connect-src` 缺 Deno 域名，**浏览器静默拦截**。
- **2.2 网易云歌单导入恒空**：旧 `api/playlist/detail` 已要求登录（code 20001）→ 换 v6 + v3 两步链 → CF 出口下又被匿名风控静默返空 → 加 weapi 加密通道 → 单发可通但连发被限流 → 分片 100→300 + 退避 + 节流。
- **2.3 限流误报**：`gdApi` 网络失败被当作预算耗尽 → 移除保守预算计数器，改**连续失败冷却**，并区分错误类型。
- **2.4 豆瓣改版**：mine 页 2026 版已无 `item-root`，豆列 `.doulist-item` 版式也变过 → 解析器要**兼容新旧版式**。
- **2.5 维基消歧**：龙猫（原名后缀污染）、活着（书→电影）、范特西（→美国偶像）、Joker（→市镇/物理学家）。启发式打分的边际收益递减很快 —— 若要动这块，直接看 `docs/ROADMAP.md` 的 Jev Phase 2，别再堆规则。
- **2.6 描述上游超时**：音乐详情曾 ~20s → 百度直连熔断 + 双路并行 + anysearch 提为首选传输 → ~4s。

---

## §3 数据类（D1 / 状态 / 并发）

| # | 现象 | 根因 | 对策 |
|---|------|------|------|
| 3.1 | 保存后刷新**整份画像消失** | 读写两侧校验口径不一致，读侧因校验失败**删了数据** | 口径收敛到一处；**读侧永不删数据** |
| 3.2 | 云端读取 / 广场发布失败（512KB） | 海报 URL 数组塞进画像，150 首歌就超限（**连修三次**：`51dfc8d` `58da68a` `4ce1f15`） | 海报走 `poster_urls` 侧表；落库白名单唯一出口 `shared/storedItem.ts` |
| 3.3 | 旧 localStorage 残留仍超标 | persist 未全量清洗 | persist 函数**全量清洗** posterUrls |
| 3.4 | 删帖 500 | `plaza_post_edits` 外键引用未清 | 删除前先清引用（作者/管理员/重置/删号四处路径都要） |
| 3.5 | 云端同步互相覆盖 | 并发响应无代际 | **水合门 + 会话代际**，旧代际响应丢弃 |
| 3.6 | AI 代判覆盖用户真实选择 | 异步响应迟到 | **键控守卫**：键已变更就丢弃响应 |
| 3.7 | 远程 migration 失败 | 非幂等迁移（0017 索引、source 列） | 迁移必须**幂等可重复应用** |
| 3.8 | 广场发布拦截了 >20 首的榜单 | 复用错了上限（ranking 上限应是 300） | 上限常量按语义区分，别复用 |
| 3.9 | 验证码全部失败（`attempts=0`） | **SQLite `=` 大小写敏感** + 复制粘贴的空白 | 邮箱统一 lowercase；验证码 strip 空白；错误要区分 `code_not_requested` / `code_expired` / `code_locked` / `invalid_code`（带剩余次数） |
| 3.10 | 批注丢失 | `cleanString` 对 object 返回 `null` | 序列化前先判类型 |

---

## §4 视觉 / 前端类

**⚠️ 流程类**：

- **4.1 构建期间禁止截图** —— `dist` 重建导致 ENOENT，一次杀掉 204/270 张截图。服务端 handler 必须包 try/catch。
- **4.2 单张截图异常会杀死整轮长跑** —— warm 轮跑到 114 张崩了，且堆栈被输出过滤吞掉 → 必须做 **per-shot 异常守卫**。
- **4.3 Chrome profile 并发锁竞争** 导致 exit-21 交替出现（非确定性）→ `--profile` 命名空间隔离。
- **4.4 百分比差异会骗人** —— bento grid 的 mode delta 只有 0.0014%，实际是 `display:block` 把 `grid-template-columns` 空化了。判定要用「构造边界 + 位移签名」，不能只看 pct。
- **4.5 PS 5.1 的 UTF8 BOM** 会让 manifest 解析失败 → 解析要 BOM 容忍。
- **4.6 lint 假报错**：`.tmp` chrome profile 目录要进 ignore。**gate 习惯：永远检查 exit code。**

**CSS 类**：

- **4.7 `overflow-x` 会隐式生成 `overflow-y`**，把下拉菜单裁掉（"点击设置什么都看不见"）。
- **4.8 `:last-child` 会误伤** —— 移动端隐藏第 4 个导航项时，匿名用户的「广场」因为是最后一个而被隐藏 → 用 `:nth-child(4)`。
- **4.9 `:focus-visible` 改 `border-radius`** 会造成焦点态形变。
- **4.10 子元素缺 `min-width: 0`** 导致手机端横向溢出（比较页 top3 区块用了 `flex-shrink: 0` 阻止收缩）。
- **4.11 通用选择器误伤** —— `.custom-suggestion > div { flex: 1 }` 拉伸了海报（海报也是 div）→ 加 `:not(.poster)`。
- **4.12 `display: grid` 必须显式声明**（`display:block` base 会空化 `grid-template-columns`）。
- **4.13 `setPointerCapture` 要守卫** —— 非活跃 pointer 事件会打断滑动链。

**可访问性 / 交互类**：

- **4.14 emoji 要 `aria-hidden`**，图标统一收编 lucide 并带 `aria-label` / `aria-pressed`。
- **4.15 原生 `title` 悬停延迟且触屏不可用** → 改 `data-tip` 即时浮层。
- **4.16 `prefers-reduced-motion`** 不只是 CSS —— JS 行为（如 journey 平滑滚动）也要处理。
- **4.17 触屏 tooltip 粘滞** → `hover: none` 时隐藏。

---

## §5 故障排查顺序（线上挂了先按这个走）

```
1. 现象分层：全挂 / 部分挂 / 特定媒介挂 / 特定端挂？
   └ 特定媒介挂 → 大概率上游（§2）；特定端挂 → 大概率 CSS/CSP（§4/§2）
2. 是本地就有还是线上才有？
   └ 只有线上 → 优先怀疑平台差异（§1）与 CSP/缓存（§2/§1.7）
3. 打开浏览器控制台看有没有 CSP 报错（静默拦截的典型）
4. 查 Worker 日志：wrangler tail
5. 查数据侧：D1 里该行是否超 512KB、字段是否被清洗（§3）
6. 查 SW 缓存：强制刷新 / 检查缓存版本
7. 仍无解 → 查 docs/memory/EPISODES.md 看是否有同类战役复盘
```

---

## §6 排查时的常见误判（对照表）

| 你以为 | 实际可能是 |
|--------|-----------|
| 上游挂了 | CSP 静默拦截 |
| 被限流了 | 网络失败被错误归类 |
| 功能坏了 | 上游风控返回**空 body 但 HTTP 200** |
| 数据丢了 | 读侧校验失败把数据删了 |
| 样式没生效 | `display:block` 空化了 grid / 被通用选择器覆盖 |
| 部署没生效 | Service Worker 缓存 |
| 视觉没变化 | 差异小到百分比看不出来，但结构已经坏了 |
