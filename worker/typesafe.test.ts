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

// ===== Task 2:上游调用与排序 =====

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
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
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
    expect(
      parseJevRankBody({ kind: "film", collectionTitle: "片单", works: [{ title: "A" }] })?.works
        .length,
    ).toBe(1);
    expect(
      parseJevRankBody({ kind: "spam", collectionTitle: "片单", works: [{ title: "A" }] }),
    ).toBeNull();
    expect(
      parseJevRankBody({ kind: "film", collectionTitle: "", works: [{ title: "A" }] }),
    ).toBeNull();
    expect(parseJevRankBody({ kind: "film", collectionTitle: "片单", works: "nope" })).toBeNull();
    expect(
      parseJevRankBody({
        kind: "film",
        collectionTitle: "片单",
        works: [{ title: "A" }],
        profileContext: "x".repeat(4097),
      }),
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
    const fetchImpl = stubFetch(
      () => new Response(JSON.stringify({ answers: {} }), { status: 200 }),
    );
    await expect(testJevConnection({ apiKey: "ts_key12345" }, fetchImpl)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
