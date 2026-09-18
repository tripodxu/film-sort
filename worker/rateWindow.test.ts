import { describe, expect, it } from "vitest";
import {
  MAX_RATE_WINDOWS,
  RATE_WINDOW_MS,
  consumeIsolateWindow,
  type RateWindow,
} from "./rateWindow";

const T0 = 1_700_000_000_000;

describe("consumeIsolateWindow", () => {
  it("首次请求放行并开始计数", () => {
    const windows = new Map<string, RateWindow>();
    expect(consumeIsolateWindow(windows, "posters:1.1.1.1", 3, T0)).toBe(true);
    expect(windows.get("posters:1.1.1.1")).toEqual({ startedAt: T0, count: 1 });
  });

  it("累计到上限后拒绝，且不再自增", () => {
    const windows = new Map<string, RateWindow>();
    const key = "posters:1.1.1.1";
    expect(consumeIsolateWindow(windows, key, 2, T0)).toBe(true);
    expect(consumeIsolateWindow(windows, key, 2, T0 + 1)).toBe(true);
    expect(consumeIsolateWindow(windows, key, 2, T0 + 2)).toBe(false);
    expect(consumeIsolateWindow(windows, key, 2, T0 + 3)).toBe(false);
    // 被拒绝的请求不应该把计数推高——否则窗口结束后仍会被多拦几次。
    expect(windows.get(key)?.count).toBe(2);
  });

  it("窗口过期后重新放行并从头计数", () => {
    const windows = new Map<string, RateWindow>();
    const key = "posters:1.1.1.1";
    consumeIsolateWindow(windows, key, 1, T0);
    expect(consumeIsolateWindow(windows, key, 1, T0 + 1)).toBe(false);
    const later = T0 + RATE_WINDOW_MS + 1;
    expect(consumeIsolateWindow(windows, key, 1, later)).toBe(true);
    expect(windows.get(key)).toEqual({ startedAt: later, count: 1 });
  });

  it("不同桶与不同 IP 互不影响", () => {
    const windows = new Map<string, RateWindow>();
    consumeIsolateWindow(windows, "music_play:1.1.1.1", 1, T0);
    // 同一 IP 的另一个桶
    expect(consumeIsolateWindow(windows, "music_lyric:1.1.1.1", 1, T0)).toBe(true);
    // 同一桶的另一个 IP
    expect(consumeIsolateWindow(windows, "music_play:2.2.2.2", 1, T0)).toBe(true);
    // 撞满的那个仍然被拦
    expect(consumeIsolateWindow(windows, "music_play:1.1.1.1", 1, T0)).toBe(false);
  });
});

describe("窗口 Map 的容量上界", () => {
  it("灌入远超上界的 IP 后 Map 不再增长", () => {
    const windows = new Map<string, RateWindow>();
    for (let index = 0; index < MAX_RATE_WINDOWS + 500; index += 1) {
      consumeIsolateWindow(
        windows,
        `posters:10.0.${Math.floor(index / 250)}.${index % 250}`,
        60,
        T0,
      );
    }
    expect(windows.size).toBeLessThanOrEqual(MAX_RATE_WINDOWS);
  });

  it("优先清扫已过期条目，而不是误伤活跃窗口", () => {
    const windows = new Map<string, RateWindow>();
    // 先铺满一批「早就过期」的窗口
    for (let index = 0; index < MAX_RATE_WINDOWS; index += 1) {
      windows.set(`posters:old-${index}`, { startedAt: T0, count: 60 });
    }
    // 再写入一个新键：此刻 size 刚超过上界，触发清扫
    const now = T0 + RATE_WINDOW_MS + 1;
    expect(consumeIsolateWindow(windows, "posters:fresh", 60, now)).toBe(true);
    // 过期条目应被全部清掉，只留下刚写入的那一个
    expect(windows.size).toBe(1);
    expect(windows.has("posters:old-0")).toBe(false);
    expect(windows.get("posters:fresh")).toEqual({ startedAt: now, count: 1 });
  });

  it("淘汰只会放宽，不会让活跃用户名下的额度变紧", () => {
    const windows = new Map<string, RateWindow>();
    const key = "posters:9.9.9.9";
    consumeIsolateWindow(windows, key, 60, T0);
    // 用一个新键把它挤出上界
    for (let index = 0; index < MAX_RATE_WINDOWS + 10; index += 1) {
      consumeIsolateWindow(windows, `other:8.8.${Math.floor(index / 250)}.${index % 250}`, 60, T0);
    }
    // 无论它是否被淘汰，重新发起都应当被放行（被淘汰=窗口重置）
    expect(consumeIsolateWindow(windows, key, 60, T0 + 1)).toBe(true);
  });
});
