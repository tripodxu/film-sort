import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareLinkOf, shareOutputLabels } from "./shareLink";

const zh = (a: string) => a;

describe("分享输出区标签", () => {
  it("比较链接与分享链接使用各自的输入框名称与二维码描述", () => {
    expect(shareOutputLabels("compare", zh)).toEqual({
      inputLabel: "比较链接",
      qrAlt: "比较二维码",
    });
    expect(shareOutputLabels("share", zh)).toEqual({
      inputLabel: "分享链接",
      qrAlt: "分享二维码",
    });
  });

  it("画像页输出区的标签与二维码都跟随实际链接类型", () => {
    const view = readFileSync("src/views/ProfileView.tsx", "utf8");
    expect(view).toMatch(/aria-label=\{shareOutputLabels\(shareLinkKind, t\)\.inputLabel\}/);
    expect(view).toMatch(/alt=\{shareOutputLabels\(shareLinkKind, t\)\.qrAlt\}/);
    expect(view).not.toMatch(/aria-label=\{t\("比较链接"/);
  });

  it("两类链接写入输出区时都先声明类型并换成自己的二维码，迟到的旧响应被丢弃", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const compare = app.slice(
      app.indexOf("async function share()"),
      app.indexOf("function openShareModal"),
    );
    const share = app.slice(
      app.indexOf("async function generateShareLink"),
      app.indexOf("let content: ReactNode"),
    );
    for (const [block, kind, url] of [
      [compare, "compare", "data.compareUrl"],
      [share, "share", "data.url"],
    ] as const) {
      expect(block).toMatch(/const generation = \+\+shareGenRef\.current;/);
      expect(block).toMatch(/if \(generation !== shareGenRef\.current\) return;/);
      expect(block).toMatch(
        new RegExp(
          `setShareLinkKind\\("${kind}"\\);\\s*setShareUrl\\(${url.replace(".", "\\.")}\\);\\s*setQrUrl\\(await makeQr\\(`,
        ),
      );
    }
    // R3 起两个按钮都有 disabled={busy} + 入口 busy 守卫；代际守卫仍须存在两处，
    // 兜住程序化调用与同刻双击等绕过 UI 门控的路径（断言本身未变）。
    expect(app.match(/const generation = \+\+shareGenRef\.current/g)?.length).toBe(2);
  });
});

describe("比较链接兜底改写（AUDIT-2026-11-25-R3）", () => {
  it("compareUrl 优先", () => {
    expect(
      compareLinkOf({
        compareUrl: "https://x/encounter?payload=abc12345",
        url: "https://x/share/abc12345",
      }),
    ).toBe("https://x/encounter?payload=abc12345");
  });

  it("compareUrl 缺失时把 /share/<code> 改写成比较地址", () => {
    expect(compareLinkOf({ url: "https://x/share/abc12345" })).toBe(
      "https://x/encounter?payload=abc12345",
    );
  });

  it("形状不匹配必须返回 undefined，绝不把分享页 URL 当比较链接复制", () => {
    expect(compareLinkOf({ url: "https://x/share/xyz" })).toBeUndefined();
    expect(compareLinkOf({ url: "https://x/other/abc12345" })).toBeUndefined();
    expect(compareLinkOf({ url: "https://x/share/abc12345?from=plaza" })).toBeUndefined();
    expect(compareLinkOf({})).toBeUndefined();
  });

  it("单榜分享接线：App 用 compareLinkOf 取代内联改写", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const block = app.slice(
      app.indexOf("async function shareSingleRanking"),
      app.indexOf("async function publishToPlaza"),
    );
    expect(block).toContain("const link = compareLinkOf(data);");
    expect(block).not.toMatch(/data\.url\.replace\(/);
  });
});
