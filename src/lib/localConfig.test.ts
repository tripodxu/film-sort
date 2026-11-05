import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfig, readJsonConfig, writeJsonConfig } from "./localConfig";

const KEY = "art-rank:test-config";

function memoryStorage(overrides: Partial<Storage> = {}) {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      ...overrides,
    } as unknown as Storage,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage().storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localConfig 存储机制", () => {
  it("键不存在返回 null，不抛错", () => {
    expect(readJsonConfig(KEY)).toBeNull();
  });

  it("脏 JSON 返回 null，不把解析异常漏到渲染期", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readJsonConfig(KEY)).toBeNull();
  });

  it("顶层是数组 / 标量时原样交回调用方，由领域校验决定收不收", () => {
    expect(writeJsonConfig(KEY, [1, 2])).toBe(true);
    expect(readJsonConfig(KEY)).toEqual([1, 2]);
    expect(writeJsonConfig(KEY, "scalar")).toBe(true);
    expect(readJsonConfig(KEY)).toBe("scalar");
  });

  it("正常对象往返一致", () => {
    const config = { baseUrl: "https://x/v1", apiKey: "sk", model: "m" };
    expect(writeJsonConfig(KEY, config)).toBe(true);
    expect(readJsonConfig(KEY)).toEqual(config);
  });

  it("读取时存储抛错（隐私模式）返回 null", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        getItem: () => {
          throw new Error("blocked");
        },
      }).storage,
    );
    expect(readJsonConfig(KEY)).toBeNull();
  });

  it("写入失败返回 false，删除失败也不抛", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      }).storage,
    );
    expect(writeJsonConfig(KEY, { a: 1 })).toBe(false);
    expect(() => clearConfig(KEY)).not.toThrow();
  });

  it("删除后读回 null", () => {
    writeJsonConfig(KEY, { a: 1 });
    clearConfig(KEY);
    expect(readJsonConfig(KEY)).toBeNull();
  });
});
