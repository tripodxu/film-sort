import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shareOutputLabels } from "./shareLink";

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
    // 「复制比较链接」没有 disabled，两类请求可能并发，因此代际守卫必须存在两处。
    expect(app.match(/const generation = \+\+shareGenRef\.current/g)?.length).toBe(2);
  });
});
