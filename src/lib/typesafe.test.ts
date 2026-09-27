import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTasteContext,
  clearTypesafeConfig,
  jevFailureText,
  readTypesafeConfig,
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
    expect(jevFailureText({ ok: false, error: "upstream_error", msg: "上游炸了" }, t)).toBe("上游炸了");
    expect(jevFailureText({ ok: false, error: "upstream_auth_failed" }, t)).toContain("Key");
  });
});
