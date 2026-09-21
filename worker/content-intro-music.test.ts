import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchContentIntro } from "./media";

/**
 * 音乐简介数据源策略：
 *  - 中文歌名优先百度百科（对华语流行单曲的覆盖远好于维基），传输链路
 *    openapi → 词条页 meta → anysearch 搜索摘要；
 *  - 维基搜索候选必须真的提到作品名（榜单/合集页整页不含歌名，是噪声）；
 *  - 非中文歌名仍走维基；
 *  - 简介结果有 isolate 级缓存——每个用例使用不同歌名避免串扰。
 */

const OPENAPI_ERRNO = JSON.stringify({ errno: 6 });
const baikeItemBlocked = () => new Response("<title>百度安全验证</title>", { status: 403 });

function anysearchOk(blocks: Array<{ title: string; url: string; snippet: string }>): Response {
  const text =
    "## Search Results (" +
    blocks.length +
    " results, 470ms)\n\n" +
    blocks
      .map((b, i) => `### ${i + 1}. ${b.title}\n- **URL**: ${b.url}\n- ${b.snippet}\n`)
      .join("\n");
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }),
    { status: 200 },
  );
}

describe("fetchContentIntro 音乐简介数据源", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 599 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("中文歌名：百度百科开放 API 命中即返回，不查维基", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (url.includes("baike.baidu.com/api/openapi")) {
          return new Response(
            JSON.stringify({
              abstract: "《白月光与朱砂痣》是大籽演唱的流行歌曲，2021年发行，词曲均由其本人完成。",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      }),
    );
    const intro = await fetchContentIntro("白月光与朱砂痣", "music", "大籽", "2021");
    expect(intro?.source).toBe("baike");
    expect(intro?.intro).toContain("大籽");
    expect(calls.some((u) => u.includes("wikipedia.org"))).toBe(false);
    // openapi 命中即返回；词条页探测与 openapi 并行发出（设计如此），不算多余查询
    expect(calls.filter((u) => u.includes("baike.baidu.com/api/openapi"))).toHaveLength(1);
  });

  it("中文歌名：openapi 失效 + 词条页被反爬拦截时，anysearch 取百科词条摘要", async () => {
    const calls: string[] = [];
    let authHeader: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (url.includes("api.anysearch.com")) {
          const h = new Headers(init?.headers);
          authHeader = h.get("authorization") ?? undefined;
          return anysearchOk([
            {
              title: "漠河舞厅（柳爽演唱的歌曲） - 百度百科",
              url: "https://baike.baidu.com/item/%E6%BC%A0%E6%B2%B3%E8%88%9E%E5%8E%85/59262888",
              snippet:
                "《漠河舞厅》是音乐人柳爽于2020年3月18日发布的一首以爱情为主题的歌曲，2021年10月因短视频翻红。",
            },
            {
              title: "漠河舞厅 (专辑) - 百度百科",
              url: "https://baike.baidu.com/item/%E6%BC%A0%E6%B2%B3%E8%88%9E%E5%8E%85%E4%B8%93%E8%BE%91",
              snippet: "《漠河舞厅》同名专辑的词条内容，与歌曲词条不同。",
            },
          ]);
        }
        if (url.includes("baike.baidu.com/api/openapi")) {
          return new Response(OPENAPI_ERRNO, { status: 200 });
        }
        if (url.includes("baike.baidu.com/item/")) return baikeItemBlocked();
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      }),
    );
    const intro = await fetchContentIntro("漠河舞厅", "music", "柳爽", "2021", {
      ANYSEARCH_API_KEY: "as_sk_test",
    });
    expect(intro?.source).toBe("baike");
    expect(intro?.intro).toContain("柳爽");
    expect(intro?.intro).toContain("2020年");
    expect(authHeader).toBe("Bearer as_sk_test");
    expect(calls.some((u) => u.includes("wikipedia.org"))).toBe(false);
    expect(calls.filter((u) => u.includes("api.anysearch.com"))).toHaveLength(1);
  });

  it("中文歌名：百科链路全空时，维基搜索里整页不含歌名的榜单页被拒绝", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("baike.baidu.com/api/openapi")) {
          return new Response(OPENAPI_ERRNO, { status: 200 });
        }
        if (url.includes("baike.baidu.com/item/")) return baikeItemBlocked();
        if (url.includes("api.anysearch.com")) return anysearchOk([]);
        if (url.includes("wikipedia.org")) {
          if (url.includes("generator=search")) {
            // 榜单页：通篇像音乐词条，但整页不出现歌名——必须被相关性门槛拒绝
            return new Response(
              JSON.stringify({
                query: {
                  pages: {
                    c1: {
                      title: "华语金曲榜",
                      extract:
                        "华语金曲榜是由电台主办的中文歌曲排行榜，榜单由听众实名制投票产生，已成功举办十一届，伴随每年乐坛新势力的加入，令好歌被听到。",
                    },
                  },
                },
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
        }
        return new Response("", { status: 599 });
      }),
    );
    const intro = await fetchContentIntro("乌梅子酱", "music", "李荣浩", "2023");
    expect(intro).toBeNull();
  });

  it("百度直连熔断：anysearch 连续未命中使直连失败累计满 3 次后，不再请求百度直连", async () => {
    // 新顺序下直连探测只在 anysearch 未命中时发起。前序用例已各累计若干
    // 失败；本用例用三首 anysearch 也搜不到的歌把 openapi/item 都推过
    // 阈值，第四首 anysearch 命中时不应再出现任何 baike.baidu.com 请求。
    let baikeCalls = 0;
    let miss = true;
    let currentSong = "测试歌名甲";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("baike.baidu.com")) {
          baikeCalls += 1;
          if (url.includes("/api/openapi")) return new Response(OPENAPI_ERRNO, { status: 200 });
          return baikeItemBlocked();
        }
        if (url.includes("api.anysearch.com")) {
          if (miss) return anysearchOk([]);
          return anysearchOk([
            {
              title: `${currentSong}（歌曲） - 百度百科`,
              url: "https://baike.baidu.com/item/%E6%B5%8B%E8%AF%95/59262888",
              snippet: `《${currentSong}》是一首华语流行歌曲，发行后在各音乐平台进入热榜前列。`,
            },
          ]);
        }
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      }),
    );
    for (const song of ["测试歌名甲", "测试歌名乙", "测试歌名丙"]) {
      currentSong = song;
      await fetchContentIntro(song, "music", "测试歌手", "2020");
    }
    const callsAfterMisses = baikeCalls;
    expect(callsAfterMisses).toBeGreaterThan(0);
    expect(callsAfterMisses).toBeLessThanOrEqual(6);
    // 熔断已触发：第四首 anysearch 命中，直连零请求
    baikeCalls = 0;
    miss = false;
    currentSong = "测试歌名丁";
    const hit = await fetchContentIntro("测试歌名丁", "music", "测试歌手", "2020");
    expect(hit?.source).toBe("baike");
    expect(hit?.intro).toContain("测试歌名丁");
    expect(baikeCalls).toBe(0);
  });

  it("英文歌名：跳过百度百科，直接走维基", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (url.includes("wikipedia.org")) {
          return new Response(
            JSON.stringify({
              query: {
                pages: {
                  m1: {
                    title: "Yesterday",
                    extract:
                      "Yesterday is a song by the Beatles, released in 1965 on the album Help!",
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      }),
    );
    const intro = await fetchContentIntro("Yesterday", "music", "The Beatles", "1965");
    expect(intro?.source).toContain("wiki");
    expect(intro?.intro).toContain("Beatles");
    expect(calls.some((u) => u.includes("baike.baidu.com"))).toBe(false);
    expect(calls.some((u) => u.includes("api.anysearch.com"))).toBe(false);
  });

  it("简介缓存：同一作品第二次调用不再发起外部请求", async () => {
    let wikiCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("wikipedia.org")) {
          wikiCalls += 1;
          return new Response(
            JSON.stringify({
              query: {
                pages: {
                  m1: {
                    title: "Hey Jude",
                    extract:
                      "Hey Jude is a song by the English rock band the Beatles, first released in 1968 as a single.",
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
      }),
    );
    const first = await fetchContentIntro("Hey Jude", "music", "The Beatles");
    expect(first?.source).toContain("wiki");
    const before = wikiCalls;
    const second = await fetchContentIntro("Hey Jude", "music", "The Beatles");
    expect(second?.intro).toBe(first?.intro);
    expect(wikiCalls).toBe(before);
  });
});
