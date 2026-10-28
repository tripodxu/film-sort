import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSIST_THRESHOLD_CHOICES,
  ASSIST_THRESHOLD_DEFAULT,
  ASSIST_THRESHOLD_MAX,
  ASSIST_THRESHOLD_MIN,
  buildTasteContext,
  clearTypesafeConfig,
  jevFailureText,
  readJevAssistThreshold,
  readTypesafeConfig,
  writeJevAssistThreshold,
  writeTypesafeConfig,
} from "./typesafe";

// node 环境没有 localStorage:与 aiInsight.test.ts 同款内存实现。
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

describe("配置存取", () => {
  it("写入后可读回;损坏数据返回 null;clear 移除", () => {
    expect(readTypesafeConfig()).toBeNull();
    writeTypesafeConfig({ apiKey: "ts_key12345" });
    expect(readTypesafeConfig()).toEqual({ apiKey: "ts_key12345" });
    store.set("art-rank:typesafe-config", "{oops");
    expect(readTypesafeConfig()).toBeNull();
    clearTypesafeConfig();
    expect(store.has("art-rank:typesafe-config")).toBe(false);
  });
});

describe("buildTasteContext", () => {
  it("按榜单压成 `[kind] 标题: A > B` 行,截断到上限", () => {
    const context = buildTasteContext([
      { kind: "film", collectionTitle: "片单A", items: [{ title: "A" }, { title: "B" }] },
      { kind: "music", collectionTitle: "歌单B", items: [{ title: "C" }] },
    ]);
    expect(context).toBe("[film] 片单A: A > B\n[music] 歌单B: C");
    expect(buildTasteContext([], 1).length).toBeLessThanOrEqual(1);
  });
  it("单榜单只取前 20 件", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `作品${i}` }));
    const context = buildTasteContext([{ kind: "film", collectionTitle: "X", items: many }]);
    expect(context).not.toContain("作品20");
  });
});

describe("jevFailureText", () => {
  it("优先透出服务端 msg,否则按错误码给双语默认", () => {
    const t = (zh: string) => zh;
    expect(jevFailureText({ ok: false, error: "upstream_error", msg: "上游炸了" }, t)).toBe(
      "上游炸了",
    );
    expect(jevFailureText({ ok: false, error: "upstream_auth_failed" }, t)).toContain("Key");
  });

  it("地区限制（451）说白了是「服务方限制」，不能让用户去查自己的 key", () => {
    const zh = (text: string) => text;
    const text = jevFailureText({ ok: false, error: "upstream_blocked" }, zh);
    expect(text).toContain("地区");
    expect(text).toContain("与 key 无关");
  });
});

describe("代判阈值设置项", () => {
  it("未设置时返回默认 0.8，写入后可读回", () => {
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
    expect(writeJevAssistThreshold(0.6)).toBe(true);
    expect(readJevAssistThreshold()).toBe(0.6);
  });

  it("损坏值 / 越界值一律回落默认值，绝不把 NaN 带进阈值比较", () => {
    store.set("art-rank:jev-assist-threshold", "{oops");
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
    store.set("art-rank:jev-assist-threshold", "0.2");
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
    store.set("art-rank:jev-assist-threshold", "1.4");
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
    store.set("art-rank:jev-assist-threshold", "");
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
  });

  it("写入前夹到 [MIN, MAX]；非数值写默认", () => {
    writeJevAssistThreshold(0.1);
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_MIN);
    writeJevAssistThreshold(0.99);
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_MAX);
    writeJevAssistThreshold(Number.NaN);
    expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
  });

  it("存储不可用（隐私模式）时读默认、写返回 false，不抛错", () => {
    const original = globalThis.localStorage;
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    try {
      expect(readJevAssistThreshold()).toBe(ASSIST_THRESHOLD_DEFAULT);
      expect(writeJevAssistThreshold(0.7)).toBe(false);
    } finally {
      vi.stubGlobal("localStorage", original);
    }
  });

  it("档位表覆盖默认值，且都在合法区间内", () => {
    expect(ASSIST_THRESHOLD_CHOICES).toContain(ASSIST_THRESHOLD_DEFAULT);
    for (const value of ASSIST_THRESHOLD_CHOICES) {
      expect(value).toBeGreaterThanOrEqual(ASSIST_THRESHOLD_MIN);
      expect(value).toBeLessThanOrEqual(ASSIST_THRESHOLD_MAX);
    }
  });
});
