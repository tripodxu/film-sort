> ⚠️ **【已过时 · 归档】**（2026-09-22 归档）内容停留在归档时点，**请勿据此操作**；现行结论见 `PLAN-ui-refresh.md`（§10）与各活跃文档。所载基线（274 tests 等）与修复清单为当时状态，最终基线见 PLAN-ui-refresh §10.9。

# film-sort3 全量审查与修复记录（2026-09 · MiMo）

> 范围：全仓阅读（src / worker / shared / migrations / docs / 基建）+ P0/P1/P2 代码修复。
> 基线：`tsc -b` 全绿；`vitest` **274 passed / 9 skipped**（notes 3 + 繁简匹配 1）；ESLint **0 error**（warning 24）；`format:check` 全绿。
> 线上地址：https://sort.logicc.top/

---

## 1. 项目概览

| 项   | 内容                                                         |
| ---- | ------------------------------------------------------------ |
| 形态 | ART/RANK：影视/书籍/音乐/其他 偏好排序 + 画像比较 + 广场 + AI 点评 |
| 前端 | React 19 + Vite 6 + Three.js 光球（DeferredOrb 空闲加载）    |
| 后端 | Cloudflare Worker（`worker/index.ts` 入口）+ D1              |
| 共享 | `shared/storedItem.ts` 可落库白名单（客户端/Worker 共用）    |
| 测试 | Vitest，偏纯函数（ranking/profile/AI/poster/rateWindow…）    |
| 部署 | `npm run deploy`（build + d1 migrations apply --remote + wrangler deploy） |

主要体量：`worker/index.ts` ~2848 行、`worker/media.ts` ~2065 行、`src/App.tsx` ~2387 行、`src/views/SourceView.tsx` ~1750 行。

---

## 2. 优化建议总览（独立核验）

### P0 — 安全与数据正确性

| #    | 问题                                                         | 证据                                     | 状态               |
| ---- | ------------------------------------------------------------ | ---------------------------------------- | ------------------ |
| 1    | account/plaza 写接口无限流 + 裸 `request.json()` 无 48KB 限额 | `account.ts:275,300`、`plaza.ts:379,659` | ✅ 已修             |
| 2    | OAuth 未验证邮箱自动并号 + GitHub 伪造 `login@github.local`  | `account.ts:194–215,262`                 | ✅ 已修             |
| 3    | `assertSameOrigin` 缺 Origin 即放行                          | `index.ts:951`                           | ✅ 已修             |
| 4    | `notes` 绕过白名单整包 `JSON.stringify` 入库                 | `index.ts:2806`、`plaza.ts:195`          | ✅ 已修             |
| 5    | 双份 `loadDraft`（App 300 vs useSorting 1000）               | `App.tsx:102` / `useSorting.ts:53`       | ✅ 已修（删死代码） |
| 6    | Cookie 金库密钥与密文同库（D1 `admin_config`）               | `netease.ts`                             | 🟡 文档要求生产配 secret；代码仍兼容 D1 过渡 |

### P1 — 架构 / 性能

| #    | 问题                                                         | 状态                                   |
| ---- | ------------------------------------------------------------ | -------------------------------------- |
| 7    | `worker/index.ts` 巨型 `route()` + 内联 `DASHBOARD_HTML`     | ⏸ 建议拆 `worker/routes/*` + `http.ts` |
| 8    | `exportPng.ts`（21KB）静态进主包                             | ✅ 改 `import()`                        |
| 9    | PBKDF2 100k 迭代偏低                                         | ✅ 提到 600k（登录成功自动升级旧哈希）  |
| 10   | AI 出站 `redirect: follow` 可跳内网                          | ✅ `redirect: "manual"` + 拒绝 3xx      |
| 11   | App 伪依赖 / 无 useCallback·memo / 清单搜索 O(n·m)           | ⏸                                      |
| 12   | Edge 限流非原子；日志无 `waitUntil`；`/api/posters` 单条无限流 | ⏸                                      |
| 13   | `music/play` 串行；`ensureIndex` 阻塞冷启动                  | ⏸（先测量再改）                        |

### P2 — 工程 / 文档 / 测试

| #    | 问题                                                     | 状态                        |
| ---- | -------------------------------------------------------- | --------------------------- |
| 14   | 无覆盖率；零 UI/鉴权/越权测试                            | ⏸                           |
| 15   | `vite sourcemap: true` 使 `dist/*.map` 可下载            | ✅ 生产 `sourcemap: false` |
| 16   | `.zcode/plans/*` 误进 git                                | ✅ `git rm --cached`（.gitignore 已有） |
| 17   | version `1.0.46167`；health 硬编码 2.0.0                 | ✅ package/lock → `2.0.0`，与 health/埋点对齐 |
| 18   | 文档事实漂移与三重复述（§5）                             | ✅ 已纠偏（USAGE/OPTIMIZATION/CLOUDFLARE/README/ARCHITECTURE/PLAN-poster） |
| 19   | SW navigate 缓存无上限；FocusTrap 未全覆盖；toast 无队列 | 🟡 SW+toast 已修；FocusTrap 引导/AI 已接，其余待推广 |

### 明确不做

迁 Next/Remix；引 Zustand/Zod/i18next；CSRF Token 全套；localStorage 读写锁；音乐取图改串行。

---

## 3. 已落地代码修改（工作区，待提交）

| 文件                         | 改动摘要                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `shared/storedItem.ts`       | 新增 `toStoredNotes` / `encodeStoredNotes`：键 `profile:\|ranking:\|work:`，正文 ≤5k、条数 ≤500、控制字符丢弃；空批注 → `null` |
| `shared/storedNotes.test.ts` | **新增** 3 项回归                                            |
| `worker/index.ts`            | ① `assertSameOrigin` 要求 Origin 匹配或 `Sec-Fetch-Site: same-origin`；② 限流桶 `account_auth`(8)/`account`(30)/`plaza_write`(30) + `parseContentLength`；③ share notes 走白名单 |
| `worker/account.ts`          | ① `readJsonObject`（48KB）；② OAuth 仅已验证邮箱并号，否则 `oauth.<provider>.<id>@users.invalid`；去掉 `@github.local`；③ PBKDF2 100k→600k |
| `worker/plaza.ts`            | ① 同款 body 限额；② 创建/更新 notes 均 `encodeStoredNotes`   |
| `src/App.tsx`                | ① 删死代码 `loadDraft`/`Draft`；② `exportPng` 动态 `import()`；③ 清理未使用 import；④ toast 队列（最多 5 条 + `aria-live`）；⑤ `clearAllData` 同步清 notes |
| `worker/ai.ts`               | 出站 `redirect: "manual"`，3xx → `invalid_config`            |
| `worker/gdstudio.ts`         | `pickTracks` 增加繁→简归一（告白氣球↔告白气球），`musicMatch` +1 回归 |
| `src/lib/useAuth.ts`         | 登出清理补 `RECOVERY_KEY`，与 `clearAllData` 集合对齐        |
| `vite.config.ts`             | 生产 `sourcemap: false`                                      |
| `public/sw.js`               | 导航 network-first 只写 `/index.html`，避免路径撑爆缓存      |
| `package.json` / lock        | version `1.0.46167` → `2.0.0`（与 health/埋点一致）          |
| docs/*                       | USAGE/OPTIMIZATION/CLOUDFLARE/README/ARCHITECTURE/PLAN 事实纠偏 |

### OAuth 并号策略（修复后）

1. 先按 `provider + provider_id` 命中已有绑定 → 直接登录。
2. 否则仅当 **emailVerified** 才按 email 并号/建号。
3. 未验证/无邮箱：合成 `oauth.<provider>.<id>@users.invalid` 新建并绑定（不撞真实邮箱）。

---

## 4. 验证与发布清单

```bash
npm run check
npm test
npm run lint
npm run format:check
npm run build
```

线上走查（https://sort.logicc.top/）：

- [ ] 首页 / 主题 / 移动端布局
- [ ] 源站：内置榜单 / 自定义 / 豆瓣 / 网易云歌单
- [ ] 排序三模式 + 撤销 + 草稿恢复
- [ ] 画像 `/myself`、导出 PNG/JSON
- [ ] 比较 `/encounter`、分享 `/share/<code>`
- [ ] 广场发帖 / 点赞 / 评论 / 编辑
- [ ] 注册 / 登录 / OAuth
- [ ] AI 点评三场景
- [ ] 音乐试听 / 歌词
- [ ] 无 Origin 写请求被 403（curl 验证）

部署（用户已授权）：

```bash
git add -A && git commit && git push origin main
# 或 npm run deploy
```

---

## 5. 文档与基建审查摘要

### 文档事实漂移

| 位置                   | 问题                                                   |
| ---------------------- | ------------------------------------------------------ |
| `USAGE.md:34`          | 仍写 fflate 分享编码（实为服务端短码）                 |
| `OPTIMIZATION.md §6.2` | SW「一律 cache-first」不实（导航 network-first）       |
| `OPTIMIZATION.md §6.3` | 焦点陷阱标未实现，`FocusTrap.tsx` 已存在               |
| 多处                   | 测试基线 179 过时；`index.ts` 行数文档 1999 实测 ~2848 |
| README / wrangler      | AI 默认 anthropic+claude vs vars chat+mimo-v2.5 未说明 |
| `CLOUDFLARE.md`        | AI_API_URL/MODEL/PROTOCOL 误标 secret（实为 vars）     |

### 基建缺口

- CI 无 coverage / audit / Dependabot / wrangler dry-run / 体积门禁 / Playwright
- 无 CHANGELOG；semver 混乱；`deploy` 直接打生产 migrations
- `COOKIE_ENC_KEY` 落 D1；cron 无告警；生产 sourcemap 公开
- `.zcode/plans` 误提交；lock 走 npmmirror

### 文档去重

**API.md=端点唯一源 · FEATURES=功能唯一源 · ARCHITECTURE=架构算法 · CLOUDFLARE=部署密钥 · OPTIMIZATION=状态表**；README 只留摘要+链接。

---

## 6. 既有 OPTIMIZATION 待办池（仍有效）

- `pickTracks` 繁简归一
- `clearAllData` 与登出清理不一致
- `other` 海报搜索未接维基
- `doubanSearch` 缺 music suggest
- `ensureIndex*` 预热（先测量）
- 海报来源胜出比计数
- Phase 3 `poster_misses`
- FEATURES 回归 Playwright 化

---

## 7. 执行备注

- 工具通道曾出现「单次调用被展开为多调用」导致限流，验证/提交/推送/线上走查被中断。
- 子代理 3 份（Worker / 前端 / 文档基建）；**修复阶段未用子代理**（遵用户要求）。
- 下一步：① 四门禁已绿（check / test 274 / lint 0e / format）→ ② commit/push → ③ 等部署 → ④ 线上走查 → ⑤ 剩余：Cookie secret 生产配置、FocusTrap 全量、routes 拆分、覆盖率基线。