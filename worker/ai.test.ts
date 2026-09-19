import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callAi,
  callModelAuto,
  clearProtocolCache,
  composePrompt,
  constraintBlock,
  listAiModels,
  outputBlock,
  PROMPT_VERSION,
  resolveEndpoint,
  ROLE_BLOCK,
  TASK_BLOCK,
  testAiConnection,
  validateUserConfig,
  type AiConfig,
  type PromptSpec,
} from "./ai";

const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers });

const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init),
  ) as unknown as typeof fetch;

const spec = (user = "DATA"): PromptSpec => ({ version: PROMPT_VERSION, system: "SYS", user });

const baseConfig = (): AiConfig => ({
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test-123456",
  model: "test-model",
});

const resolvedFor = (protocol: "chat" | "responses" | "anthropic" | "gemini") => {
  const cfg = baseConfig();
  return {
    endpoint: resolveEndpoint(cfg.baseUrl, protocol, cfg.model),
    apiKey: cfg.apiKey,
    model: cfg.model,
    protocol,
  };
};

const rankingData = {
  profileName: "我的艺术人格",
  kind: "film",
  collectionTitle: "豆瓣 Top 50",
  itemCount: 3,
  works: [
    { rank: 1, title: "花样年华", creator: "王家卫", year: 2000 },
    { rank: 2, title: "活着" },
    { rank: 3, title: "千与千寻", creator: "宫崎骏", year: 2001 },
  ],
};

beforeEach(() => {
  clearProtocolCache();
});

// ===== 端点归一 =====

describe("resolveEndpoint", () => {
  it("chat：base 到 /v1 级别追加 /chat/completions", () => {
    expect(resolveEndpoint("https://api.openai.com/v1", "chat", "m")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });
  it("chat：base 已含完整路径时原样返回，尾部斜杠先清理", () => {
    expect(resolveEndpoint("https://x.com/v1/chat/completions/", "chat", "m")).toBe(
      "https://x.com/v1/chat/completions",
    );
  });
  it("responses：追加 /responses", () => {
    expect(resolveEndpoint("https://api.openai.com/v1", "responses", "m")).toBe(
      "https://api.openai.com/v1/responses",
    );
  });
  it("anthropic：裸 base 补 /v1/messages，base 以 /v1 结尾只补 /messages", () => {
    expect(resolveEndpoint("https://api.anthropic.com", "anthropic", "m")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(resolveEndpoint("https://gateway.example.com/anthropic/v1", "anthropic", "m")).toBe(
      "https://gateway.example.com/anthropic/v1/messages",
    );
  });
  it("anthropic：已含 /messages 时原样返回", () => {
    expect(resolveEndpoint("https://gw.example.com/anthropic", "anthropic", "m")).toBe(
      "https://gw.example.com/anthropic/v1/messages",
    );
  });
  it("gemini：端点内嵌模型名，裸 base 补 /v1beta", () => {
    expect(resolveEndpoint("https://generativelanguage.googleapis.com", "gemini", "g")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent",
    );
  });
  it("gemini：base 已以 /v1beta 或 /v1 结尾时不重复版本前缀", () => {
    expect(resolveEndpoint("https://x.com/v1beta", "gemini", "g")).toBe(
      "https://x.com/v1beta/models/g:generateContent",
    );
    expect(resolveEndpoint("https://x.com/v1beta/models/g:generateContent", "gemini", "g")).toBe(
      "https://x.com/v1beta/models/g:generateContent",
    );
  });
});

// ===== 配置校验 =====

describe("validateUserConfig", () => {
  it("合法配置通过，protocol 缺省为 auto", () => {
    const cfg = validateUserConfig({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-abcdef123456",
      model: "gpt-4o-mini",
    });
    expect(cfg).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-abcdef123456",
      model: "gpt-4o-mini",
      protocol: "auto",
    });
  });
  it("拒绝 http://", () => {
    expect(validateUserConfig({ ...baseConfig(), baseUrl: "http://api.openai.com/v1" })).toBeNull();
  });
  it("拒绝字面 IPv4 与 IPv6 主机", () => {
    expect(
      validateUserConfig({ ...baseConfig(), baseUrl: "https://169.254.169.254/v1" }),
    ).toBeNull();
    expect(validateUserConfig({ ...baseConfig(), baseUrl: "https://[::1]/v1" })).toBeNull();
  });
  it("拒绝 localhost 与 .internal", () => {
    expect(validateUserConfig({ ...baseConfig(), baseUrl: "https://localhost/v1" })).toBeNull();
    expect(validateUserConfig({ ...baseConfig(), baseUrl: "https://x.internal/v1" })).toBeNull();
  });
  it("拒绝云元数据端点", () => {
    expect(
      validateUserConfig({ ...baseConfig(), baseUrl: "https://metadata.cloudflare.com/" }),
    ).toBeNull();
  });
  it("拒绝带凭据或非 443/80 端口的 URL", () => {
    expect(
      validateUserConfig({ ...baseConfig(), baseUrl: "https://u:p@api.openai.com/v1" }),
    ).toBeNull();
    expect(
      validateUserConfig({ ...baseConfig(), baseUrl: "https://api.openai.com:8443/v1" }),
    ).toBeNull();
  });
  it("key 长度与控制字符校验", () => {
    expect(validateUserConfig({ ...baseConfig(), apiKey: "short" })).toBeNull();
    expect(validateUserConfig({ ...baseConfig(), apiKey: "sk-test\u0000123456" })).toBeNull();
  });
  it("model 字符集白名单与非法 protocol 枚举", () => {
    expect(validateUserConfig({ ...baseConfig(), model: "bad model!" })).toBeNull();
    expect(validateUserConfig({ ...baseConfig(), protocol: "openai" })).toBeNull();
  });
});

// ===== 四协议适配 =====

describe("callAi 协议适配", () => {
  it("chat：Bearer 认证、max_tokens、system+user 消息；解析 choices[0]", async () => {
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.example.com/v1/chat/completions");
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sk-test-123456");
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(1000);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].content).toBe("DATA");
      return json({ choices: [{ message: { content: "你好" } }] });
    });
    await expect(callAi(resolvedFor("chat"), spec(), { fetchImpl })).resolves.toBe("你好");
  });
  it("responses：max_output_tokens 与 input 消息；解析 output_text", async () => {
    const fetchImpl = stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.max_output_tokens).toBe(1000);
      expect(body.input[0].role).toBe("system");
      expect(body.input[1].content[0].type).toBe("input_text");
      return json({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "R1" },
              { type: "output_text", text: "R2" },
            ],
          },
        ],
      });
    });
    await expect(callAi(resolvedFor("responses"), spec(), { fetchImpl })).resolves.toBe("R1R2");
  });
  it("anthropic：x-api-key + anthropic-version；system 独立字段；多 content block 拼接", async () => {
    const fetchImpl = stubFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-test-123456");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      const body = JSON.parse(String(init?.body));
      expect(body.system).toBe("SYS");
      expect(body.messages).toEqual([{ role: "user", content: "DATA" }]);
      return json({
        content: [
          { type: "text", text: "A" },
          { type: "text", text: "B" },
        ],
      });
    });
    await expect(callAi(resolvedFor("anthropic"), spec(), { fetchImpl })).resolves.toBe("AB");
  });
  it("gemini：端点内嵌模型名、x-goog-api-key、system_instruction；解析 parts", async () => {
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.example.com/v1/models/test-model:generateContent");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("sk-test-123456");
      const body = JSON.parse(String(init?.body));
      expect(body.system_instruction.parts[0].text).toBe("SYS");
      expect(body.generationConfig.maxOutputTokens).toBe(1000);
      return json({ candidates: [{ content: { parts: [{ text: "G1" }, { text: "G2" }] } }] });
    });
    await expect(callAi(resolvedFor("gemini"), spec(), { fetchImpl })).resolves.toBe("G1G2");
  });
  it("chat 401/403 → upstream_auth_failed；404/405 → upstream_not_found；429 → upstream_rate_limited（带 retryAfter）", async () => {
    await expect(
      callAi(resolvedFor("chat"), spec(), { fetchImpl: stubFetch(() => json({}, 401)) }),
    ).rejects.toMatchObject({ code: "upstream_auth_failed" });
    await expect(
      callAi(resolvedFor("chat"), spec(), { fetchImpl: stubFetch(() => json({}, 404)) }),
    ).rejects.toMatchObject({ code: "upstream_not_found" });
    await expect(
      callAi(resolvedFor("chat"), spec(), {
        fetchImpl: stubFetch(() => json({}, 429, { "retry-after": "30" })),
      }),
    ).rejects.toMatchObject({ code: "upstream_rate_limited", retryAfter: 30 });
  });
  it("空 choices / 空 parts / 畸形 JSON → upstream_error", async () => {
    await expect(
      callAi(resolvedFor("chat"), spec(), { fetchImpl: stubFetch(() => json({ choices: [] })) }),
    ).rejects.toMatchObject({ code: "upstream_error" });
    await expect(
      callAi(resolvedFor("gemini"), spec(), { fetchImpl: stubFetch(() => json({})) }),
    ).rejects.toMatchObject({ code: "upstream_error" });
    await expect(
      callAi(resolvedFor("chat"), spec(), {
        fetchImpl: stubFetch(() => new Response("not json", { status: 200 })),
      }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });
  it("输出截断到 2000 字符", async () => {
    const long = "x".repeat(3000);
    const text = await callAi(resolvedFor("chat"), spec(), {
      fetchImpl: stubFetch(() => json({ choices: [{ message: { content: long } }] })),
    });
    expect(text.length).toBe(2000);
  });
});

// ===== 自动探测 =====

describe("callModelAuto 协议探测", () => {
  it("chat 404 降档到 responses 成功，并缓存结论", async () => {
    let calls = 0;
    const fetchImpl = stubFetch((url) => {
      calls += 1;
      if (String(url).endsWith("/chat/completions")) return json({}, 404);
      return json({
        output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
      });
    });
    const result = await callModelAuto(baseConfig(), spec(), { fetchImpl });
    expect(result.protocol).toBe("responses");
    expect(result.text).toBe("hi");
    expect(calls).toBe(2);
  });
  it("缓存命中后第二次调用只发一次请求", async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return json({ choices: [{ message: { content: "ok" } }] });
    });
    await callModelAuto(baseConfig(), spec(), { fetchImpl });
    await callModelAuto(baseConfig(), spec(), { fetchImpl });
    expect(calls).toBe(2);
  });
  it("首个候选 401 不回退，直接抛 upstream_auth_failed", async () => {
    const fetchImpl = stubFetch(() => json({}, 401));
    await expect(callModelAuto(baseConfig(), spec(), { fetchImpl })).rejects.toMatchObject({
      code: "upstream_auth_failed",
    });
  });
  it("四协议全 404 → upstream_not_found（文案含模型名检查提示）", async () => {
    const fetchImpl = stubFetch(() => json({}, 404));
    await expect(callModelAuto(baseConfig(), spec(), { fetchImpl })).rejects.toMatchObject({
      code: "upstream_not_found",
    });
  });
  it("探测结论按 baseUrl 隔离", async () => {
    const fetchImpl = stubFetch(() => json({ choices: [{ message: { content: "ok" } }] }));
    await callModelAuto(baseConfig(), spec(), { fetchImpl });
    const other = { ...baseConfig(), baseUrl: "https://other.example.com/v1" };
    await expect(
      callModelAuto(other, spec(), { fetchImpl: stubFetch(() => json({}, 404)) }),
    ).rejects.toMatchObject({ code: "upstream_not_found" });
  });
});

// ===== 提示词模块 =====

describe("提示词模块", () => {
  it("指令模块为非空字符串且含硬边界", () => {
    expect(ROLE_BLOCK.zh).toContain("心理诊断");
    expect(TASK_BLOCK.compare.zh).toContain("分歧");
    expect(constraintBlock("zh")).toContain("编造");
    expect(constraintBlock("en")).toContain("English");
    expect(outputBlock("ranking", "standard", "zh")).toContain("250");
    expect(outputBlock("compare", "deep", "zh")).toContain("500");
    expect(outputBlock("ranking", "brief", "zh")).toContain("120");
  });
  it("composePrompt(ranking)：system 为指令、user 含数据；version 为数字", () => {
    const result = composePrompt("ranking", rankingData, "zh");
    expect(result).not.toBeNull();
    expect(result!.version).toBe(PROMPT_VERSION);
    expect(result!.system).toContain("点评");
    expect(result!.user).toContain("花样年华");
    expect(result!.user).toContain("王家卫");
    expect(result!.system).not.toContain("花样年华");
  });
  it("composePrompt(profile)：含榜单名、高频创作者与总量", () => {
    const data = {
      profileName: "测试画像",
      rankings: [
        {
          kind: "film",
          collectionTitle: "私藏电影",
          itemCount: 2,
          top: [{ rank: 1, title: "路边野餐" }],
        },
      ],
      stats: { totalWorks: 9, kindsCount: 1, topCreators: [{ name: "毕赣", count: 2 }] },
    };
    const result = composePrompt("profile", data, "zh");
    expect(result).not.toBeNull();
    expect(result!.user).toContain("私藏电影");
    expect(result!.user).toContain("毕赣(2)");
    expect(result!.user).toContain("9 件作品");
  });
  it("composePrompt(compare)：含指标与最大分歧；空 media 渲染「没有共同维度」", () => {
    const data = {
      ownName: "阿明",
      peerName: "小蓝",
      crossAgreement: 66,
      media: [
        {
          kind: "music",
          overlap: 34,
          orderAgreement: 78,
          consensusScore: 71,
          kendallTau: 62,
          sharedTop: ["七里香"],
          onlyOwnCount: 10,
          onlyPeerCount: 6,
          biggestGap: { title: "范特西", ownRank: 2, peerRank: 40 },
        },
      ],
    };
    const result = composePrompt("compare", data, "zh");
    expect(result).not.toBeNull();
    expect(result!.user).toContain("阿明");
    expect(result!.user).toContain("范特西");
    expect(result!.user).toContain("66");
    const empty = composePrompt("compare", { ownName: "A", peerName: "B", media: [] }, "zh");
    expect(empty).not.toBeNull();
    expect(empty!.user).toContain("没有共同的媒介维度");
  });
  it("非法数据形状返回 null（ranking 无 works / profile 无 rankings / data 非对象）", () => {
    expect(composePrompt("ranking", { works: [] }, "zh")).toBeNull();
    expect(composePrompt("profile", { rankings: [] }, "zh")).toBeNull();
    expect(composePrompt("compare", { media: "nope" }, "zh")).toBeNull();
    expect(composePrompt("ranking", "not-an-object", "zh")).toBeNull();
  });
  it("length 三档映射字数上限", () => {
    for (const length of ["brief", "standard", "deep"] as const) {
      const result = composePrompt("ranking", rankingData, "zh", { length });
      expect(result!.system).toContain({ brief: "120", standard: "250", deep: "500" }[length]);
    }
  });
  it("locale=en 时指令切换为英文", () => {
    const result = composePrompt("ranking", rankingData, "en");
    expect(result!.system).toContain("English");
  });
  it("管理端覆盖：system 用覆盖值、version 记 override；user 数据块不受影响", () => {
    const result = composePrompt("ranking", rankingData, "zh", {
      overrideSystem: "你是毒舌乐评人。",
    });
    expect(result!.system).toBe("你是毒舌乐评人。");
    expect(result!.version).toBe("override");
    expect(result!.user).toContain("花样年华");
  });
  it("数据超预算返回 null", () => {
    const big = { works: [{ title: "x".repeat(20000) }] };
    expect(composePrompt("ranking", big, "zh")).toBeNull();
  });
});

// ===== 模型列表 =====

describe("listAiModels", () => {
  it("chat：GET {base}/models + Bearer；解析 data[].id", async () => {
    const fetchImpl = stubFetch((url, init) => {
      expect(url).toBe("https://api.example.com/v1/models");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test-123456");
      return json({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] });
    });
    const result = await listAiModels(baseConfig(), fetchImpl);
    expect(result.protocol).toBe("chat");
    expect(result.models).toEqual(["gpt-4o-mini", "gpt-4o"]);
    expect(result.truncated).toBe(false);
  });
  it("anthropic 与 gemini 的列表端点与认证头；gemini 剥离 models/ 前缀", async () => {
    const anthropicCfg = { ...baseConfig(), baseUrl: "https://api.anthropic.com" };
    const anthropicFetch = stubFetch((url, init) => {
      if (!String(url).endsWith("/v1/models")) return json({}, 404); // chat/responses 档降级
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-test-123456");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      return json({ data: [{ id: "claude-3-5-haiku-latest" }] });
    });
    await expect(listAiModels(anthropicCfg, anthropicFetch)).resolves.toMatchObject({
      protocol: "anthropic",
      models: ["claude-3-5-haiku-latest"],
    });
    const geminiCfg = { ...baseConfig(), baseUrl: "https://generativelanguage.googleapis.com" };
    const geminiFetch = stubFetch((url, init) => {
      if (!String(url).endsWith("/v1beta/models")) return json({}, 404);
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("sk-test-123456");
      return json({ models: [{ name: "models/gemini-2.0-flash" }] });
    });
    await expect(listAiModels(geminiCfg, geminiFetch)).resolves.toMatchObject({
      protocol: "gemini",
      models: ["gemini-2.0-flash"],
    });
  });
  it("auto：chat/responses 列表 404 时降档 anthropic 并缓存协议", async () => {
    const cfg = { ...baseConfig(), baseUrl: "https://api.anthropic.com" };
    // chat 与 responses 的列表端点同为 {base}/models（404 两连），第三档 anthropic 走 /v1/models 成功。
    let calls = 0;
    const sequential = stubFetch(() => {
      calls += 1;
      return calls <= 2 ? json({}, 404) : json({ data: [{ id: "m1" }] });
    });
    const result = await listAiModels(cfg, sequential);
    expect(result.protocol).toBe("anthropic");
    expect(result.models).toEqual(["m1"]);
    expect(calls).toBe(3);
  });
  it("超过 100 条时 truncated=true", async () => {
    const data = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}` }));
    const result = await listAiModels(
      baseConfig(),
      stubFetch(() => json({ data })),
    );
    expect(result.models.length).toBe(100);
    expect(result.truncated).toBe(true);
  });
});

// ===== 测试连接 =====

describe("testAiConnection", () => {
  it("探活成功回显模型与协议", async () => {
    const fetchImpl = stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body));
      // 推理型模型会把极小的 max_tokens 全耗在推理段（content 为空），
      // 探活配额必须 ≥256，否则「测试连接」对能用的配置误报失败。
      expect(body.max_tokens).toBe(256);
      return json({ choices: [{ message: { content: "pong" } }] });
    });
    await expect(testAiConnection(baseConfig(), fetchImpl)).resolves.toEqual({
      ok: true,
      model: "test-model",
      protocol: "chat",
    });
  });
});
