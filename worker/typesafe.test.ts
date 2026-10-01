import { describe, expect, it, vi } from "vitest";
import {
  buildJevQuestions,
  buildJevState,
  jevChoose,
  jevPick,
  jevRank,
  parseJevChooseBody,
  parseJevPickBody,
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

// ===== Phase 5:1v1 取舍预测 =====

const pickResponse = (
  choice: string,
  confidence: number,
  probabilities: Record<string, number>,
  answerKey = "pick",
) =>
  new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        [answerKey]: { type: "choice", choice, confidence, probabilities },
      },
      usage: { input_tokens: 120 },
    }),
    { status: 200 },
  );

describe("jevPick", () => {
  const input = {
    kind: "film" as const,
    left: { title: "盗梦空间", year: 2010 },
    right: { title: "霸王别姬", year: 1993 },
    profileContext: "[film] 片单: A > B",
  };

  it("Choice 二选一:choice/confidence/probabilities 齐备", async () => {
    const fetchImpl = stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.questions.pick.type).toBe("choice");
      expect(body.questions.pick.criteria.left).toContain("盗梦空间");
      expect(body.questions.pick.criteria.right).toContain("霸王别姬");
      return pickResponse("left", 0.86, { left: 0.9, right: 0.1 });
    });
    const result = await jevPick(input, { apiKey: "ts_key12345" }, fetchImpl);
    expect(result).toEqual({
      model: "jev-1.13.0",
      pick: "left",
      confidence: 0.86,
      probabilities: { left: 0.9, right: 0.1 },
      inputTokens: 120,
    });
  });

  it("confidence 缺失时回退概率;choice 非法报 upstream_error", async () => {
    const fallback = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            model: "jev",
            answers: {
              pick: { type: "choice", choice: "right", probabilities: { left: 0.2, right: 0.8 } },
            },
          }),
          { status: 200 },
        ),
    );
    const result = await jevPick(input, { apiKey: "ts_key12345" }, fallback);
    expect(result.pick).toBe("right");
    expect(result.confidence).toBe(0.8);
    const bad = stubFetch(
      () =>
        new Response(JSON.stringify({ answers: { pick: { choice: "middle" } } }), { status: 200 }),
    );
    await expect(jevPick(input, { apiKey: "ts_key12345" }, bad)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});

describe("parseJevPickBody", () => {
  it("合法 body 通过;非法 kind/作品/超长上下文 → null", () => {
    const body = {
      kind: "film",
      left: { title: "A", year: 2001 },
      right: { title: "B" },
      profileContext: "x",
      locale: "zh",
    };
    expect(parseJevPickBody(body)?.left.title).toBe("A");
    expect(parseJevPickBody({ ...body, kind: "nope" })).toBeNull();
    expect(parseJevPickBody({ ...body, right: { title: "" } })).toBeNull();
    expect(parseJevPickBody({ ...body, profileContext: "x".repeat(4097) })).toBeNull();
  });
});

// ===== 迭代 2/20（PLAN-JEV-DISAMBIGUATION）：Choice 多选一，用于维基消歧 =====

describe("parseJevChooseBody", () => {
  const option = (key: string, description = "描述") => ({ key, description });
  const body = {
    question: "哪个候选才是《Journey》(2012)？",
    options: [option("dodge", "道奇Journey，克莱斯勒 SUV"), option("game", "风之旅人，独立游戏")],
    locale: "zh",
  };

  it("合法 body 通过：key 原样保留；locale 缺省时不落字段（zh 是默认值），en 才落", () => {
    const parsed = parseJevChooseBody(body);
    expect(parsed?.options.map((entry) => entry.key)).toEqual(["dodge", "game"]);
    // 与 parseJevPickBody / parseJevRankBody 同一约定：中文是默认，不占 payload
    expect(parsed?.locale).toBeUndefined();
    expect(parseJevChooseBody({ ...body, locale: "en" })?.locale).toBe("en");
  });

  it("description 压平空白并截到 400 字（防注入排版 + 防超长 payload）", () => {
    const parsed = parseJevChooseBody({
      ...body,
      options: [option("a", "  多\n行   空白  "), option("b", "x".repeat(500))],
    });
    expect(parsed?.options[0].description).toBe("多 行 空白");
    expect(parsed?.options[1].description).toHaveLength(400);
  });

  it("候选少于 2 项 / 多于 255 项 → null（1 项无从「选」，255 是 Choice 基数上限）", () => {
    expect(parseJevChooseBody({ ...body, options: [option("a")] })).toBeNull();
    const many = Array.from({ length: 256 }, (_, index) => option(`o${index}`));
    expect(parseJevChooseBody({ ...body, options: many })).toBeNull();
    expect(parseJevChooseBody({ ...body, options: many.slice(0, 255) })).not.toBeNull();
  });

  it("key 非法（空/超长/含空白与斜杠）或重复 → null（key 要能原样回传给前端）", () => {
    expect(parseJevChooseBody({ ...body, options: [option(""), option("b")] })).toBeNull();
    expect(
      parseJevChooseBody({ ...body, options: [option("x".repeat(65)), option("b")] }),
    ).toBeNull();
    expect(parseJevChooseBody({ ...body, options: [option("a b"), option("c")] })).toBeNull();
    expect(parseJevChooseBody({ ...body, options: [option("a/b"), option("c")] })).toBeNull();
    expect(parseJevChooseBody({ ...body, options: [option("dup"), option("dup")] })).toBeNull();
  });

  it("question 缺失/超长 2000、description 非字符串、locale 非法 → null", () => {
    expect(parseJevChooseBody({ ...body, question: "" })).toBeNull();
    expect(parseJevChooseBody({ ...body, question: "q".repeat(2001) })).toBeNull();
    expect(
      parseJevChooseBody({ ...body, options: [option("a"), { key: "b", description: 7 }] }),
    ).toBeNull();
    expect(parseJevChooseBody({ ...body, locale: "fr" })).toBeNull();
  });
});

describe("jevChoose", () => {
  const input = {
    question: "用户清单里写的是《Journey》(2012)，哪个候选才是它？",
    options: [
      { key: "dodge", description: "道奇Journey，克莱斯勒品牌旗下的一款中型SUV。" },
      { key: "game", description: "《风之旅人》，2012 年发布的冒险类独立游戏。" },
      { key: "band", description: "Journey，英國搖滾樂團。" },
    ],
  };

  it("多选一：choice/confidence/probabilities 齐备，criteria 覆盖全部候选 key", async () => {
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ts_key12345");
      const body = JSON.parse(String(init?.body));
      expect(body.state).toBe(input.question);
      expect(body.questions.which.type).toBe("choice");
      expect(Object.keys(body.questions.which.criteria)).toEqual(["dodge", "game", "band"]);
      return pickResponse("game", 0.91, { dodge: 0.03, game: 0.91, band: 0.06 }, "which");
    });
    const result = await jevChoose(input, { apiKey: "ts_key12345" }, fetchImpl);
    expect(result.pick).toBe("game");
    expect(result.confidence).toBe(0.91);
    expect(result.probabilities.band).toBe(0.06);
  });

  it("confidence 缺失时回退被选中项的概率；只保留入参里出现过的概率 key", async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            model: "jev",
            answers: {
              which: {
                type: "choice",
                choice: "band",
                probabilities: { band: 0.77, dodge: 0.1, ghost: 0.13 },
              },
            },
            usage: { input_tokens: 88 },
          }),
          { status: 200 },
        ),
    );
    const result = await jevChoose(input, { apiKey: "ts_key12345" }, fetchImpl);
    expect(result.confidence).toBe(0.77);
    // 上游多吐的 ghost 不认识，剔掉——前端只拿得到能对上条目的概率
    expect(result.probabilities).toEqual({ band: 0.77, dodge: 0.1 });
    expect(result.inputTokens).toBe(88);
  });

  it("上游吐出入参之外的 choice → upstream_error（模型幻觉不能当有效裁决）", async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            answers: { which: { type: "choice", choice: "not-a-candidate" } },
          }),
          { status: 200 },
        ),
    );
    await expect(jevChoose(input, { apiKey: "ts_key12345" }, fetchImpl)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("概率越界（负数/大于 1）不采信，且无任何合法概率时按 upstream_error 拒绝", async () => {
    const outOfRange = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            answers: {
              which: { type: "choice", choice: "game", probabilities: { game: 4.2 } },
            },
          }),
          { status: 200 },
        ),
    );
    await expect(jevChoose(input, { apiKey: "ts_key12345" }, outOfRange)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
