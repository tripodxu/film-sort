# AI 点评功能落地计划（PLAN-ai-insights）

> 目标：把"AI 总结比较"从单一比较场景的附属功能，落成覆盖 **榜单点评 / 画像点评 / 比较解读** 三个场景的完整能力，支持 **内置 API（Cloudflare 环境变量配置）** 与 **用户自带 API（网页端配置）** 双通道，两通道统一为 `base url + api key + model name` 三参数。
>
> **实施状态（2026-09-19）：Phase 1–4 已全部落地**（`worker/ai.ts` + 路由接线 + 前端三组件 + 三入口 + 文档）。测试 41+19 项全绿，基线 179 → 239。§7.2 本地验证已执行（mock 四协议/SSRF/转发链路，摘要见 `OPTIMIZATION.md` §2.7）；§7.3 真实上游矩阵与 §7.5 线上探针待部署后执行。实施偏离与补全同见 §2.7。

---

## 1. 背景：现状与差距

现有实现（`worker/index.ts` 的 `POST /api/insights` + `src/App.tsx` 的 `requestInsight()`）：

| 维度 | 现状 | 差距 |
|------|------|------|
| 场景 | 仅"两份画像比较"，且摘要由 `crossProfileSummary()` 生成——只有各维度前 5 名标题 | 需要榜单点评、画像点评两个新场景；比较场景的输入也要升级为含指标的结构化数据 |
| 模型配置 | `model` 硬编码 `claude-3-5-haiku-latest`，协议硬编码 Anthropic | 内置需三参数可配（env），协议需支持 OpenAI 兼容 |
| 用户侧 | 用户无法使用自己的 API | 需网页端配置三参数，浏览器不经 CORS、CSP 不放宽 |
| UI | CompareView 一处"AI 观察"区块，无配置入口、无来源标记 | 需要 AI 设置面板 + 三个场景各自的入口与结果卡片 |
| 隐私 | 无提示 | 点评会把作品标题发送给 AI 服务，需明示 |

## 2. 需求确认

1. **三参数统一**：`base url`、`api key`、`model name`。内置与自定义通道都是这三项（协议作为可选高级项，默认自动，见 §4.3）。
2. **内置 API**：参数在 Cloudflare Workers 环境变量配置（`wrangler secret` / Dashboard）。
3. **用户自带 API**：网页端配置，即时生效；不配置则回落内置。
4. **三个评价场景**：
   - **榜单点评**：对用户排行的单份榜单（Top N 序列）做品味侧写；
   - **画像点评**：对完整艺术人格画像（全部维度榜单 + 统计特征）做整体评价；
   - **比较解读**：对两份画像的比较结果（含重合度/共识评分等指标）做跨媒介解读。
5. **提示词可优化、可模块化**：指令与数据分离，提示词由可独立测试的模块拼装；用户侧有受控的风格旋钮（输出长度），运维侧支持管理后台在线覆盖调优，不必发版（§6）。

## 3. 总体设计

```
浏览器                                Worker                          上游 AI
──────                                ──────                          ───────
AiConfigDialog ──写──▶ localStorage
  (art-rank:ai-config)

三个入口组件 ──组装结构化 data──▶ POST /api/insights ──内置──▶ env(AI_API_URL/KEY/MODEL/PROTOCOL) ─▶ 模型 API
  (ProfileView ×2 /           { scene, data,          ─自定义─▶ 请求体内的 config(三参数)
   CompareView)                 config? }                    （校验 + 协议适配，key 不落任何日志）

POST /api/ai/test   ——「测试连接」：max_tokens=16 的探活请求
POST /api/ai/models ——「获取模型列表」：代理各家模型列表端点，供下拉点选
```

关键决策与理由：

- **统一走 Worker 转发，不做浏览器直连**。直连需要放宽 CSP `connect-src`（现在只有 `'self'` + cloudflareinsights.com，放开任意源等于削弱全站安全模型），且各家 API 的 CORS 支持参差（Anthropic 直连还需专用 header）。走同源 `/api/insights` 则两者都不用动。
- **前端发结构化 data、服务端渲染 prompt**。若前端直接发自由文本 prompt，恶意用户可借内置 key 免费调用任意指令；改为前端只发数据（榜单/画像/比较的 JSON），服务端按场景模板拼装，用户可控的只剩数据本身，与现状（summary 可控）相比反而收紧。
- **用户 key 存 localStorage（第一版）**。key 属敏感凭证，默认只留在用户自己的设备；云端加密同步（复用 `user_cookie_vault` 的 AES-GCM 路径，`provider='ai'`）列为后续可选项，不默认做。
- **四协议全兼容**。支持业界主流模型协议各按原生形态直连（不做格式互转），全部在 `worker/ai.ts` 内适配：
  1. **Chat Completions**（`POST {base}/chat/completions`）——OpenAI 兼容事实标准，OpenRouter/DeepSeek/Kimi/智谱/one-api 系网关全兼容，设为默认；
  2. **Responses API**（`POST {base}/responses`）——OpenAI 新一代协议，`max_output_tokens` / `output[].content[].output_text` 的形态与 Chat 不同；
  3. **Anthropic Messages**（`POST {base}/v1/messages`，直连不转换格式）——保持现有生产内置端点零迁移；
  4. **Gemini Native**（`POST {base}/v1beta/models/{model}:generateContent`）——Google 官方协议，端点内嵌模型名。

  协议可由用户显式指定，缺省 `auto` 自动探测（先 Chat，404/405 依次回退 Responses → Anthropic → Gemini，结论按 baseUrl 缓存）。

## 4. 服务端设计

### 4.1 新模块 `worker/ai.ts`

```
类型：
  AiConfig = { baseUrl: string; apiKey: string; model: string;
               protocol?: "auto"|"chat"|"responses"|"anthropic"|"gemini" }
  ResolvedAi = { endpoint: string; apiKey: string; model: string;
                 protocol: "chat"|"responses"|"anthropic"|"gemini" }
  PromptSpec = { version: number | "override"; system: string; user: string }

导出（全部纯函数或近纯函数，便于单测）：
  validateUserConfig(raw: unknown): AiConfig | null      // §4.4 的校验规则
  resolveEndpoint(baseUrl, protocol, model): string      // 端点归一（下表；gemini 需 model）
  composePrompt(scene, data, locale?, opts?): PromptSpec | null  // 模块化拼装（§6.1）
  callModel(cfg: ResolvedAi, spec: PromptSpec, opts): Promise<{ text } | { error: AiErrorCode }>
```

**端点归一规则**（`resolveEndpoint`，统一先去 baseUrl 尾部 `/` 再判断；任何协议下 baseUrl 已以该协议的完整路径结尾则原样不再追加）：

| 协议 | baseUrl 例子 | 实际请求端点 |
|------|--------------|--------------|
| 内置 anthropic（默认，兼容现状） | `https://…/anthropic` | **原样直接 POST**（现生产行为，不追加路径） |
| `chat` | `https://api.openai.com/v1` | `{base}/chat/completions` |
| `responses` | `https://api.openai.com/v1` | `{base}/responses` |
| `anthropic` | `https://api.anthropic.com` | `{base}/v1/messages`；base 已以 `/v1` 结尾时 `{base}/messages` |
| `gemini` | `https://generativelanguage.googleapis.com` | `{base}/v1beta/models/{model}:generateContent`；base 已以 `/v1beta` 或 `/v1` 结尾时 `{base}/models/{model}:generateContent` |

注意：OpenAI 官方两种协议的路径都在 `/v1` 之下，UI placeholder 与文档注明 baseUrl 填到 `/v1` 这一级（如 `https://api.openai.com/v1`），不做 hostname 特判补路径。

**各协议请求/响应差异**（`callModel` 内适配，均为非流式）：

| 协议 | 认证头 | max tokens 字段 | 文本取值 |
|------|--------|------------------|----------|
| `chat` | `Authorization: Bearer` | `max_tokens` | `choices[0].message.content` |
| `responses` | `Authorization: Bearer` | `max_output_tokens` | `output[]` 中 `type==="message"` 项的 `content[]` 中 `type==="output_text"` 的 text 拼接 |
| `anthropic` | `x-api-key` + `anthropic-version: 2023-06-01` | `max_tokens` | `content[].text` 拼接 |
| `gemini` | `x-goog-api-key` | `generationConfig.maxOutputTokens` | `candidates[0].content.parts[].text` 拼接 |

消息结构：`chat`/`responses`/`anthropic` 用 `{role:"system"|"user"}` 消息数组（responses 的 system 放 `input` 数组首位即可）；`gemini` 用 `system_instruction.parts[0].text` + `contents[0].parts[0].text`。超时统一 `AbortSignal.timeout(20000)`，`max_tokens: 1000`，输出在 Worker 侧截断到 2000 字符。

**协议自动探测（自定义、protocol 缺省为 auto 时）**：按 `chat → responses → anthropic → gemini` 顺序尝试；每个候选仅当返回 404/405 时才试下一档；401/403/429/5xx 视为"端点存在、协议命中"，原样报对应错误，不继续探测。结论按 `baseUrl` 存 isolate 内 Map（复用 `rateWindow.ts` 的"带上界 + 惰性清扫"思路，上界 200），避免重复多连发。已知局限：gemini 档的 404 无法区分"协议不对"与"模型名写错"——作为最后一档，404 时统一报 `upstream_not_found` 并在文案中同时提示检查模型名与协议。

### 4.2 `POST /api/insights` 改造（路径不变）

请求体：

```jsonc
{
  "scene": "ranking" | "profile" | "compare",
  "data": { ... },                  // §6 的场景数据，JSON 序列化后 ≤ 16 KB
  "config": {                       // 可选。缺省 = 用内置 env
    "baseUrl": "https://…", "apiKey": "sk-…", "model": "…", "protocol": "auto"
  }
}
```

处理流程：

1. `assertSameOrigin`（现状保留）；
2. 解析 body，`scene` 枚举校验、`data` 为对象且序列化 ≤ 16 KB（413）；
3. `composePrompt(scene, data, locale, opts)` 模块化拼装 system + user（管理端在线覆盖优先，见 §6.3）；拼装不出（数据形状不对）→ 400 `invalid_data`；
4. 通道选择：带 `config` → `validateUserConfig` 过 → 限流桶 `ai_custom`（15 次/10 分钟）；否则用 env 三参数 → 现有限流桶 `ai`（8 次/10 分钟）；
5. `callModel`；成功 → `{ insight, source: "builtin"|"custom", model, promptVersion }`（回显模型名与提示词版本，**绝不回显 key**）；
6. 失败 → 错误码表（§4.5）。

内置 env 读取优先级（零迁移兼容）：

| 变量 | 说明 | 缺省 |
|------|------|------|
| `AI_API_KEY` | 内置 key（不变） | 无（未配置且用户无自定义 → `ai_not_configured`） |
| `AI_API_URL` | 内置端点 / base url（不变，语义见 §4.1 表） | `https://token-plan-cn.xiaomimimo.com/anthropic` |
| `AI_MODEL`（新增） | 内置模型名 | `claude-3-5-haiku-latest`（= 现硬编码值） |
| `AI_PROTOCOL`（新增） | `anthropic` \| `chat` \| `responses` \| `gemini` | `anthropic`（= 现行为） |

**即：CF 上什么都不改，现有生产行为逐字不变；想换成任意网关，配 `AI_PROTOCOL=chat|responses|anthropic|gemini` + 新 URL/KEY/MODEL 即可。**

### 4.3 新端点 `POST /api/ai/test` 与 `POST /api/ai/models`

**`POST /api/ai/test`**：body 同 `config`（三参数 + 可选协议）。行为：发一条 `max_tokens=16`、user 为 `"ping"` 的最小请求，返回 `{ ok: true, model, protocol }` 或 `{ ok: false, error, msg }`。限流：`ai_custom` 桶 + 独立 5 次/10 分钟（防脚本扫端点）。用途：设置面板的"测试连接"按钮，探测结果（含自动判定的协议）回显给用户。

**`POST /api/ai/models`** —— 一键获取模型列表：body 同 `config`。按协议调用各家的模型列表端点：

| 协议 | 列表端点 | 认证 | 响应解析 |
|------|----------|------|----------|
| `chat` / `responses` | `{base}/models` | `Authorization: Bearer` | `data[].id` |
| `anthropic` | `{base}/v1/models`（base 已以 `/v1` 结尾则 `{base}/models`） | `x-api-key` + `anthropic-version` | `data[].id` |
| `gemini` | `{base}/v1beta/models`（base 已以 `/v1beta`/`/v1` 结尾则直接拼 `/models`） | `x-goog-api-key` | `models[].name` 剥离 `models/` 前缀 |

`protocol: auto` 时按 chat → responses → anthropic → gemini 顺序用各自列表端点探测（首个非 404/405 即采用，结论写进协议探测缓存）。分页只取第一页，上限 100 条，超出附 `truncated: true`。返回 `{ ok: true, protocol, models: string[], truncated? }`；失败走 §4.5 错误码。限流：独立 `ai_models` 桶 10 次/10 分钟。SSRF 校验与 §4.4 完全一致。用途：设置面板"获取模型列表"按钮——用户填好 baseUrl + key 后点一下，模型名从下拉点选，免查各家文档。

### 4.4 安全校验（`validateUserConfig`）

- `baseUrl`：必须 `https:`；无 username/password；端口仅空/443；hostname 为**域名**（拒绝字面 IP，杜绝 `http://169.254.169.254` 类元数据端点与内网直扫）；拒绝 `localhost`、`*.internal`、`metadata.cloudflare.com`；长度 ≤ 2083。
- `apiKey`：长度 8–256，无控制字符。
- `model`：长度 1–100，字符集 `[A-Za-z0-9._:/-]`。
- `protocol`：缺省 `auto`，否则枚举。
- 日志安全：`api_logs` 只记 path/status/duration/error/ip（已核实现状，不含 body），自定义 key 不会落库；错误信息里不携带上游响应体原文，只携带映射后的错误码。

### 4.5 错误码 → 前端文案

| error | HTTP | 前端文案（zh） |
|-------|------|----------------|
| `ai_not_configured` | 503 | 服务端未配置 AI，可在设置里填入自己的 API |
| `invalid_config` | 400 | API 配置不合法（检查地址/密钥/模型名） |
| `rate_limited` | 429（retry-after 600） | 操作太频繁，请 10 分钟后再试 |
| `upstream_auth_failed`（上游 401/403） | 502 | API Key 无效或无权限 |
| `upstream_not_found`（上游 404/405） | 502 | 接口地址不正确，或协议不匹配（试试切换 OpenAI / Anthropic） |
| `upstream_rate_limited`（上游 429） | 502 | AI 服务限流，请稍后再试 |
| `upstream_error` | 502 | AI 服务暂不可用 |

## 5. 前端设计

### 5.1 新模块 `src/lib/aiInsight.ts`

```
readAiConfig() / writeAiConfig(cfg) / clearAiConfig()   // localStorage "art-rank:ai-config"
buildRankingData(ranking, profileName): RankingData       // §6 截断规则
buildProfileData(profile): ProfileData
buildCompareData(own, peer, crossProfile, dimResult): CompareData
requestInsight(scene, data): Promise<结果 | 失败信息>     // 自动附带用户 config（若有）
```

失败保留原因分类（对齐 `gdMusic.ts` 的既有模式：不折叠成 null，界面能说清"是限流还是没配置"）。`utils.ts` 的 `crossProfileSummary()` 迁移完成后删除（仅 insights 一个调用方）。

边界行为（写入 `aiInsight.test.ts` 钉住）：

- **数据边界**：单件作品榜单、items 为空的榜单（入口按钮禁用而非发出必失败的请求）、profile 只有一个维度、compare 无共同维度（`sharedKinds` 为空 → data 里 `media: []` + `crossAgreement: null`，prompt 照常渲染，让模型说明"没有可比维度"而不是前端拦截）。
- **locale**：data 组装带 `locale`，服务端 system 模板按 locale 切换输出语言（zh 默认 / en 输出英文），随 `?lang=en` 生效。
- **localStorage 不可用**（隐私模式）：`readAiConfig()` 返回 null、`writeAiConfig()` 静默失败并 toast 提示"浏览器存储不可用，AI 配置仅本次会话有效"——不抛错、不阻塞内置通道。
- **缓存**：会话内 Map，key 为 `scene + JSON.stringify(data)` 的短 hash（FNV 即可，无需 crypto）；data 变化（榜单增删/换维度）自动 miss；"重新生成"按钮绕过缓存强制请求。

### 5.2 新组件

- **`AiConfigDialog.tsx`**：
  - 三输入框（Base URL / API Key / Model）+ 协议下拉（**自动探测 / Chat Completions / Responses API / Anthropic Messages / Gemini Native**），placeholder 标注 baseUrl 该填到哪一级（`https://api.openai.com/v1`、`https://api.anthropic.com`、Gemini 官方域名）。
  - **「获取模型列表」按钮**：调 `POST /api/ai/models`，成功后把 Model 输入框升级为可搜索的 `<input list>` + `<datalist>`（保留手输任意名的能力），自动回填探测到的协议；失败按 §4.5 错误码提示（401 → key 无效；404 → 地址或协议不对）。
  - 「测试连接」（`/api/ai/test`，回显判定出的协议与模型名）、「保存」「清除（回到内置）」。
  - api key 输入框 `type="password"` + 显示切换；隐私说明常驻（"Key 仅保存在本浏览器；点评会将榜单标题发送给你配置的服务"）。
- **`AiInsightCard.tsx`**：通用结果卡——
  - 来源徽标（`内置 · model 名` / `我的 · model 名`）、正文 pre-wrap 分段（不引入 markdown 渲染）、重新生成（绕过会话缓存强制请求）。
  - **长度旋钮**（简短/标准/深入三档，§6.2）：生成按钮旁小号选择器，localStorage 记忆，改变后下一次生成生效并使会话缓存失效。
  - 自持 busy/result/error 状态，按 `cacheKey = scene + hash(data)` 做会话内 Map 缓存（不持久化，刷新重新生成——生成有成本，持久缓存列为后续可选）。
  - 失败按 §4.5 分类文案；429 时读 `retry-after` 显示等待时长；上游超时（20s）给出"AI 服务无响应"文案。
  - 未配置且内置不可用时的"去配置"按钮（由父组件传 open 回调，组件不自行跨层弹窗）。
  - 加载骨架复用 `plaza-pulse` 动画；结果容器 `aria-live="polite"`。

### 5.3 三个入口

| 场景 | 位置 | 触发与门槛 |
|------|------|------|
| 榜单点评 | `ProfileView` 榜单操作区（`rank-actions`，"手动调整/编辑作品"旁加「AI 点评」rank-pill） | 当前 `activeRanking` → `buildRankingData`；`items.length ≥ 1` 才可点，空榜单禁用 + tooltip「榜单为空」 |
| 画像点评 | `ProfileView` 顶部胶囊区（"画像批注/分享画像"旁加「AI 点评画像」） | 完整 `profile` → `buildProfileData`（画像页已保证非空） |
| 比较解读 | `CompareView` 现有「AI 观察」区块改造为 `AiInsightCard` | 当前维度 `result` + `crossProfile` → `buildCompareData`；无共同维度时照常可用（data 里 `media: []`，见 §5.1） |

三入口共用同一卡片；**点击后才发起请求**（卡片展开不请求），避免误触消耗配额。

迁移注意：`App.tsx` 顶层的 `aiInsight` / `aiBusy` / `requestInsight()` 随之下沉进 `AiInsightCard`（自持状态），App.tsx 减三个顶层状态——与既有"状态下沉/拆 Hook"方向一致，同时避免在视图层新增 Hook 违规（本项目 604d331 刚修过两处，CI 的 `react-hooks/recommended` 会兜底）。

### 5.4 设置入口

`SettingsMenu`（顶栏齿轮）新增分组「AI 解读服务」：显示当前模式（`内置` / `我的：model 名` / `未配置`），点击打开 `AiConfigDialog`。

## 6. 提示词模块化与可优化设计

前端组装 data（截断规则钉死在 `aiInsight.ts`，可单测）；服务端把提示词做成**模块化拼装**——指令与数据分离、每块独立可测，并提供两条受控的优化通道：用户侧风格旋钮（§6.2）与管理端在线覆盖（§6.3）。三场景的数据规格见 §6.5。

### 6.1 提示词模块（`worker/ai.ts` 内的纯常量/纯函数）

| 模块 | 内容 | 复用范围 |
|------|------|----------|
| `ROLE_BLOCK` | 角色设定与硬边界（"品味点评助手；不做心理诊断；不下绝对结论"） | 全场景共用 |
| `TASK_BLOCK[scene]` | 场景任务：ranking=单榜单侧写；profile=跨媒介整体评价；compare=两人异同解读 | 按场景 |
| `CONSTRAINT_BLOCK(locale)` | 输出语言（zh/en）、客观中性、禁止复述完整榜单、禁止编造数据 | 全场景共用，locale 参数化 |
| `OUTPUT_BLOCK(length)` | 输出结构（ranking/profile 三段式：总评/亮点/盲区；compare：共同/分歧/建议）+ 字数上限 | 全场景共用，长度参数化 |
| `dataBlock(scene, data)` | 场景数据 → 紧凑文本。**唯一允许接触作品数据的地方** | 按场景 |
| `composePrompt(scene, data, locale, opts)` | 依序拼装 ROLE + TASK + CONSTRAINT + OUTPUT → `system`，dataBlock → `user`，返回 `PromptSpec` | 汇总出口 |

```ts
interface PromptSpec {
  version: number | "override"; // PROMPT_VERSION：模块组合的版本号；管理端覆盖时记 "override"
  system: string;               // 指令部分（不含任何作品数据）
  user: string;                 // dataBlock 结果 + 固定引导语
}
```

设计约束：

- **数据只进 `dataBlock`**：改写任何指令模块都不可能把作品数据带进 system；`dataBlock` 的输入是已校验的场景 data，不是任意文本——用户侧没有自由文本注入面。
- **模块各自可测**：每个 block 独立导出，单测对每块做快照式断言；`composePrompt` 只测拼接顺序、参数传递与版本号。
- **locale 走 CONSTRAINT_BLOCK**：zh/en 两份固定文案随 `?lang=en` 切换；user 数据本身不含 locale。

### 6.2 可优化属性一：风格旋钮（用户侧）

`opts.length: "brief" | "standard" | "deep"`（缺省 standard），映射 `OUTPUT_BLOCK` 的字数上限（约 120 / 250 / 500 字）与段落数。UI：`AiInsightCard` 生成按钮旁小号三档选择，选择持久化到 localStorage（`art-rank:ai-length`）。这是**产品化的提示词优化**——用户在受控枚举内调整输出形态，而不是注入文本。

### 6.3 可优化属性二：管理端在线覆盖（运维侧）

提示词调优不应每次都发版。管理后台（`/admin` 数据页签）新增「AI 提示词」编辑卡：

- 存储：`admin_config` 键 `ai_prompt_system_{scene}`（scene ∈ ranking/profile/compare），值为完整 system 指令文本；**user 数据块始终由服务端渲染，不可覆盖**——覆盖面只剩指令部分，"数据与指令分离"在覆盖路径上依然成立。
- 读取优先级：`admin_config` 覆盖值 > 代码默认模块拼装；覆盖生效时 `promptVersion` 记为 `"override"`，响应与观察项可区分来源。
- 变更走审计：写覆盖/清除覆盖均 `recordAudit`（action: `ai:prompt_override`）；UI 显示"当前为覆盖版本/默认版本"，并提供"恢复默认"按钮。
- 无新迁移（`admin_config` 已存在），受管理密码保护，三场景各自独立。

### 6.4 后续可选（不在本期）

- 语气旋钮（客观分析 / 文艺随笔）——OUTPUT/CONSTRAINT 的再参数化，基建已备；
- 提示词 A/B：`promptVersion` 已进响应与日志，天然支持按版本对比产出质量；
- 场景级 few-shot 示例块。

### 6.5 场景数据规格

#### ranking（单榜单）

```jsonc
{ "profileName": "…", "kind": "film", "collectionTitle": "豆瓣 Top 50",
  "itemCount": 50,
  "works": [ { "rank": 1, "title": "…", "creator": "…", "year": 1994 }, … ] }
```

- works 最多 **150** 条（超出截断并附 `(共 N 件，展示前 150)`）；总序列化 ≤ 8 KB。
- system：`你是艺术品味点评助手。基于给定的榜单数据输出三段简短中文点评：总体印象、品味亮点、可以留意的盲区。不做心理诊断，不复述完整榜单，总共不超过 250 字。`

#### profile（完整画像）

```jsonc
{ "profileName": "…",
  "rankings": [ { "kind": "film", "collectionTitle": "…", "itemCount": 42,
                  "top": [ { "rank":1, "title":"…", "creator":"…", "year":… }, … ] } ],
  "stats": { "totalWorks": 128, "kindsCount": 3, "topCreators": [ ["王家卫", 5], … ] } }
```

- 每榜单 `top` 最多 **15** 条；`topCreators` 为全画像创作者出现频次前 8（前端统计）；整体 ≤ 8 KB。
- system 在 ranking 版基础上追加要求"跨维度观察各媒介之间的偏好关联"。

#### compare（比较解读）

```jsonc
{ "ownName": "…", "peerName": "…",
  "media": [ { "kind": "film", "overlap": 34, "orderAgreement": 78,
               "consensusScore": 71, "kendallTau": 62,
               "sharedTop": ["…", "…"],
               "onlyOwnCount": 10, "onlyPeerCount": 6,
               "biggestGap": { "title": "…", "ownRank": 2, "peerRank": 40 } } ],
  "crossAgreement": 66 }
```

- 指标直接取自 `profile.ts` 已算好的 `DimensionComparison` / `ProfileComparison`（前端拼装，服务端不重算）；`sharedTop` 每维度 ≤ 5 个标题；≤ 6 KB。
- system：`你是艺术偏好比较分析助手。基于两人的榜单与比较指标，输出三段中文：共同品味、主要分歧、一段给两人的共同建议。不下定论、不做心理诊断，总共不超过 250 字。`（沿用现有"不声称心理诊断"的约束。）

三场景的指令部分由 §6.1 的模块拼装（locale 分支在 `CONSTRAINT_BLOCK` 内），数据部分由 `dataBlock` 渲染；`composePrompt` 对形状不符或超预算的 data 直接返回 null（路由转 400）。

## 7. 验证与验收

### 7.1 自动化测试（vitest，上游 fetch 全部 stub）

Worker 端不真连上游——`callModel` 与模型列表函数接受可注入的 `fetchImpl`（缺省 `globalThis.fetch`），测试注入 stub，逐协议校验**请求形状**与**响应解析**：

**`worker/ai.test.ts`（新增，~40 项）**

| 分组 | 用例 |
|------|------|
| 端点归一（~8） | 四协议追加规则各 1；base 已含完整路径不追加（`/v1/chat/completions`、`/v1/messages`、`:generateContent`）；尾 `/` 清理；内置 anthropic 原样直发；gemini 端点内嵌 model 名；base 以 `/v1`、`/v1beta` 结尾的特例 |
| 配置校验（~8） | `http:` 拒绝；字面 IP / `localhost` / `*.internal` / `metadata.cloudflare.com` 拒绝；非 443/80 端口拒绝；key 长度上下界与控制字符；model 字符集白名单；protocol 非法枚举；三参数缺失逐项报错 |
| 协议适配（~10） | 四协议各自的请求体形状（认证头、max tokens 字段名、system 位置）；响应解析：chat `choices[0]`、responses `output_text` 提取、anthropic 多 content block 拼接、gemini `parts[].text` 拼接；畸形 JSON / 空 choices / 空 parts → `upstream_error`；输出截断 2000 |
| 自动探测（~5） | 404 按 chat → responses → anthropic → gemini 顺序回退；401 不回退直接报错；探测结论缓存命中后第二次单发；缓存上界淘汰；gemini 末档 404 的错误文案含"检查模型名与协议" |
| 提示词模块（~10） | ROLE/TASK/CONSTRAINT/OUTPUT 各 block 快照断言；`composePrompt` 三场景拼接顺序与 `PROMPT_VERSION`；data 超预算返回 null；locale zh/en；compare 空 `media`；length 三档映射字数上限；管理端覆盖读取优先级与 `"override"` 版本标记；`dataBlock` 结果不进 system 的结构断言 |
| 模型列表（~4） | 三协议列表端点选择与认证头；gemini `models/` 前缀剥离；分页截断标记；auto 探测顺序 |

**`src/lib/aiInsight.test.ts`（新增，~12 项）**：config 读写/清除/隐私模式容错（localStorage 抛错不外泄）；三场景 data 组装（榜单 150 条截断 + `itemCount` 全量、画像每榜 15 条、creator 频次前 8、compare 指标直传与空 `media` 形状）；请求失败原因透传；缓存 key 随 data 变化失效。

**总量与门禁**：新增 ≥57 项，`npm test` 全绿，基线从 179 → ~236；`npm run check`、`lint`（0 新告警）、`format:check` 同步全绿。

### 7.2 本地端到端（mock 服务器，不依赖真实 key）

新增 `scripts/ai-mock-server.mjs`（Node 内置 `http` 模块，~120 行；不进构建、不进 bundle，仅在手动验证时运行）：同端口挂载四协议端点（`/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1beta/models/{model}:generateContent`）与两个模型列表端点，返回固定点评文本；`?mode=` 查询参数可切换模拟行为（`401`/`404`/`429`/`slow` 慢响应/`garbage` 畸形 JSON）。

`.dev.vars` 将内置 `AI_API_URL` 指向 mock 后 `npm run worker:dev`，逐项核对：

```bash
curl -s localhost:8787/api/ai/test -H 'content-type: application/json' \
  -d '{"baseUrl":"http://localhost:9393/v1","apiKey":"k","model":"m"}'
# 期望：{"ok":true,"model":"m","protocol":"chat"}
```

- [ ] 三场景（ranking/profile/compare）各生成一次成功，响应含 `source/model/insight`；
- [ ] 四协议显式指定均成功；`auto` 在四协议下分别探测命中并缓存；
- [ ] 模型列表：三协议返回 `models[]`，gemini 无 `models/` 前缀；`mode=404` 时 auto 正确降档；
- [ ] 错误注入：`401`→`upstream_auth_failed`、`404`→`upstream_not_found`、`429`→`upstream_rate_limited`、`garbage`→`upstream_error`，文案与 §4.5 一致，`retry-after: 600`；
- [ ] 安全：`http://` base、字面 IP、`metadata.cloudflare.com` 全部 400 `invalid_config`；mock 端点收到的请求体里 system 为服务端模板（不是前端自由文本）；
- [ ] 限流：内置桶连打第 9 次 429；自定义桶 16 次 429；`/api/ai/models` 11 次 429。

### 7.3 真实上游矩阵（自定义通道，每协议至少一家）

| 协议 | 代表服务 | 通过标准 |
|------|----------|----------|
| Chat Completions | OpenAI 官方（或 DeepSeek / OpenRouter） | 列表 + test + 三场景全通；错 key → 401 文案 |
| Responses API | OpenAI 官方 | 同上（重点验证 `max_output_tokens`、`output_text` 解析） |
| Anthropic Messages | Anthropic 官方 | 同上（x-api-key 认证；多 block 拼接） |
| Gemini Native | Google AI Studio key | 同上（`:generateContent` 端点、列表前缀剥离） |

每格执行：填三参数 → 获取模型列表点选 → 测试连接 → 三场景各生成一次 → 错误注入（错 key、错 base 各一次）。矩阵结果与日期记入 `OPTIMIZATION.md` 实施记录。

### 7.4 验收标准（Definition of Done）

- [ ] **门禁**：`check` / `lint` / `format:check` / `test` / `build` 五连全绿；0 新 error、0 新 warning；`AiInsightCard` 的 hooks 依赖数组经 react-hooks 规则确认（本项目 604d331 刚修过同类回归）。
- [ ] **测试**：§7.1 全绿（≥57 项）；§7.2 mock 清单全过。
- [ ] **真实矩阵**：§7.3 四协议 4/4 通过。
- [ ] **内置零迁移回归**：不设 `AI_MODEL`/`AI_PROTOCOL` 时与改造前行为一致（同端点、同默认模型、响应仍含 `insight` 字段、限流仍 8 次）；设 `AI_PROTOCOL=chat` + 任意网关可切换。
- [ ] **隐私/安全**：自定义 key 不出现在任何响应体、`api_logs` 表（查最近记录）、错误文案；`/api/ai/*` 对 http/IP/metadata base 全 400；三场景 prompt 由服务端模板渲染（mock 端点收到请求体可证）。
- [ ] **UI**：三入口门槛正确（空榜单禁用）；429 文案带等待时长；断网/20s 超时有明确文案；隐私模式（禁 localStorage）不报错；会话缓存与"重新生成"行为符合 §5.1。
- [ ] **文档**：§9 Phase 4 四件套更新完毕，FEATURES.md 回归走查清单新增 AI 三项。

### 7.5 线上验证（部署后探针，沿用实证闭环习惯）

1. `GET /api/health` 确认版本与 DB 状态；
2. 内置通道：线上比较页生成一次（现网 key 可用性回归，文案风格不劣化）；
3. 自定义通道：用一次性测试 key 跑完 §7.3 矩阵后**立即从服务商后台删除**；
4. D1 抽查 `api_logs`：确认无 key、无 prompt/body 落库；
5. 按 FEATURES.md 新旧走查清单完整过一遍，确认无既有功能回归。

### 7.6 上线后观察项

- `api_logs` 中 `/api/insights` 的 429 占比（内置/自定义桶是否需要调额）；
- 上游 401/404 错误分布（用户配置错误的主要形态，决定 UI 是否加更具体引导）；
- 三场景实际生成时长分布（决定 20s 超时与 1000 max_tokens 是否调整）；
- `promptVersion` 分布（默认版本号 vs `override`）与各版本产出长度、被"重新生成"的比例，为下一轮提示词调优提供依据。

## 8. 隐私与滥用防护汇总

- 点评 UI 首次生成前有一行常驻说明：`将把榜单标题等数据发送至 AI 服务（内置或你配置的服务）`；分享页/他人榜单暂不开入口（见 §10）。
- 内置通道：IP 限流 8 次/10 分钟（现状），prompt 模板服务端固定，用户可控面只有数据。
- 自定义通道：限流 15 次/10 分钟；key 不过日志、不回显；SSRF 规则见 §4.4。
- 提示词指令由服务端模块拼装（§6.1），用户侧**没有自由文本注入面**；在线覆盖仅限管理后台且写入审计（§6.3）。
- 事件埋点（`track()`）沿用现有白名单，不新增含标题/URL 的事件。

## 9. 实施顺序（每步可独立验证、可单独提交）

1. **Phase 1 — Worker 通道**：`worker/ai.ts`（配置校验/端点归一/四协议适配/auto 探测/**提示词模块与 composePrompt**/模型列表）+ `worker/ai.test.ts` + `/api/insights` 改造 + `/api/ai/test` + `/api/ai/models` + **管理端提示词覆盖（admin_config 读写 + 审计 + 看板编辑卡，§6.3）** + env 类型（`AI_MODEL`/`AI_PROTOCOL`）+ `scripts/ai-mock-server.mjs`。验证：`npm test` 全绿；mock 服务器 curl 清单全过（§7.2）；管理端覆盖写入/恢复默认各验证一次。
2. **Phase 2 — 前端地基**：`lib/aiInsight.ts` + 测试 + `AiConfigDialog`（含「测试连接」「获取模型列表」点选）+ `SettingsMenu` 入口。验证：配置保存/测试连接/模型点选/清除/隐私模式容错。
3. **Phase 3 — 三入口接线**：`AiInsightCard`（含**长度旋钮**）+ ProfileView 两处（榜单点评/画像点评）+ CompareView 迁移（App.tsx 顶层 `aiInsight/aiBusy/requestInsight` 下沉，删除 `crossProfileSummary`）。验证：本地三场景全流程（三档长度各生成一次）+ lint/hooks 零新告警。
4. **Phase 4 — 真实矩阵与文档**：§7.3 四协议真实上游矩阵跑通并记录；中英文案与隐私提示；更新 `README`（环境变量表 + AI 章节 + 提示词模块说明）、`docs/API.md`（insights 重写 + ai/test + ai/models + promptVersion 字段）、`docs/FEATURES.md`（功能清单 + 回归走查清单 +3 项）、`docs/USAGE.md`、`docs/OPTIMIZATION.md`（实施记录 + 矩阵结果 + 上线观察项）。

预估改动量：Worker ~500 行（含管理端覆盖）、前端 ~650 行（含测试）、mock 脚本 ~120 行；无数据库迁移（复用 `admin_config`），无 CSP 变更，内置配置零迁移。

## 10. 明确不做 / 后续可选

- **云端加密同步用户 API 配置**（复用 `user_cookie_vault` AES-GCM，`provider='ai'`）：有基建、成本低，但 key 上云需用户明确勾选，第一版不做。
- **分享页/广场帖对他人榜单点评**：数据都在（RankingDetail 已共用），加个按钮即可，但涉及"把他人数据发给自己的 AI"的边界，等主场景稳定再开。
- **markdown 渲染、流式输出、insight 结果持久化缓存、`ai_usage` 用量表**：均有价值，均非本次必需；待真实使用反馈再排。
- **浏览器直连用户 API**：见 §3，CSP/CORS 代价大于收益，持续不做。
