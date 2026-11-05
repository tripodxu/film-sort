/**
 * 浏览器本地配置的统一存取。
 *
 * AI 点评（`aiInsight.ts`）与 Jev（`typesafe.ts`）过去各写了一份
 * 「读 JSON → 校验 → 写 → 删」，隐私模式降级语义也各写各的，
 * 新增第三份配置时必然漂移。这里只收敛**存储机制**：
 * 领域校验（哪些字段合法、协议白名单）仍留在各自模块。
 *
 * 三条约定：读失败一律返回 null（绝不抛到渲染期），
 * 写返回「是否落盘成功」供 UI 提示「仅本次会话有效」，
 * 删除永远不因存储不可用而打断主链路。
 */

/** 读一份 JSON 配置；键不存在、脏 JSON、存储被禁用一律返回 null。 */
export function readJsonConfig(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 写一份配置；false 表示浏览器存储不可用（隐私模式 / 配额用尽）。 */
export function writeJsonConfig(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearConfig(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 隐私模式 */
  }
}
