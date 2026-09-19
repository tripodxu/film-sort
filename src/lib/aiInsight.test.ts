import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingExport } from "./profile";
import type { DimensionComparison } from "./profile";
import {
  buildCompareData,
  buildProfileData,
  buildRankingData,
  clearAiConfig,
  clearInsightCache,
  fetchAiModels,
  readAiConfig,
  readAiLength,
  requestInsight,
  testAiConfig,
  writeAiConfig,
  writeAiLength,
  type AiUserConfig,
} from "./aiInsight";

// node 环境没有 localStorage：装一个可注入/可抛错的内存实现。
let store: Map<string, string>;
let throwing = false;
const localStorageStub = {
  getItem: (key: string) => {
    if (throwing) throw new Error("storage disabled");
    return store.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (throwing) throw new Error("storage disabled");
    store.set(key, value);
  },
  removeItem: (key: string) => {
    if (throwing) throw new Error("storage disabled");
    store.delete(key);
  },
};

beforeEach(() => {
  store = new Map();
  throwing = false;
  vi.stubGlobal("localStorage", localStorageStub);
  clearInsightCache();
});

const stubFetchOk = (payload: unknown) =>
  vi.fn(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  ) as unknown as typeof fetch;

const ranking = (count: number): RankingExport => ({
  version: 1,
  profileId: "p1",
  profileName: "画像",
  kind: "music",
  collectionTitle: "华语专辑",
  createdAt: "2026-09-19T00:00:00.000Z",
  items: Array.from({ length: count }, (_, i) => ({
    id: `w${i}`,
    title: `歌${i}`,
    rank: i + 1,
    ...(i % 2 ? { creator: `歌手${i % 3}` } : {}),
    ...(i % 3 ? { year: 1990 + i } : {}),
  })),
});

// ===== 配置存取 =====

describe("配置存取", () => {
  it("写入后可读回，含协议", () => {
    const cfg: AiUserConfig = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-12345678",
      model: "gpt-4o-mini",
      protocol: "chat",
    };
    expect(writeAiConfig(cfg)).toBe(true);
    expect(readAiConfig()).toEqual(cfg);
  });
  it("clearAiConfig 之后读回 null", () => {
    writeAiConfig({ baseUrl: "https://x.com", apiKey: "sk-12345678", model: "m" });
    clearAiConfig();
    expect(readAiConfig()).toBeNull();
  });
  it("隐私模式（localStorage 抛错）：读取返回 null、写入返回 false，均不外泄异常", () => {
    throwing = true;
    expect(readAiConfig()).toBeNull();
    expect(writeAiConfig({ baseUrl: "https://x.com", apiKey: "sk-12345678", model: "m" })).toBe(
      false,
    );
    expect(readAiLength()).toBe("standard");
    expect(() => writeAiLength("brief")).not.toThrow();
  });
  it("损坏的配置 JSON 读回 null", () => {
    store.set("art-rank:ai-config", "{broken");
    expect(readAiConfig()).toBeNull();
  });
  it("长度旋钮默认 standard，brief/deep 可持久化", () => {
    expect(readAiLength()).toBe("standard");
    writeAiLength("deep");
    expect(readAiLength()).toBe("deep");
  });
});

// ===== 场景数据组装 =====

describe("buildRankingData", () => {
  it("超过 150 条截断 works，itemCount 保持全量", () => {
    const data = buildRankingData(ranking(200), "我的画像");
    expect(data.works.length).toBe(150);
    expect(data.itemCount).toBe(200);
    expect(data.kind).toBe("music");
  });
  it("150 条以内原样传递", () => {
    const data = buildRankingData(ranking(10), "我的画像");
    expect(data.works.length).toBe(10);
    expect(data.works[0]).toMatchObject({ rank: 1, title: "歌0" });
  });
});

describe("buildProfileData", () => {
  it("每榜单 top 截 15、creator 频次取前 8、统计口径为全量", () => {
    const profile = {
      version: 2 as const,
      profileId: "p1",
      profileName: "画像",
      updatedAt: "2026-09-19T00:00:00.000Z",
      rankings: [ranking(20), ranking(5)],
    };
    const data = buildProfileData(profile);
    expect(data.rankings[0].top.length).toBe(15);
    expect(data.rankings[0].itemCount).toBe(20);
    expect(data.stats.totalWorks).toBe(25);
    expect(data.stats.kindsCount).toBe(1);
    const top = data.stats.topCreators;
    expect(top.length).toBeLessThanOrEqual(8);
    expect(top[0].count).toBeGreaterThanOrEqual(top[top.length - 1].count);
  });
});

describe("buildCompareData", () => {
  const result: DimensionComparison = {
    shared: [],
    onlyOwn: [],
    onlyPeer: [],
    overlap: 34,
    orderAgreement: 78,
    top5Overlap: 1,
    disagreements: [
      {
        title: "范特西",
        ownRank: 2,
        peerRank: 40,
        difference: 38,
        matchScore: 90,
        ownKey: "a",
        peerKey: "b",
        ownSources: [],
        peerSources: [],
      },
    ],
    sharedCount: 3,
    coverage: 50,
    weightedTopAgreement: 60,
    rankDistance: 10,
    spearmanLikeAgreement: null,
    championAgreement: null,
    top3Agreement: 1,
    commonPreference: "",
    divergence: "",
    kendallTau: 62,
    topJaccard: 20,
    eraAffinity: null,
    consensusScore: 71,
  };
  it("指标直传、sharedTop 截 5、biggestGap 取分歧第一名", () => {
    const withShared = {
      ...result,
      shared: Array.from({ length: 8 }, (_, i) => ({
        ...result.disagreements[0],
        title: `歌${i}`,
      })),
    } as DimensionComparison;
    const data = buildCompareData({
      ownName: "阿明",
      peerName: "小蓝",
      kind: "music",
      result: withShared,
      crossAgreement: 66,
    });
    expect(data.media[0].overlap).toBe(34);
    expect(data.media[0].sharedTop.length).toBe(5);
    expect(data.media[0].biggestGap).toEqual({ title: "范特西", ownRank: 2, peerRank: 40 });
    expect(data.crossAgreement).toBe(66);
  });
  it("无分歧作品时 biggestGap 为 null", () => {
    const data = buildCompareData({
      ownName: "A",
      peerName: "B",
      kind: "film",
      result: { ...result, disagreements: [] },
      crossAgreement: null,
    });
    expect(data.media[0].biggestGap).toBeNull();
    expect(data.crossAgreement).toBeNull();
  });
});

// ===== 请求与失败分类 =====

describe("requestInsight", () => {
  it("成功返回字段并写入会话缓存（同参数第二次不发请求）", async () => {
    const fetchImpl = stubFetchOk({
      insight: "点评",
      source: "custom",
      model: "m1",
      promptVersion: 1,
    });
    vi.stubGlobal("fetch", fetchImpl);
    const opts = { locale: "zh" as const, length: "standard" as const };
    const first = await requestInsight("ranking", { works: [1] }, opts);
    const second = await requestInsight("ranking", { works: [1] }, opts);
    expect(first).toMatchObject({ ok: true, insight: "点评", source: "custom", model: "m1" });
    expect(second).toEqual(first);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
  it("force 绕过缓存", async () => {
    const fetchImpl = stubFetchOk({
      insight: "x",
      source: "builtin",
      model: "m",
      promptVersion: 1,
    });
    vi.stubGlobal("fetch", fetchImpl);
    const opts = { locale: "zh" as const, length: "standard" as const };
    await requestInsight("ranking", { a: 1 }, opts);
    await requestInsight("ranking", { a: 1 }, { ...opts, force: true });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
  it("429 → rate_limited，并透传 retry-after", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "600" } })),
    );
    const result = await requestInsight("profile", {}, { locale: "zh", length: "standard" });
    expect(result).toMatchObject({ ok: false, error: "rate_limited", retryAfter: 600 });
  });
  it("服务端错误码原样透传（自定义 key 错误 → upstream_auth_failed）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "upstream_auth_failed", msg: "API Key 无效" }), {
            status: 502,
          }),
      ),
    );
    const result = await requestInsight("compare", {}, { locale: "zh", length: "standard" });
    expect(result).toMatchObject({ ok: false, error: "upstream_auth_failed", msg: "API Key 无效" });
  });
  it("网络异常 → unavailable，不抛出", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await requestInsight("ranking", {}, { locale: "zh", length: "standard" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
  it("携带用户配置时放进请求体", async () => {
    const fetchImpl = stubFetchOk({
      insight: "x",
      source: "custom",
      model: "m",
      promptVersion: "override",
    });
    vi.stubGlobal("fetch", fetchImpl);
    const config: AiUserConfig = { baseUrl: "https://x.com/v1", apiKey: "sk-12345678", model: "m" };
    await requestInsight("ranking", { a: 1 }, { locale: "zh", length: "brief", config });
    const body = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.config).toEqual(config);
    expect(body.length).toBe("brief");
  });
});

describe("testAiConfig / fetchAiModels", () => {
  it("test 成功回显协议与模型", async () => {
    vi.stubGlobal("fetch", stubFetchOk({ ok: true, model: "m", protocol: "chat" }));
    await expect(
      testAiConfig({ baseUrl: "https://x.com/v1", apiKey: "sk-12345678", model: "m" }),
    ).resolves.toEqual({ ok: true, model: "m", protocol: "chat" });
  });
  it("models 成功返回列表与 truncated", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetchOk({ ok: true, protocol: "gemini", models: ["a", "b"], truncated: true }),
    );
    await expect(
      fetchAiModels({ baseUrl: "https://x.com", apiKey: "sk-12345678", model: "m" }),
    ).resolves.toEqual({ ok: true, protocol: "gemini", models: ["a", "b"], truncated: true });
  });
  it("失败按服务端错误码分类", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_config" }), { status: 400 })),
    );
    await expect(
      testAiConfig({ baseUrl: "http://bad", apiKey: "sk-12345678", model: "m" }),
    ).resolves.toMatchObject({ ok: false, error: "invalid_config" });
  });
});
