import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePosters } from "./media";

/**
 * 钉住取图优先级：**网易云 CDN 直出优先，豆瓣（需 /api/image 代理）垫后**。
 *
 * 为什么值得单测：
 *  - 网易云封面是 `p*.music.126.net`，浏览器直连、CSP 已放行、不占豆瓣抓取配额；
 *    豆瓣封面必须由 Worker 带 Referer 代理，且在并发批量下会被 418 打回。
 *  - 旧实现把豆瓣放在第一档、网易云放在最后一档，于是每一首歌都必然先付一次豆瓣
 *    查询（并在豆瓣查空时连带白跑 4 次维基请求）才轮到网易云——"封面加载慢"的主因。
 *  - 返回数组的顺序就是前端尝试顺序，所以"谁是第一张候选"是可观测、可回归的行为。
 */

const NET_EASE_COVER = "https://p2.music.126.net/abcdef==/10995116.jpg";
const DOUBAN_COVER = "https://img1.doubanio.com/view/subject/m/public/s1234.jpg";
const GD_API = "music-api.gdstudio.xyz";

const requestedHosts: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** searchCover 依赖 `window.__DATA__` 这段 HTML 结构（见 media.ts 的解析逻辑）。 */
function doubanSearchHtml(title: string, coverUrl: string): string {
  return `<html><script>window.__DATA__ = {"items":[{"title":"${title}","cover_url":"${coverUrl}"}]};</script></html>`;
}

/*
 * 假上游：只应答网易云搜索、豆瓣搜索、gd-proxy，其余 host 一律 502。
 * 关键点是**按查询词回显标题**——否则 searchCover 匹配不上就会触发 ensureMusicIndex
 * 去抓豆瓣榜单页，测试会退化成一串真实超时。
 */
function stubUpstream(options: { neteaseCover?: string | null; doubanCover?: string | null }) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    requestedHosts.push(url.hostname);
    if (url.hostname === "music.163.com") {
      const query = url.searchParams.get("s") ?? "";
      const cover = options.neteaseCover;
      return json({ result: { songs: cover ? [{ name: query, album: { picUrl: cover } }] : [] } });
    }
    if (url.hostname === "search.douban.com") {
      const query = url.searchParams.get("search_text") ?? "";
      const cover = options.doubanCover;
      return new Response(cover ? doubanSearchHtml(query, cover) : "<html></html>", {
        status: 200,
      });
    }
    // gd-proxy 兜底：成功但空结果，避免 gdApiWithRetry 的重试等待。
    if (url.hostname === GD_API) return json([], 200);
    // 豆瓣榜单页索引（ensureMusicIndex 触发）：200 + 空页即可。
    // 返回 502 会让 upstream() 走 1s/2s 退避重试，白白拖长测试。
    if (url.hostname === "music.douban.com")
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    return json({}, 502);
  });
}

beforeEach(() => {
  requestedHosts.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("音乐的取图优先级", () => {
  it("网易云命中时：它是第一张候选，豆瓣只作为后续兜底", async () => {
    stubUpstream({ neteaseCover: NET_EASE_COVER, doubanCover: DOUBAN_COVER });
    const urls = await resolvePosters("童话", "童话", undefined, "music");

    expect(urls[0]).toBe(NET_EASE_COVER);
    expect(urls.slice(1).some((url) => url.includes("doubanio.com"))).toBe(true);
  });

  it("网易云命中时不再请求维基（旧实现每首歌必然白跑最多 4 次维基）", async () => {
    stubUpstream({ neteaseCover: NET_EASE_COVER, doubanCover: DOUBAN_COVER });
    await resolvePosters("宁夏", "宁夏", undefined, "music");
    expect(requestedHosts.some((host) => host.endsWith("wikipedia.org"))).toBe(false);
  });

  it("网易云取不到时，豆瓣顶上成为第一张候选", async () => {
    stubUpstream({ neteaseCover: null, doubanCover: DOUBAN_COVER });
    const urls = await resolvePosters("欧若拉", "欧若拉", undefined, "music");
    expect(urls[0]).toContain("doubanio.com");
  });

  it("http 的网易云封面会被升级为 https（否则页面是混合内容）", async () => {
    stubUpstream({
      neteaseCover: "http://p1.music.126.net/xyz==/1.jpg",
      doubanCover: DOUBAN_COVER,
    });
    const urls = await resolvePosters("后来", "后来", undefined, "music");
    expect(urls[0]).toBe("https://p1.music.126.net/xyz==/1.jpg");
  });

  it("候选去重：同一张封面不会重复出现", async () => {
    stubUpstream({ neteaseCover: NET_EASE_COVER, doubanCover: DOUBAN_COVER });
    const urls = await resolvePosters("遇见", "遇见", undefined, "music");
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBeGreaterThan(1);
  });
});

// 注：「网易云与豆瓣都取不到 → 轮到维基」这一档这里没有断言：它会触发
// ensureMusicIndex 抓豆瓣音乐榜 10 页，而 music.douban.com 的节流是 800ms/页
// （串行链），单测会因此跑 8 秒。那段是既有的兜底行为、与本次优先级调整无关，
// 收益不抵测试耗时。
