# AI 快排(Jev Phase 1)实施计划

> **For agentic workers:** 本计划按 writing-plans 规格编写,每个 Task 含可验证的小步与完整代码。步骤使用 checkbox(`- [ ]`)跟踪。执行方式见文末。

**Goal:** 在准备页新增第三种成榜方式「AI 快排」——调用 TypeSafe Jev 决策模型,依据用户历史取舍预测完整顺序,跳过 1v1 逐对比较直接成榜。

**Architecture:** 前端把选中作品 + 压缩的品味上下文(已有榜单名次序列)POST 给同源 Worker `/api/ai/jev-rank`;Worker 组装**一次** `systemone` 调用(state = 品味档案 + 清单全文,questions = 每件作品一个 Noul 问题,模型并行评估),把返回的 0–1 分数排序后回传;前端按回传顺序走 `saveWithoutSortingFn` 同款落库路径(`toRankedItems → mergeRanking → persist`)成榜。key 全程只存前端 localStorage,Worker 不落盘。

**Tech Stack:** Cloudflare Worker(原生 fetch + `outbound.fetchBounded` 出站策略)+ React 19 + Vitest(node 环境,`fetchImpl` 注入 + localStorage stub,与 `ai.test.ts`/`aiInsight.test.ts` 同款)。

**上游 API 事实核对**(来源:[docs.typesafe.ai/introduction/quickstart](https://docs.typesafe.ai/introduction/quickstart),2026-09-27 抓取):

- `POST https://api.typesafe.ai/v1/systemone`,`Authorization: Bearer <KEY>`,`Content-Type: application/json`;
- 请求体:`{ "model": "jev-latest", "state": <string>, "questions": { <key>: { "type": "noul", "instructions": <string> } } }`;Noul 返回 `noul: 0–1`;questions 并行、各自独立评估(共用同一 state);
- 响应体:`{ "model": "jev-1.13.0", "answers": { <key>: { "type": "noul", "noul": 1.0 } }, "usage": { "input_tokens": 392 } }`。

**设计简报**(impeccable shape,已定世界内的紧凑版):

- **任务与受众**:准备页(Operate 模式)选好作品、不想/来不及逐对比较的用户,一键拿到可继续微调的完整榜单;
- **成功标准**:点击 → 配置检查 → 一次模型调用 → 落库跳画像页,全程 notice 可读;失败时说明原因(没配 key / key 错 / 限流 / 超时);
- **方向**:完全沿用既有档案语言——第三个 `button secondary`(Sparkles 图标,与 AI 点评图标体系一致),busy 态改文案「排序中…」;Jev 配置作为 `AiConfigDialog` 内的并列小节,复用 `label`/`button secondary`/`mini-note` 既有样式,不发明新组件;
- **状态**:未配 key / busy / 失败 / 成功 / works>255 拒绝 / 隐私模式 localStorage 失败(console.warn + 本次会话有效);
- **边界**:不改排序引擎(`ranking.ts` 的 quick/classic/precise 三模式不动)、不动 TopN(快排出全序)、AI 结果永远可被「手动调整」推翻;
- **反目标**:不做流式/进度条(单次调用 70–500ms);不做多模型路由;不在 Worker 存任何 key。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `worker/typesafe.test.ts` | 新建 | Jev 客户端单测(fetchImpl 注入) |
| `worker/typesafe.ts` | 新建 | 上游调用、state/questions 组装、body 解析、排序 |
| `worker/index.ts` | 修改(~184-204 桶类型 + ~2610 路由区) | 两个新路由 + 限流桶 |
| `src/lib/typesafe.test.ts` | 新建 | 配置存取 + buildTasteContext + 失败文案单测 |
| `src/lib/typesafe.ts` | 新建 | 前端配置存取 + API 客户端 + 失败映射 |
| `src/lib/useSorting.ts` | 修改(~96 state 区、~823 返回区) | `startJevRanking` + `jevBusy` |
| `src/views/types.ts` | 修改(~88) | SetupViewProps 增 2 项 |
| `src/views/SetupView.tsx` | 修改(~1,147) | 第三个动作按钮 |
| `src/App.tsx` | 修改(~1142 接线区) | 解构并下传新 props |
| `src/components/AiConfigDialog.tsx` | 修改(~321) | Jev 小节(key/测试/保存) |
| `docs/API.md` `docs/ROADMAP.md` | 修改 | 端点文档 + Phase 1 状态回写 |

---

## Task 1: Worker 端 Jev 客户端——校验与组装(纯函数)

**Files:**
- Create: `worker/typesafe.ts`
- Create: `worker/typesafe.test.ts`

- [ ] **Step 1.1:写失败测试(校验器)**

`worker/typesafe.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildJevQuestions,
  buildJevState,
  jevRank,
  parseJevRankBody,
  testJevConnection,
  validateJevConfig,
} from "./typesafe";

describe("validateJevConfig", () => {
  it("接受合法 key", () => {
    expect(validateJevConfig({ apiKey: "ts_abcdef123456" })).toEqual({
      apiKey: "ts_abcdef123456",
    });
  });
  it("拒绝过短/过长/含控制字符/非字符串 key", () => {
    expect(validateJevConfig({ apiKey: "short" })).toBeNull();
    expect(validateJevConfig({ apiKey: "x".repeat(257) })).toBeNull();
    expect(validateJevConfig({ apiKey: "bad\nkey123" })).toBeNull();
    expect(validateJevConfig({ apiKey: 123 })).toBeNull();
    expect(validateJevConfig(null)).toBeNull();
  });
});
```

- [ ] **Step 1.2:运行确认失败**

Run: `npx vitest run worker/typesafe.test.ts`
Expected: FAIL(Cannot find module './typesafe')

- [ ] **Step 1.3:最小实现 `worker/typesafe.ts` 头部与校验器**

```ts
/**
 * TypeSafe AI(Jev,System One 决策模型)客户端。
 *
 * 只做「决策」不做生成:把用户品味上下文 + 清单作品组装成一次 systemone
 * 调用(每件作品一个 Noul 问题,模型并行评估、互不污染),返回带 0–1
 * 校准概率的排序。上游地址固定 api.typesafe.ai(非用户可控 URL,允许走
 * fetchBounded 精确白名单);用户的 apiKey 由前端透传,本模块不落盘。
 */
import { AiError } from "./ai";
import { OutboundError, fetchBounded, readBoundedJson } from "./outbound";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CONTROL_RE = /[\u0000-\u001f\u007f]/; // 与 ai.ts validateUserConfig 同口径

export type JevKind = "film" | "book" | "music" | "other";
const KIND_LABELS: Record<JevKind, string> = {
  film: "电影",
  book: "书籍",
  music: "音乐",
  other: "其他",
};

export interface JevWorkInput {
  title: string;
  creator?: string;
  year?: number;
}
export interface JevRankInput {
  kind: JevKind;
  collectionTitle: string;
  works: JevWorkInput[];
  profileContext?: string;
  locale?: "zh" | "en";
}
export interface JevRankResult {
  model: string;
  order: number[];
  scores: number[];
  inputTokens: number;
}

export function validateJevConfig(raw: unknown): { apiKey: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.apiKey !== "string") return null;
  const apiKey = cfg.apiKey;
  if (apiKey.length < 8 || apiKey.length > 256 || CONTROL_RE.test(apiKey)) return null;
  return { apiKey };
}
```

- [ ] **Step 1.4:写 state/questions 组装测试(追加到测试文件)**

```ts
const input = {
  kind: "film" as const,
  collectionTitle: "豆瓣高分片单",
  works: [
    { title: "盗梦空间", year: 2010, creator: "克里斯托弗·诺兰" },
    { title: "霸王别姬", year: 1993 },
  ],
};

describe("buildJevState / buildJevQuestions", () => {
  it("state 含品味档案、清单头与编号作品行", () => {
    const state = buildJevState({ ...input, profileContext: "[film] 片单A: A > B" });
    expect(state).toContain("【用户品味档案】");
    expect(state).toContain("[film] 片单A: A > B");
    expect(state).toContain("「豆瓣高分片单」");
    expect(state).toContain("1. 《盗梦空间》(2010,创作者:克里斯托弗·诺兰)");
    expect(state).toContain("2. 《霸王别姬》(1993)");
  });
  it("无品味档案时不输出该段;英文 locale 输出英文句式", () => {
    expect(buildJevState(input)).not.toContain("【用户品味档案】");
    const en = buildJevState({ ...input, locale: "en" });
    expect(en).toContain('1. "盗梦空间"');
  });
  it("每件作品一个 w{i} Noul 问题,含标题与评分说明", () => {
    const questions = buildJevQuestions(input);
    expect(Object.keys(questions)).toEqual(["w0", "w1"]);
    expect(questions.w0.type).toBe("noul");
    expect(questions.w0.instructions).toContain("盗梦空间");
    expect(questions.w0.instructions).toContain("0 = ");
  });
  it("state 文本把换行/多余空白压平,防注入排版", () => {
    const state = buildJevState({ ...input, works: [{ title: "a\n\nb  c" }] });
    expect(state).toContain("《a b c》");
  });
});
```

- [ ] **Step 1.5:实现组装函数(追加到 typesafe.ts)**

```ts
const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function buildJevState(input: JevRankInput): string {
  const zh = (input.locale ?? "zh") === "zh";
  const label = KIND_LABELS[input.kind];
  const lines: string[] = [];
  if (input.profileContext) lines.push(`【用户品味档案】\n${clean(input.profileContext, 4096)}`);
  lines.push(
    zh
      ? `【当前清单】「${clean(input.collectionTitle, 160)}」(${label},共 ${input.works.length} 件)`
      : `【List】"${clean(input.collectionTitle, 160)}" (${label}, ${input.works.length} works)`,
    zh ? "清单内全部作品如下(与顺序无关):" : "All works in this list (order is irrelevant):",
  );
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const year = work.year ? `(${work.year})` : "";
    const creator = work.creator
      ? zh
        ? `,创作者:${clean(work.creator, 120)}`
        : `, by ${clean(work.creator, 120)}`
      : "";
    const item = zh ? `${index + 1}. 《${title}》${year}${creator}` : `${index + 1}. "${title}"${year}${creator}`;
    lines.push(item);
  });
  return lines.join("\n");
}

export function buildJevQuestions(
  input: JevRankInput,
): Record<string, { type: "noul"; instructions: string }> {
  const zh = (input.locale ?? "zh") === "zh";
  const kindLabel = KIND_LABELS[input.kind];
  const questions: Record<string, { type: "noul"; instructions: string }> = {};
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const meta = [
      work.year ? String(work.year) : "",
      work.creator ? clean(work.creator, 120) : "",
    ]
      .filter(Boolean)
      .join(", ");
    questions[`w${index}`] = {
      type: "noul",
      instructions: zh
        ? `这位用户会有多喜欢这部${kindLabel}(0 = 完全不会保留,1 = 一定会排在最前)?《${title}》${meta ? `(${meta})` : ""}`
        : `How much would this user enjoy this work (0 = would not keep it, 1 = would rank it at the very top)? "${title}"${meta ? ` (${meta})` : ""}`,
    };
  });
  return questions;
}
```

- [ ] **Step 1.6:运行测试通过**

Run: `npx vitest run worker/typesafe.test.ts`
Expected: PASS

- [ ] **Step 1.7:Commit**

```bash
git add worker/typesafe.ts worker/typesafe.test.ts
git commit --no-gpg-sign -m "feat(jev): worker client — config validation and state/questions builders"
```

---

## Task 2: Worker 端 Jev 客户端——上游调用与排序

**Files:**
- Modify: `worker/typesafe.ts`
- Modify: `worker/typesafe.test.ts`

- [ ] **Step 2.1:写失败测试(排序/错误映射/body 解析)**

```ts
const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init),
  ) as unknown as typeof fetch;

const okResponse = (overrides: Record<string, { noul: number }>) =>
  new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: Object.fromEntries(
        Object.entries(overrides).map(([key, value]) => [key, { type: "noul", noul: value.noul }]),
      ),
      usage: { input_tokens: 392 },
    }),
    { status: 200 },
  );

describe("jevRank", () => {
  it("按 noul 降序返回 order/scores,同分保持原序;URL 与鉴权头正确", async () => {
    const fetchImpl = stubFetch((_url, init) => {
      expect(String(_url)).toBe("https://api.typesafe.ai/v1/systemone");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ts_key12345");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("jev-latest");
      expect(Object.keys(body.questions)).toEqual(["w0", "w1", "w2"]);
      return okResponse({ w0: { noul: 0.5 }, w1: { noul: 0.9 }, w2: { noul: 0.5 } });
    });
    const result = await jevRank(
      { ...input, works: [...input.works, { title: "第三部" }] },
      { apiKey: "ts_key12345" },
      fetchImpl,
    );
    expect(result.order).toEqual([1, 0, 2]); // w1 最高;w0/w2 同分按原序
    expect(result.scores).toEqual([0.9, 0.5, 0.5]);
    expect(result.model).toBe("jev-1.13.0");
    expect(result.inputTokens).toBe(392);
  });

  it("缺答案的作品按 0 分垫底", async () => {
    const fetchImpl = stubFetch(() => okResponse({ w1: { noul: 0.4 } }));
    const result = await jevRank(input, { apiKey: "ts_key12345" }, fetchImpl);
    expect(result.order).toEqual([1, 0]);
  });

  it("401 → upstream_auth_failed;429 → upstream_rate_limited;500 → upstream_error", async () => {
    const auth = stubFetch(() => new Response("no", { status: 401 }));
    await expect(jevRank(input, { apiKey: "ts_key12345" }, auth)).rejects.toMatchObject({
      code: "upstream_auth_failed",
    });
    const limit = stubFetch(() => new Response("no", { status: 429 }));
    await expect(jevRank(input, { apiKey: "ts_key12345" }, limit)).rejects.toMatchObject({
      code: "upstream_rate_limited",
    });
    const boom = stubFetch(() => new Response("no", { status: 500 }));
    await expect(jevRank(input, { apiKey: "ts_key12345" }, boom)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("works 数量越界直接拒绝,不发起上游调用", async () => {
    const fetchImpl = stubFetch(() => okResponse({}));
    const tooMany = { ...input, works: Array.from({ length: 256 }, () => ({ title: "x" })) };
    await expect(jevRank(tooMany, { apiKey: "ts_key12345" }, fetchImpl)).rejects.toMatchObject({
      code: "invalid_data",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("parseJevRankBody", () => {
  it("合法 body 全量通过;非法 kind/works/超长 profileContext 返回 null", () => {
    expect(parseJevRankBody({ kind: "film", collectionTitle: "片单", works: [{ title: "A" }] })?.works.length).toBe(1);
    expect(parseJevRankBody({ kind: "spam", collectionTitle: "片单", works: [{ title: "A" }] })).toBeNull();
    expect(parseJevRankBody({ kind: "film", collectionTitle: "", works: [{ title: "A" }] })).toBeNull();
    expect(parseJevRankBody({ kind: "film", collectionTitle: "片单", works: "nope" })).toBeNull();
    expect(
      parseJevRankBody({ kind: "film", collectionTitle: "片单", works: [{ title: "A" }], profileContext: "x".repeat(4097) }),
    ).toBeNull();
  });
});

describe("testJevConnection", () => {
  it("ping 问题返回数值即成功并回显模型", async () => {
    const fetchImpl = stubFetch(() => okResponse({ ping: { noul: 1 } }));
    await expect(testJevConnection({ apiKey: "ts_key12345" }, fetchImpl)).resolves.toEqual({
      ok: true,
      model: "jev-1.13.0",
    });
  });
  it("响应畸形报 upstream_error", async () => {
    const fetchImpl = stubFetch(() => new Response(JSON.stringify({ answers: {} }), { status: 200 }));
    await expect(testJevConnection({ apiKey: "ts_key12345" }, fetchImpl)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
```

- [ ] **Step 2.2:运行确认失败**

Run: `npx vitest run worker/typesafe.test.ts`
Expected: FAIL(jevRank/parseJevRankBody/testJevConnection not defined)

- [ ] **Step 2.3:实现调用、解析、排序与 body 解析(追加到 typesafe.ts)**

```ts
interface SystemOneResponse {
  model?: string;
  answers?: Record<string, { type?: string; noul?: number }>;
  usage?: { input_tokens?: number };
}

async function callSystemOne(
  payload: unknown,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<SystemOneResponse> {
  let response: Response;
  try {
    response = await fetchBounded(
      SYSTEMONE_URL,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      // 上游域名固定、非用户可控:精确白名单 + 30s 超时 + 1MB 响应上限。
      { allowedHosts: ["api.typesafe.ai"], maxBytes: MAX_RESPONSE_BYTES, timeoutMs: 30_000, maxRedirects: 2 },
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof OutboundError && error.code === "timeout")
      throw new AiError("upstream_error", 504, "Jev upstream timeout");
    throw new AiError("upstream_error", 502, "Jev upstream unreachable");
  }
  if (response.status === 401 || response.status === 403)
    throw new AiError("upstream_auth_failed", 502, "TypeSafe API key rejected");
  if (response.status === 429)
    throw new AiError("upstream_rate_limited", 502, "TypeSafe rate limited");
  if (!response.ok) throw new AiError("upstream_error", 502, `Jev upstream ${response.status}`);
  return (await readBoundedJson(response, MAX_RESPONSE_BYTES)) as SystemOneResponse;
}

export async function jevRank(
  input: JevRankInput,
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JevRankResult> {
  if (!Array.isArray(input.works) || input.works.length < 1 || input.works.length > 255)
    throw new AiError("invalid_data", 400, "works must contain 1-255 items");
  const payload = {
    model: "jev-latest",
    state: buildJevState(input),
    questions: buildJevQuestions(input),
  };
  const body = await callSystemOne(payload, config.apiKey, fetchImpl);
  const answers = body.answers ?? {};
  // 缺答案按 0 分垫底(而不是整单失败):单作品评估互不影响,个别缺失
  // 不应否定其余作品的排序。
  const scored = input.works.map((_, index) => {
    const score = answers[`w${index}`]?.noul;
    return { index, score: typeof score === "number" && score >= 0 && score <= 1 ? score : 0 };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    model: typeof body.model === "string" ? body.model : "jev",
    order: scored.map((entry) => entry.index),
    scores: scored.map((entry) => entry.score),
    inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
  };
}

export async function testJevConnection(
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; model: string }> {
  const body = await callSystemOne(
    {
      model: "jev-latest",
      state: "This is a connectivity test.",
      questions: { ping: { type: "noul", instructions: "Is this text a connectivity test?" } },
    },
    config.apiKey,
    fetchImpl,
  );
  if (typeof body.answers?.ping?.noul !== "number")
    throw new AiError("upstream_error", 502, "Jev response malformed");
  return { ok: true, model: typeof body.model === "string" ? body.model : "jev" };
}

export function parseJevRankBody(body: Record<string, unknown>): JevRankInput | null {
  if (typeof body.kind !== "string" || !(body.kind in KIND_LABELS)) return null;
  if (typeof body.collectionTitle !== "string" || !body.collectionTitle.trim() || body.collectionTitle.length > 160)
    return null;
  if (!Array.isArray(body.works) || body.works.length < 1 || body.works.length > 255) return null;
  const works: JevWorkInput[] = [];
  for (const raw of body.works) {
    if (typeof raw !== "object" || raw === null) return null;
    const work = raw as Record<string, unknown>;
    if (typeof work.title !== "string" || !work.title.trim() || work.title.length > 200) return null;
    works.push({
      title: work.title,
      ...(typeof work.creator === "string" && work.creator ? { creator: work.creator.slice(0, 160) } : {}),
      ...(typeof work.year === "number" && Number.isFinite(work.year) ? { year: Math.trunc(work.year) } : {}),
    });
  }
  if (
    body.profileContext !== undefined &&
    (typeof body.profileContext !== "string" || body.profileContext.length > 4096)
  )
    return null;
  if (body.locale !== undefined && body.locale !== "zh" && body.locale !== "en") return null;
  return {
    kind: body.kind as JevKind,
    collectionTitle: body.collectionTitle,
    works,
    ...(typeof body.profileContext === "string" && body.profileContext
      ? { profileContext: body.profileContext }
      : {}),
    ...(body.locale === "en" ? { locale: "en" as const } : {}),
  };
}
```

- [ ] **Step 2.4:运行测试通过**

Run: `npx vitest run worker/typesafe.test.ts`
Expected: PASS(全部)

- [ ] **Step 2.5:Commit**

```bash
git add worker/typesafe.ts worker/typesafe.test.ts
git commit --no-gpg-sign -m "feat(jev): upstream call, score ranking, body parsing with error mapping"
```

---

## Task 3: Worker 路由 `/api/ai/jev/test` 与 `/api/ai/jev-rank`

**Files:**
- Modify: `worker/index.ts`(桶联合类型 ~184-204;路由区插入在 `/api/ai/test` 块之后,~2492)

- [ ] **Step 3.1:限流桶加入联合类型**

在 `allowUpstreamRequest` 的 bucket 联合类型(index.ts ~184-204)中追加两个成员:

```ts
    | "ai_jev"
    | "ai_jev_test"
```

- [ ] **Step 3.2:import 新符号**

index.ts 顶部 `from "./ai"` 的既有 import 块不动;新增:

```ts
import { jevRank, parseJevRankBody, testJevConnection, validateJevConfig } from "./typesafe";
```

- [ ] **Step 3.3:插入路由块(紧跟 `/api/ai/test` 块之后,照同一模板)**

```ts
  if (url.pathname === "/api/ai/jev/test" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_test", 5)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateJevConfig(body.config);
    if (!config)
      return json({ ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" }, 400);
    try {
      return json(await testJevConnection(config));
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }

  if (url.pathname === "/api/ai/jev-rank" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev", 10)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateJevConfig(body.config);
    if (!config)
      return json({ ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" }, 400);
    const parsed = parseJevRankBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "作品数据不合法" }, 400);
    try {
      const result = await jevRank(parsed, config);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
```

要点(来自现有代码勘察):`assertSameOrigin` 必须是块内第一句(它 throw 而非 return,由顶层 catch 转 403);429 的 `retry-after: 600` 对齐 10 分钟窗口;body 大小由 `readJson` 内建 48KB 上限把守,无需额外 payloadGuard(项目无此符号)。

- [ ] **Step 3.4:类型检查**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3.5:Commit**

```bash
git add worker/index.ts
git commit --no-gpg-sign -m "feat(jev): /api/ai/jev/test + /api/ai/jev-rank routes with ai_jev rate buckets"
```

---

## Task 4: 前端客户端 `src/lib/typesafe.ts`

**Files:**
- Create: `src/lib/typesafe.ts`
- Create: `src/lib/typesafe.test.ts`

- [ ] **Step 4.1:写失败测试**

`src/lib/typesafe.test.ts`(localStorage stub 照抄 `aiInsight.test.ts` 头部的内存实现):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTasteContext,
  clearTypesafeConfig,
  jevFailureText,
  readTypesafeConfig,
  writeTypesafeConfig,
} from "./typesafe";

// node 环境没有 localStorage:与 aiInsight.test.ts 同款内存实现。
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe("配置存取", () => {
  it("写入后可读回;损坏数据返回 null;clear 移除", () => {
    expect(readTypesafeConfig()).toBeNull();
    writeTypesafeConfig({ apiKey: "ts_key12345" });
    expect(readTypesafeConfig()).toEqual({ apiKey: "ts_key12345" });
    store.set("art-rank:typesafe-config", "{oops");
    expect(readTypesafeConfig()).toBeNull();
    clearTypesafeConfig();
    expect(store.has("art-rank:typesafe-config")).toBe(false);
  });
});

describe("buildTasteContext", () => {
  it("按榜单压成 `[kind] 标题: A > B` 行,截断到上限", () => {
    const context = buildTasteContext([
      { kind: "film", collectionTitle: "片单A", items: [{ title: "A" }, { title: "B" }] },
      { kind: "music", collectionTitle: "歌单B", items: [{ title: "C" }] },
    ]);
    expect(context).toBe("[film] 片单A: A > B\n[music] 歌单B: C");
    expect(buildTasteContext([], 1).length).toBeLessThanOrEqual(1);
  });
  it("单榜单只取前 20 件", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `作品${i}` }));
    const context = buildTasteContext([{ kind: "film", collectionTitle: "X", items: many }]);
    expect(context).not.toContain("作品20");
  });
});

describe("jevFailureText", () => {
  it("优先透出服务端 msg,否则按错误码给双语默认", () => {
    const t = (zh: string) => zh;
    expect(jevFailureText({ ok: false, error: "upstream_error", msg: "上游炸了" }, t)).toBe("上游炸了");
    expect(jevFailureText({ ok: false, error: "upstream_auth_failed" }, t)).toContain("Key");
  });
});
```

- [ ] **Step 4.2:运行确认失败**

Run: `npx vitest run src/lib/typesafe.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 4.3:实现前端客户端**

`src/lib/typesafe.ts`:

```ts
/**
 * Jev(TypeSafe)前端调用层:配置存取 + AI 快排请求。
 * 与 aiInsight.ts 同一原则:配置只存本浏览器 localStorage;请求经同源
 * Worker 转发(Worker 不落盘 key);保留失败原因,不折叠成 null。
 */

export type JevErrorCode =
  | "invalid_config"
  | "invalid_data"
  | "rate_limited"
  | "upstream_auth_failed"
  | "upstream_rate_limited"
  | "upstream_error"
  | "unavailable";

export interface JevUserConfig {
  apiKey: string;
}

const CONFIG_KEY = "art-rank:typesafe-config";

export function readTypesafeConfig(): JevUserConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const cfg = raw as Record<string, unknown>;
    return typeof cfg.apiKey === "string" && cfg.apiKey ? { apiKey: cfg.apiKey } : null;
  } catch {
    return null;
  }
}

/** 返回 false 表示浏览器存储不可用(隐私模式),调用方应提示「仅本次会话有效」。 */
export function writeTypesafeConfig(config: JevUserConfig): boolean {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clearTypesafeConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* 隐私模式 */
  }
}

/** 把已有榜单压成紧凑品味档案:每榜单一行 `[kind] 标题: 前二十名 > 分隔`,总长截断。 */
export function buildTasteContext(
  rankings: Array<{ kind: string; collectionTitle: string; items: Array<{ title: string }> }>,
  max = 4096,
): string {
  const lines = rankings.map((ranking) =>
    `[${ranking.kind}] ${ranking.collectionTitle}: ${ranking.items
      .slice(0, 20)
      .map((item) => item.title)
      .join(" > ")}`,
  );
  return lines.join("\n").slice(0, max);
}

export interface JevRankInput {
  kind: string;
  collectionTitle: string;
  works: Array<{ id: string; title: string; creator?: string; year?: number }>;
  profileContext?: string;
  locale: "zh" | "en";
}

export interface JevRankSuccess {
  ok: true;
  model: string;
  /** works 数组的下标,按预测分降序;前端自行映射回作品 id。 */
  order: number[];
  scores: number[];
  inputTokens: number;
}
export interface JevFailure {
  ok: false;
  error: JevErrorCode;
  msg?: string;
}
export type JevRankResult = JevRankSuccess | JevFailure;

function failureFrom(response: Response, body: { error?: unknown; msg?: unknown } | null): JevFailure {
  const code = typeof body?.error === "string" ? (body.error as JevErrorCode) : "unavailable";
  return { ok: false, error: code, ...(typeof body?.msg === "string" ? { msg: body.msg } : {}) };
}

export async function testJevConfig(
  config: JevUserConfig,
): Promise<{ ok: true; model: string } | JevFailure> {
  try {
    const response = await fetch("/api/ai/jev/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(40000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && typeof body?.model === "string")
      return { ok: true, model: body.model };
    return failureFrom(response, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function requestJevRanking(
  input: JevRankInput,
  config: JevUserConfig,
): Promise<JevRankResult> {
  try {
    const response = await fetch("/api/ai/jev-rank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, config }),
      signal: AbortSignal.timeout(40000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      response.ok &&
      body?.ok === true &&
      Array.isArray(body.order) &&
      Array.isArray(body.scores)
    ) {
      return {
        ok: true,
        model: typeof body.model === "string" ? body.model : "jev",
        order: (body.order as unknown[]).filter((n): n is number => typeof n === "number"),
        scores: (body.scores as unknown[]).filter((n): n is number => typeof n === "number"),
        inputTokens: typeof body.inputTokens === "number" ? body.inputTokens : 0,
      };
    }
    return failureFrom(response, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

const FAILURE_MESSAGES: Record<JevErrorCode, [string, string]> = {
  invalid_config: ["TypeSafe API Key 不合法,请到「AI 服务」重新配置", "Invalid TypeSafe API key — reconfigure in AI services"],
  invalid_data: ["作品数据不合法", "Invalid work data"],
  rate_limited: ["操作太频繁,请几分钟后再试", "Too many attempts — retry in a few minutes"],
  upstream_auth_failed: ["TypeSafe API Key 被拒绝,请检查 key", "TypeSafe API key rejected — check the key"],
  upstream_rate_limited: ["Jev 服务限流,请稍后再试", "Jev is rate-limited — retry later"],
  upstream_error: ["Jev 服务暂时不可用,请稍后再试", "Jev is temporarily unavailable"],
  unavailable: ["AI 快排暂时不可用,请稍后再试", "AI quick rank is unavailable right now"],
};

export function jevFailureText(failure: JevFailure, t: (zh: string, en: string) => string): string {
  if (failure.msg) return failure.msg;
  const [zh, en] = FAILURE_MESSAGES[failure.error] ?? FAILURE_MESSAGES.unavailable;
  return t(zh, en);
}
```

- [ ] **Step 4.4:运行测试通过**

Run: `npx vitest run src/lib/typesafe.test.ts`
Expected: PASS

- [ ] **Step 4.5:Commit**

```bash
git add src/lib/typesafe.ts src/lib/typesafe.test.ts
git commit --no-gpg-sign -m "feat(jev): frontend client — config storage, ranking request, failure mapping"
```

---

## Task 5: useSorting 的 `startJevRanking` + SetupView 按钮 + App 接线

**Files:**
- Modify: `src/lib/useSorting.ts`(~96 state 区、~339 saveWithoutSortingFn 之后、~823 返回对象)
- Modify: `src/views/types.ts:88`(SetupViewProps)
- Modify: `src/views/SetupView.tsx`
- Modify: `src/App.tsx`(~1142 SetupView 接线)

- [ ] **Step 5.1:useSorting 增加 state 与函数**

imports 追加:

```ts
import { buildTasteContext, jevFailureText, readTypesafeConfig, requestJevRanking } from "./typesafe";
```

state 区(`const [seed, setSeed] = useState("")` 附近)追加:

```ts
const [jevBusy, setJevBusy] = useState(false);
```

`saveWithoutSortingFn` 之后追加(落库路径刻意与其一致):

```ts
/** AI 快排(Jev):把选中作品交给决策模型预测完整顺序,直接成榜。
 *  落库路径与 saveWithoutSortingFn 完全一致,只是顺序来自 Jev 预测。 */
async function startJevRanking() {
  const d = depsRef.current;
  if (!collection || selected.length < 2 || jevBusy) return;
  const config = readTypesafeConfig();
  if (!config) {
    d.setNotice(
      d.t(
        "先在「设置 → AI 服务」里配置 TypeSafe API Key,再使用 AI 快排。",
        "Configure a TypeSafe API key under Settings → AI services first.",
      ),
    );
    return;
  }
  const kept = collection.works.filter((work) => selected.includes(work.id));
  setJevBusy(true);
  track("jev_rank_started", { mode: kind, item_count: kept.length });
  try {
    const profile = d.getProfile();
    const result = await requestJevRanking(
      {
        kind: collection.kind,
        collectionTitle: collection.title,
        works: kept.map((work) => ({
          id: work.id,
          title: work.title,
          ...(work.creator ? { creator: work.creator } : {}),
          ...(work.year ? { year: work.year } : {}),
        })),
        ...(profile ? { profileContext: buildTasteContext(profile.rankings) } : {}),
        locale: d.locale === "en" ? "en" : "zh",
      },
      config,
    );
    if (!result.ok) {
      d.setNotice(jevFailureText(result, d.t));
      return;
    }
    // order 是 works 数组下标(Jev 侧只回传数字,规避标题注入与 id 字符集问题)。
    const byIndex = new Map(kept.map((work, index) => [index, work]));
    const ordered = result.order
      .map((index) => byIndex.get(index))
      .filter((work): work is (typeof kept)[number] => Boolean(work));
    // 唯一可落库形状 + identity 去重,与 saveWithoutSortingFn 同口径。
    const items = toRankedItems(ordered.map((work, i) => ({ ...work, rank: i + 1 })));
    const ranking: RankingExport = {
      version: 1,
      profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
      profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
      kind: collection.kind,
      collectionTitle: collection.title,
      createdAt: new Date().toISOString(),
      items,
    };
    d.persist(mergeRanking(d.getProfile(), ranking));
    d.setActiveKind(collection.kind);
    d.setNotice(
      d.t(
        `AI 快排完成:Jev 依据你的历史取舍预测了 ${items.length} 件作品的顺序(模型 ${result.model});可在榜单页「手动调整」。`,
        `AI quick rank done: Jev predicted the order of ${items.length} works from your history (model ${result.model}); "Reorder" anytime.`,
      ),
    );
    d.navigateTo("profile");
    track("jev_rank_completed", {
      mode: kind,
      item_count: items.length,
      model: result.model,
      input_tokens: result.inputTokens,
    });
  } catch {
    d.setNotice(d.t("AI 快排暂时不可用,请稍后再试。", "AI quick rank is unavailable right now."));
  } finally {
    setJevBusy(false);
  }
}
```

返回对象(`saveWithoutSorting: saveWithoutSortingFn,` 附近)追加:

```ts
startJevRanking,
jevBusy,
```

- [ ] **Step 5.2:SetupViewProps 增两项**

`src/views/types.ts` SetupViewProps(`saveWithoutSorting: () => void;` 之后):

```ts
  startJevRanking: () => void;
  jevBusy: boolean;
```

- [ ] **Step 5.3:SetupView 第三个动作按钮**

imports 改为 `import { Play, Save, Sparkles } from "lucide-react";`;props 解构加 `startJevRanking, jevBusy`;「仅保存不排序」按钮之后追加:

```tsx
          <button
            className="button secondary"
            disabled={selected.length < 2 || !collection.title.trim() || jevBusy}
            onClick={startJevRanking}
          >
            <Sparkles size={16} />
            {jevBusy ? t("排序中…", "Ranking…") : t("AI 快排", "AI quick rank")}
          </button>
```

- [ ] **Step 5.4:App.tsx 接线**

`useSorting()` 解构区(`saveWithoutSorting,` 旁)加 `startJevRanking, jevBusy,`;SetupView JSX(`saveWithoutSorting={saveWithoutSorting}` 之后)加:

```tsx
        startJevRanking={startJevRanking}
        jevBusy={jevBusy}
```

- [ ] **Step 5.5:类型检查 + 全量测试 + 手动冒烟**

Run: `npm run check && npm test`
Expected: 全绿

Run: `npm run dev` → 准备页应出现第三个按钮;未配置 key 时点击提示去配置。

- [ ] **Step 5.6:Commit**

```bash
git add src/lib/useSorting.ts src/views/types.ts src/views/SetupView.tsx src/App.tsx
git commit --no-gpg-sign -m "feat(ui): AI quick rank action on setup — Jev-predicted full ordering"
```

---

## Task 6: AiConfigDialog 的 Jev 小节

**Files:**
- Modify: `src/components/AiConfigDialog.tsx`(~1 imports、~47 state、~321 小节插入)

- [ ] **Step 6.1:state 与处理函数**

imports 追加:

```ts
import { Sparkles } from "lucide-react";
import {
  readTypesafeConfig,
  testJevConfig,
  writeTypesafeConfig,
  jevFailureText,
} from "../lib/typesafe";
```

组件 state 区追加:

```ts
  const existingJev = readTypesafeConfig();
  const [jevKey, setJevKey] = useState(existingJev?.apiKey ?? "");
  const [jevTestBusy, setJevTestBusy] = useState(false);
  const [jevMessage, setJevMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canSaveJev = jevKey.trim().length >= 8;
```

处理函数(组件内,`save()` 之后):

```ts
  async function runJevTest() {
    if (!canSaveJev || jevTestBusy) return;
    setJevTestBusy(true);
    setJevMessage(null);
    const result = await testJevConfig({ apiKey: jevKey.trim() });
    setJevTestBusy(false);
    setJevMessage(
      result.ok
        ? { ok: true, text: t(`连接成功(模型:${result.model})`, `Connected (model: ${result.model})`) }
        : { ok: false, text: jevFailureText(result, t) },
    );
  }

  function saveJev() {
    if (!canSaveJev) return;
    const stored = writeTypesafeConfig({ apiKey: jevKey.trim() });
    setJevMessage({
      ok: stored,
      text: stored
        ? t("Jev Key 已保存到本浏览器", "Jev key saved to this browser")
        : t("浏览器存储不可用(隐私模式):本次会话有效,刷新后需重填", "Storage unavailable (private mode): valid for this session only"),
    });
  }
```

- [ ] **Step 6.2:小节 JSX(插在 `mini-note` 段之后、`guide-modal-footer` 之前)**

```tsx
          <div className="rank-menu-sep" style={{ margin: "16px 0" }} />
          <div className="section-heading" style={{ marginBottom: 10 }}>
            <div>
              <span className="eyebrow">Jev</span>
              <h2 style={{ fontSize: 17 }}>{t("Jev 快排(TypeSafe)", "Jev quick rank (TypeSafe)")}</h2>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 10 }}>
            {t(
              "用于准备页的「AI 快排」:决策模型依据你的历史取舍预测整份榜单顺序。只需 API Key,在 console.typesafe.ai 申请;Key 仅保存在本浏览器。",
              "Powers \"AI quick rank\" on the prepare page: a decision model predicts the whole ranking from your history. Key only — get one at console.typesafe.ai; stored in this browser only.",
            )}
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              type={showKey ? "text" : "password"}
              value={jevKey}
              onChange={(event) => setJevKey(event.target.value)}
              placeholder="ts-…"
              spellCheck={false}
              style={{ flex: 1 }}
              aria-label={t("TypeSafe API Key", "TypeSafe API key")}
            />
            <button
              className="button secondary"
              disabled={!canSaveJev || jevTestBusy}
              onClick={() => void runJevTest()}
              style={{ minHeight: 36, paddingInline: 10, fontSize: 12 }}
            >
              <Sparkles size={14} />
              {jevTestBusy ? t("测试中…", "Testing…") : t("测试", "Test")}
            </button>
            <button
              className="button secondary"
              disabled={!canSaveJev}
              onClick={saveJev}
              style={{ minHeight: 36, paddingInline: 10, fontSize: 12 }}
            >
              <Check size={14} />
              {t("保存 Key", "Save key")}
            </button>
          </div>
          {jevMessage && (
            <p
              style={{
                fontSize: 12,
                margin: "0 0 4px",
                color: jevMessage.ok ? "var(--green)" : "var(--red)",
                lineHeight: 1.6,
                overflowWrap: "anywhere",
              }}
            >
              {jevMessage.text}
            </p>
          )}
```

(复用既有 `showKey` 显隐态、`label`/`button secondary`/`rank-menu-sep` 样式;小节独立「保存 Key」,不改动现有 AI 配置的保存行为。)

- [ ] **Step 6.3:类型检查 + 测试 + 冒烟**

Run: `npm run check && npm test`
Run: `npm run dev` → 设置 → AI 服务:可见 Jev 小节,存入假 key 后「测试」应显示「Key 被拒绝」类错误文案(真实 key 才会通)。

- [ ] **Step 6.4:Commit**

```bash
git add src/components/AiConfigDialog.tsx
git commit --no-gpg-sign -m "feat(ui): Jev key section in AI config dialog — save/test, browser-only storage"
```

---

## Task 7: 文档回写 + 全量验证 + 推送

**Files:**
- Modify: `docs/API.md`(AI 服务节新增两个端点)
- Modify: `docs/ROADMAP.md`(Phase 1 标记已完成并链接本计划)

- [ ] **Step 7.1:API.md 增端点文档**

在 AI 服务相关小节追加(沿用该文档的请求/响应/错误格式):

```markdown
### POST /api/ai/jev/test

TypeSafe(Jev)连接测试。请求体 `{ "config": { "apiKey": "ts-…" } }`;成功 `{ "ok": true, "model": "jev-1.13.0" }`。限流 5 次/10 分钟(按 IP)。

### POST /api/ai/jev-rank

AI 快排:一次 systemone 调用(state + 每件作品一个 Noul 问题)对最多 255 件作品打 0–1 分并降序返回。请求体 `{ "kind", "collectionTitle", "works": [{ "id", "title", "creator?", "year?" }], "profileContext?", "locale", "config": { "apiKey" } }`;成功 `{ "ok": true, "model", "order": [下标], "scores": [0-1], "inputTokens" }`。错误沿用 AI 错误码(`invalid_config`/`invalid_data`/`rate_limited`/`upstream_*`)。限流 10 次/10 分钟(按 IP)。Key 由前端透传,服务端不存储。
```

- [ ] **Step 7.2:ROADMAP.md Phase 1 状态回写**

把「### Phase 1:AI 快排(已批准,进行中)」改为「(已实施,详见 `docs/PLAN-AI-QUICK-RANK.md`)」。

- [ ] **Step 7.3:全量验证**

```bash
npm run check && npm test && npm run build && npx prettier --check src worker docs
```
Expected: 全绿

- [ ] **Step 7.4:推送部署 + 线上降级验证**

```bash
git push origin main
```
部署后线上验证(无 key 路径,浏览器):设置 → AI 服务出现 Jev 小节;准备页出现「AI 快排」按钮;未配 key 点击 → notice 提示去配置;配任意 ≥8 字符假 key 点击 → notice 报「Key 被拒绝」。真实排序效果需用户申请正式 key 后自测。

- [ ] **Step 7.5:Commit**

```bash
git add docs/API.md docs/ROADMAP.md
git commit --no-gpg-sign -m "docs: jev-rank endpoints + Phase 1 status"
```

---

## 执行方式

- **子代理驱动**:每 Task 派发独立 subagent,任务间审查(注意本会话此前出现过并发配额限制,失败时退回内联);
- **内联执行**(推荐,本次采用):在当前会话按 Task 顺序执行,每 Task 一个 commit,检查点自查。
