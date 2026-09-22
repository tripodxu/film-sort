import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gdLyric,
  gdPlayUrl,
  gdSearch,
  pickTrack,
  pickTracks,
  playNeedsUpstream,
  lyricNeedsUpstream,
  type GdTrack,
} from "./gdstudio";

/**
 * 音乐试听/歌词的上游匹配与缓存护栏。
 *
 * 现场证据（线上 https://sort.logicc.top）：
 *  - `GET /api/music/play?q=zzzzqqqxxx` 返回了一首**毫不相干**的歌
 *    （"Can't Give Up" / ZXXXQ）并且 `isCover:false`，用户没有任何提示。
 *    根因是 pickTracks 在"一条都没对上"时回退成「把搜索结果原样返回」。
 *  - 同一首歌第一次搜 502 `music_search_failed`、紧接着又成功 → gdSearch 把
 *    HTTP 200 + 非数组的响应当成"没有结果"缓存了 10 分钟，一首歌会因此
 *    在一整段时间里持续"搜不到"。
 */

const track = (id: string, name: string, artist: string[] | string): GdTrack => ({
  id,
  name,
  artist,
});

describe("pickTracks 只认歌名对得上的命中", () => {
  const results = [
    track("1", "第一次", ["光良"]), // 同歌手但不是这首歌
    track("2", "童话", ["光良"]),
    track("3", "童话 (Live)", ["光良"]),
    track("4", "童话", ["陆锦舟"]),
    track("5", "Can't Give Up", ["ZXXXQ"]), // 与查询完全无关
  ];

  it("只有歌手对上不算命中：同歌手的《第一次》不会顶上来", () => {
    const picked = pickTracks(results, "童话", "光良");
    expect(picked.map((t) => t.id)).toEqual(["2", "3", "4"]);
    expect(picked.some((t) => t.name === "第一次")).toBe(false);
  });

  it("一条歌名都对不上时返回空——宁可说没找到，也不播无关的歌", () => {
    expect(pickTracks(results, "zzzzqqqxxx")).toEqual([]);
    expect(pickTracks(results, "zzzzqqqxxx", "ZXXXQ")).toEqual([]);
    expect(pickTrack(results, "zzzzqqqxxx")).toBeNull();
  });

  it("歌名精确命中优先于包含命中，同分保持原顺序", () => {
    expect(pickTracks(results, "童话", "光良", 2).map((t) => t.id)).toEqual(["2", "3"]);
  });

  it("空标题 / 空结果集都返回空", () => {
    expect(pickTracks([], "童话")).toEqual([]);
    expect(pickTracks(results, "   ")).toEqual([]);
  });

  it("歌手写法差异（含前缀/斜杠）仍算原唱", () => {
    const withDuet = [track("9", "广岛之恋", ["莫文蔚", "张洪量"])];
    expect(pickTracks(withDuet, "广岛之恋", "莫文蔚")).toHaveLength(1);
  });

  it("繁简归一：告白氣球 能命中 告白气球", () => {
    const sc = [track("10", "告白气球", ["周杰伦"])];
    expect(pickTracks(sc, "告白氣球", "周杰伦").map((t) => t.id)).toEqual(["10"]);
    const tc = [track("11", "告白氣球", ["周杰倫"])];
    expect(pickTracks(tc, "告白气球", "周杰伦").map((t) => t.id)).toEqual(["11"]);
  });
});

describe("gdSearch 的缓存只吃结构性正确的响应", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非数组响应（200 + 错误 JSON）不会被缓存成「搜不到」", async () => {
    let calls = 0;
    let body: unknown = { error: "upstream_unavailable" };
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    // 第一次：上游回了 200 + 对象 → 视为无结果，但**不缓存**
    expect((await gdSearch("非数组响应探针", 10)).tracks).toEqual([]);
    expect(calls).toBe(1);

    // 上游恢复成正常数组后，同一个查询必须能重新拿到结果
    body = [track("7", "非数组响应探针", ["某人"])];
    const second = await gdSearch("非数组响应探针", 10);
    expect(calls).toBe(2);
    expect(second.tracks.map((t) => t.id)).toEqual(["7"]);
  });

  it("正常数组结果会被缓存，不重复打上游", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify([track("8", "缓存探针", ["某人"])]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await gdSearch("缓存探针", 10);
    await gdSearch("缓存探针", 10);
    expect(calls).toBe(1);
  });
});

/**
 * 命中缓存时零上游调用，就不该占用限流配额（同一首歌反复试听很常见）。
 * 判断必须**保守**：只有能证明"完全不需要上游"时才放行不记账。
 */
describe("playNeedsUpstream / lyricNeedsUpstream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("搜索未命中缓存 → 需要上游（记账）", () => {
    expect(playNeedsUpstream("从未搜过的歌")).toBe(true);
    expect(lyricNeedsUpstream("从未搜过的歌")).toBe(true);
  });

  it("搜索命中但首候选的播放链没缓存 → 仍需上游", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify([track("p1", "记账探针A", ["某人"])]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await gdSearch("记账探针A", 10);
    expect(playNeedsUpstream("记账探针A")).toBe(true);
  });

  it("搜索与首候选的播放链都命中缓存 → 零上游，不记账", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      calls.push(url.searchParams.get("types") ?? "");
      if (url.searchParams.get("types") === "search")
        return new Response(JSON.stringify([track("p2", "记账探针B", ["某人"])]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ url: "https://m801.music.126.net/x.mp3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await gdSearch("记账探针B", 10);
    expect(playNeedsUpstream("记账探针B")).toBe(true); // 播放链还没缓存
    await gdPlayUrl("p2"); // worker 侧按 track id 取播放链
    expect(calls).toEqual(["search", "url"]);
    expect(playNeedsUpstream("记账探针B")).toBe(false); // 搜索 + 播放链都在缓存里
  });

  it("搜索命中但没有歌名匹配的候选 → 直接 404，零上游，不记账", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify([track("x1", "完全无关的歌", ["某人"])]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await gdSearch("无候选探针", 10);
    expect(playNeedsUpstream("无候选探针")).toBe(false);
    expect(lyricNeedsUpstream("无候选探针")).toBe(false);
  });

  it("歌词：曲目与歌词都命中缓存后不记账", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.searchParams.get("types") === "search")
        return new Response(JSON.stringify([track("p3", "记账探针C", ["某人"])]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ lyric: "[00:01]第一句", tlyric: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await gdSearch("记账探针C", 10);
    expect(lyricNeedsUpstream("记账探针C")).toBe(true);
    await gdLyric("p3"); // worker 侧按 lyric_id 取歌词
    expect(lyricNeedsUpstream("记账探针C")).toBe(false);
  });
});
