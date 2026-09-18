import { afterEach, describe, expect, it, vi } from "vitest";
import { gdSearch, pickTrack, pickTracks, type GdTrack } from "./gdstudio";

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

const track = (id: string, name: string, artist: string[] | string): GdTrack => ({ id, name, artist });

describe("pickTracks 只认歌名对得上的命中", () => {
  const results = [
    track("1", "第一次", ["光良"]),           // 同歌手但不是这首歌
    track("2", "童话", ["光良"]),
    track("3", "童话 (Live)", ["光良"]),
    track("4", "童话", ["陆锦舟"]),
    track("5", "Can't Give Up", ["ZXXXQ"]),   // 与查询完全无关
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
});

describe("gdSearch 的缓存只吃结构性正确的响应", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("非数组响应（200 + 错误 JSON）不会被缓存成「搜不到」", async () => {
    let calls = 0;
    let body: unknown = { error: "upstream_unavailable" };
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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
      return new Response(JSON.stringify([track("8", "缓存探针", ["某人"])]), { status: 200, headers: { "content-type": "application/json" } });
    });

    await gdSearch("缓存探针", 10);
    await gdSearch("缓存探针", 10);
    expect(calls).toBe(1);
  });
});
