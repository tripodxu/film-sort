import { describe, expect, it } from "vitest";
import {
  absolutizePoster,
  buildOgMeta,
  buildPlazaTags,
  buildShareTags,
  escapeHtml,
  injectOg,
  ogText,
} from "./og";

const SPA = "<!doctype html><html><head><title>ART/RANK</title></head><body></body></html>";

describe("escapeHtml / ogText", () => {
  it("转义全部危险字符", () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&#39;f");
  });
  it("ogText 压平空白并截断,且已转义", () => {
    expect(ogText("  a\n\nb   c  ", 4)).toBe("a b ");
    const out = ogText('<script>&"</script>', 200);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("injectOg", () => {
  it("插入在 </head> 之前", () => {
    const out = injectOg(SPA, '<meta property="og:title" content="x" />');
    expect(out.indexOf("og:title")).toBeGreaterThan(-1);
    expect(out.indexOf("og:title")).toBeLessThan(out.indexOf("</head>"));
  });
  it("无 </head> 结构时原样返回(降级)", () => {
    expect(injectOg("<html><body>hi</body></html>", "<meta />")).toBe(
      "<html><body>hi</body></html>",
    );
  });
});

describe("buildShareTags", () => {
  const profile = {
    profileName: "徐鼎",
    rankings: [
      {
        kind: "film",
        collectionTitle: "豆瓣高分片单",
        items: [{ title: "千与千寻" }, { title: "美丽人生" }],
      },
      { kind: "music", collectionTitle: "歌单", items: [{ title: "A" }] },
    ],
  };
  it("标题/描述/URL 齐备,含 No.1 与榜单数", () => {
    const tags = buildShareTags(JSON.stringify(profile), "https://x.io/share/abc");
    expect(tags?.title).toBe("徐鼎 的艺术人格");
    expect(tags?.description).toContain("2 份榜单");
    expect(tags?.description).toContain("《千与千寻》");
    expect(tags?.url).toBe("https://x.io/share/abc");
  });
  it("单榜单描述走 Top N 句式", () => {
    const tags = buildShareTags(
      JSON.stringify({ ...profile, rankings: profile.rankings.slice(0, 1) }),
      "https://x.io/share/abc",
    );
    expect(tags?.description).toContain("Top 2");
  });
  it("恶意内容被转义", () => {
    const evil = {
      profileName: "<img src=x onerror=alert(1)>",
      rankings: [{ collectionTitle: '"></script>', items: [{ title: "A" }] }],
    };
    const tags = buildShareTags(JSON.stringify(evil), "https://x.io/s");
    expect(tags?.title).not.toContain("<img");
    expect(tags?.title).toContain("&lt;img");
  });
  it("畸形 JSON / 空榜单 → null(降级为无 OG)", () => {
    expect(buildShareTags("{oops", "u")).toBeNull();
    expect(buildShareTags(JSON.stringify({ rankings: [] }), "u")).toBeNull();
  });
});

describe("buildPlazaTags", () => {
  const row = {
    collection_title: "世界耳机清单",
    kind: "music",
    item_count: 6,
    nickname: "小徐",
    items: JSON.stringify([{ title: "范特西" }]),
    topPosterUrl: "https://img1.doubanio.com/f.jpg",
  };
  it("标题/描述齐备,og:image 走代理绝对地址", () => {
    const tags = buildPlazaTags(row, "https://x.io/plaza/1", "https://x.io");
    expect(tags?.title).toBe("世界耳机清单 · 文化广场");
    expect(tags?.description).toContain("小徐");
    expect(tags?.description).toContain("6 件作品");
    expect(tags?.image).toBe(
      "https://x.io/api/image?url=" + encodeURIComponent("https://img1.doubanio.com/f.jpg"),
    );
  });
  it("items 畸形不失败,描述无 No.1", () => {
    const tags = buildPlazaTags({ ...row, items: "{oops" }, "u", "https://x.io");
    expect(tags).not.toBeNull();
    expect(tags?.description).not.toContain("No.1");
  });
});

describe("absolutizePoster", () => {
  it("豆瓣域改写为图片代理;其余原样;非法输入 undefined", () => {
    expect(absolutizePoster("https://img2.doubanio.com/a.jpg", "https://x.io")).toBe(
      "https://x.io/api/image?url=" + encodeURIComponent("https://img2.doubanio.com/a.jpg"),
    );
    expect(absolutizePoster("https://cdn.example.com/b.jpg", "https://x.io")).toBe(
      "https://cdn.example.com/b.jpg",
    );
    expect(absolutizePoster("not a url", "https://x.io")).toBeUndefined();
  });
});

describe("buildOgMeta", () => {
  it("含 twitter:card,有图时 large", () => {
    const withImage = buildOgMeta({ title: "t", description: "d", image: "i" });
    expect(withImage).toContain('name="twitter:card" content="summary_large_image"');
    const noImage = buildOgMeta({ title: "t", description: "d" });
    expect(noImage).toContain('content="summary"');
    expect(noImage).not.toContain("og:image");
  });
});
