import { describe, expect, it } from "vitest";
import { emptyPosterState, emptyPosterMessageKey } from "./posterOutcome";

/**
 * 空封面三态的判据（PLAN-EMPTY-COVER-STATE）。
 *
 * 这个模块存在的唯一理由是「服务端已经算出来的分类，前端却拿不到」：
 * 一旦它在某个分支上把 throttled 猜成 absent，用户就永远卡在空格子，
 * 因为 absent 分支刻意不提供任何重试入口。
 */

describe("emptyPosterState", () => {
  it("有图就永远不进空态分支（哪怕 outcome 是 throttled）", () => {
    expect(emptyPosterState(["https://x/a.jpg"], "throttled")).toBeNull();
    expect(emptyPosterState(["https://x/a.jpg"], "absent")).toBeNull();
    expect(emptyPosterState(["https://x/a.jpg"], undefined)).toBeNull();
  });

  it("空 + throttled ⇒ degraded（唯一该给重试的一档）", () => {
    expect(emptyPosterState([], "throttled")).toBe("degraded");
    expect(emptyPosterState(undefined, "throttled")).toBe("degraded");
  });

  it("空 + absent ⇒ none（24 小时负缓存，重试没有意义，不打扰）", () => {
    expect(emptyPosterState([], "absent")).toBe("none");
    expect(emptyPosterState(undefined, "absent")).toBe("none");
  });

  it("空 + 没给分类 ⇒ unknown，绝不猜成 absent", () => {
    // 这一条是本模块最重要的不变量：猜错的方向必须是「多说一句」而不是「永不提供出路」。
    expect(emptyPosterState([], undefined)).toBe("unknown");
    expect(emptyPosterState(undefined, undefined)).toBe("unknown");
  });

  it("不认识的值也按 unknown（服务端将来加档位时前端不会崩、也不会变吵）", () => {
    // @ts-expect-error 故意模拟服务端加了第四档而前端还没跟上
    expect(emptyPosterState([], "rate_limited")).toBe("unknown");
    // @ts-expect-error null 不是合法分类
    expect(emptyPosterState([], null)).toBe("unknown");
  });

  it("found 传进来也按 unknown（空格子 + found 是自相矛盾的，不该当真）", () => {
    // 服务端若某天把「空但 found」当成正常返回，宁可保守也不给重试按钮。
    expect(emptyPosterState([], "found")).toBe("unknown");
  });
});

describe("emptyPosterMessageKey", () => {
  it("三态一一对应，不做合并", () => {
    // 新增一档状态时这里必须同步补：type 的窄联合是编译器强制的。
    expect(emptyPosterMessageKey("none")).toBe("none");
    expect(emptyPosterMessageKey("degraded")).toBe("degraded");
    expect(emptyPosterMessageKey("unknown")).toBe("unknown");
  });
});
