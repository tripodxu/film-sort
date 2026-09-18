import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLyricLines, gdLyric, gdPlay } from "./gdMusic";

/**
 * 失败原因必须能从 Worker 传到界面。
 *
 * 旧实现把 429（本机限流）/ 429（上游限流）/ 404（没这首歌）/ 502（服务不可用）
 * 全部折叠成 null，界面只能显示"未找到可试听的版本"。而试听+歌词共享
 * 12 次/10 分钟的额度——用户连点几首就会撞上，却被告知"这首歌没有"，
 * 现场看就是"试听坏了"。
 */

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("gdPlay 的失败分类", () => {
  it("本机触发限流：reason=rate_limited，并带上服务端的重试秒数", async () => {
    stub(429, { error: "rate_limited" }, { "retry-after": "600" });
    const result = await gdPlay("童话", "光良");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("rate_limited");
    // 窗口是 10 分钟，服务端必须报 600 而不是 60（否则客户端按 60 秒重试仍被拦）
    expect(result.error.retryAfter).toBe(600);
  });

  it("上游限流：reason=upstream_limited", async () => {
    stub(429, { error: "music_upstream_limited" }, { "retry-after": "300" });
    const result = await gdPlay("童话");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("upstream_limited");
  });

  it("没这首歌：reason=not_found", async () => {
    stub(404, { error: "music_not_found" });
    const result = await gdPlay("不存在的歌");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("not_found");
  });

  it("服务不可用：reason=unavailable", async () => {
    stub(502, { error: "music_search_failed" });
    const result = await gdPlay("童话");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("unavailable");
  });

  it("网络异常也归类为 unavailable，而不是抛出", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("network down"); });
    const result = await gdPlay("童话");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("unavailable");
  });

  it("成功时返回播放链，且 audio 主机在 media-src 白名单内（*.music.126.net）", async () => {
    stub(200, { track: { id: "85580", name: "童话", artist: ["光良"] }, playUrl: "https://m801.music.126.net/x/y.mp3", isCover: false });
    const result = await gdPlay("童话", "光良");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.playUrl).toContain("music.126.net");
    expect(result.value.isCover).toBe(false);
    expect(result.value.artistName).toBe("光良");
  });
});

describe("gdLyric 的失败分类", () => {
  it("限流与缺歌词要分得开", async () => {
    stub(429, { error: "rate_limited" }, { "retry-after": "600" });
    const limited = await gdLyric("童话");
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.reason).toBe("rate_limited");

    stub(404, { error: "lyric_not_found" });
    const missing = await gdLyric("童话");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.reason).toBe("not_found");
  });

  it("成功时同时带回原文与译文（译文可为空）", async () => {
    stub(200, { title: "童话", artist: "光良", lyric: "忘了有多久", tlyric: "" });
    const result = await gdLyric("童话", "光良");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lyric).toBe("忘了有多久");
    expect(result.value.tlyric).toBe("");
  });

  it("带回译文时界面能拿到（不再被丢掉）", async () => {
    stub(200, { title: "Yellow", artist: "Coldplay", lyric: "Look at the stars", tlyric: "抬头看星星" });
    const result = await gdLyric("Yellow", "Coldplay");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tlyric).toBe("抬头看星星");
  });
});

describe("buildLyricLines：原文与译文的行对齐", () => {
  it("没有译文时只出原文行", () => {
    expect(buildLyricLines("第一句\n第二句", "")).toEqual([
      { text: "第一句", translation: "" },
      { text: "第二句", translation: "" },
    ]);
  });

  it("行数一致时逐行配对", () => {
    expect(buildLyricLines("Look at the stars\nAnd everything you do", "抬头看星星\n你做的每一件事")).toEqual([
      { text: "Look at the stars", translation: "抬头看星星" },
      { text: "And everything you do", translation: "你做的每一件事" },
    ]);
  });

  it("行数不一致时译文单独成段，绝不逐行错位配对", () => {
    // stripLrc 会对原文/译文各自去空行与去重，行数真的可能不同
    const lines = buildLyricLines("第一句\n第二句\n第三句", "First\nSecond");
    expect(lines).toEqual([
      { text: "第一句", translation: "" },
      { text: "第二句", translation: "" },
      { text: "第三句", translation: "" },
      { text: "", translation: "First\nSecond" },
    ]);
    // 每一条要么是纯原文、要么是纯译文，不存在"甲句配乙句译文"
    expect(lines.filter((line) => line.text && line.translation)).toHaveLength(0);
  });

  it("忽略空行；整段译文独占一条（text 为空）", () => {
    const lines = buildLyricLines("A\n\nB", "甲");
    expect(lines).toEqual([
      { text: "A", translation: "" },
      { text: "B", translation: "" },
      { text: "", translation: "甲" },
    ]);
  });
});
