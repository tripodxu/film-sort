import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DeadlineError, withDeadline } from "./deadline";

describe("上游链总预算（worker/deadline.ts）", () => {
  it("未超预算时原样返回结果，并清掉计时器", async () => {
    vi.useFakeTimers();
    try {
      const work = Promise.resolve("ok");
      const result = await withDeadline(work, 10_000, "test-fast");
      expect(result).toBe("ok");
      // 计时器必须被清掉：否则每个请求都会留一个挂起的 setTimeout。
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("超预算抛 DeadlineError（带 label 与预算毫秒），不是普通 Error", async () => {
    vi.useFakeTimers();
    try {
      let rejectWork: ((error: Error) => void) | undefined;
      const work = new Promise<string>((_, reject) => {
        rejectWork = reject;
      });
      const guarded = withDeadline(work, 50, "test-slow");
      const settled = guarded.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(60);
      const error = await settled;
      expect(error).toBeInstanceOf(DeadlineError);
      expect(error).toMatchObject({ label: "test-slow", ms: 50 });
      // 被放弃的 promise 之后 reject 也不能变成 unhandled rejection：
      // Promise.race 已经给它挂过处理器，这里再 reject 一次应当静默。
      rejectWork?.(new Error("late failure"));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("DeadlineError 的 name/message 可定位到具体链路", () => {
    const error = new DeadlineError("other-detail", 25_000);
    expect(error.name).toBe("DeadlineError");
    expect(error.message).toContain("other-detail");
    expect(error.message).toContain("25000");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("接入范围绊线（漏一处就等于没修）", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const mediaSource = readFileSync(new URL("./media.ts", import.meta.url), "utf8");

  it("三个维基端点都挂了总预算，且超时返 504 no-store（不缓存瞬时故障）", () => {
    for (const label of ["other-detail", "artwork-detail-other", "other-candidates"]) {
      expect(indexSource).toContain(`"${label}"`);
    }
    expect(indexSource).toContain("if (error instanceof DeadlineError) return upstreamTimeout();");
    const helper = indexSource.slice(indexSource.indexOf("function upstreamTimeout"));
    expect(helper).toContain("504");
    expect(helper).toContain("no-store");
  });

  it("预算必须短于前端 30s 的详情超时，否则等于没设", () => {
    const budgets = [...indexSource.matchAll(/OTHER_(?:DETAIL|CANDIDATES)_DEADLINE_MS = ([\d_]+)/g)]
      .map((match) => Number(match[1].replaceAll("_", "")))
      .concat(
        [...mediaSource.matchAll(/OTHER_POSTER_DEADLINE_MS = ([\d_]+)/g)].map((match) =>
          Number(match[1].replaceAll("_", "")),
        ),
      );
    expect(budgets).toHaveLength(3);
    for (const ms of budgets) {
      expect(ms).toBeGreaterThan(5_000);
      expect(ms).toBeLessThan(30_000);
    }
  });

  it("「其他类」海报链超时按 throttled 记账（15s 负缓存），不许记 absent（24h）", () => {
    const at = mediaSource.indexOf('"other-poster"');
    expect(at).toBeGreaterThan(0);
    // 注释里会提到「不能记成 absent」作为反例，断言只看代码行。
    const wrapped = mediaSource
      .slice(at - 500, at + 500)
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(wrapped).toContain("OTHER_POSTER_DEADLINE_MS");
    expect(wrapped).toContain("error instanceof DeadlineError");
    expect(wrapped).toContain('outcome: "throttled"');
    expect(wrapped).not.toContain("absent");
  });
});
