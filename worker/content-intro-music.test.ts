import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchContentIntro } from "./media";

// 音乐详情的歌曲导向简介策略（PLAN-algo-modes 后续优化）：
// 中文歌名优先百度百科（华语流行单曲覆盖远好于维基），非中文歌名仍走维基。
describe("fetchContentIntro 音乐简介数据源", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("中文歌名：百度百科优先，命中即返回且不查维基", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (url.includes("baike.baidu.com")) {
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
    expect(calls.filter((u) => u.includes("baike.baidu.com"))).toHaveLength(1);
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
  });
});
