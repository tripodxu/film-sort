// 缓存分代清除编排：海报 / 文字(简介) / 歌曲 / 其他 四个作用域。
//
// 两层机制：
//  1. 本地清除——各模块通过 registerPurger 注册自己的内存缓存清除函数，
//     purgeCaches 时在「当前 isolate」立即生效；
//  2. 代次失效——把新代次写入 D1 admin_config（cache_gen:<scope>），所有
//     isolate 每 60s 刷新一次已知代次；把代次编进键的缓存（海报 L2 边缘摘要、
//     路由级边缘缓存、简介/歌曲键前缀）在新代次下自然全部未命中，旧条目孤儿化。
//
// 不清除的东西（有意为之）：限流窗口与熔断器状态——清缓存不应变成绕过限流的入口。

export type CacheScope = "posters" | "intro" | "music" | "misc" | "all";
export const PURGEABLE_SCOPES: readonly Exclude<CacheScope, "all">[] = [
  "posters",
  "intro",
  "music",
  "misc",
];

const CONFIG_PREFIX = "cache_gen:";
const GENERATION_REFRESH_MS = 60_000;

const generations = new Map<Exclude<CacheScope, "all">, { value: string; fetchedAt: number }>();
type Purger = () => number;
const purgers = new Map<Exclude<CacheScope, "all">, Purger[]>();

/** 各模块在加载时注册自己的缓存清除函数；返回清除的条目数用于展示。 */
export function registerPurger(scope: Exclude<CacheScope, "all">, fn: Purger): void {
  const list = purgers.get(scope) ?? [];
  list.push(fn);
  purgers.set(scope, list);
}

export function isCacheScope(value: unknown): value is Exclude<CacheScope, "all"> {
  return typeof value === "string" && (PURGEABLE_SCOPES as readonly string[]).includes(value);
}

/** 同步取当前已知代次（键前缀用）；isolate 内 60s 刷新一次，清除时立即更新。 */
export function generationOf(scope: Exclude<CacheScope, "all">): string {
  return generations.get(scope)?.value ?? "0";
}

/** 从 D1 刷新已知代次（有 60s 节流；D1 不可用时沿用当前值，键保持稳定）。 */
export async function refreshGenerations(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  const now = Date.now();
  const stale = PURGEABLE_SCOPES.filter((s) => {
    const hit = generations.get(s);
    return !hit || now - hit.fetchedAt > GENERATION_REFRESH_MS;
  });
  if (!stale.length) return;
  try {
    const rows = await db
      .prepare(
        `SELECT key, value FROM admin_config WHERE key IN (${stale.map(() => "?").join(", ")})`,
      )
      .bind(...stale.map((s) => CONFIG_PREFIX + s))
      .all<{ key: string; value: string }>();
    const byKey = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
    for (const scope of stale)
      generations.set(scope, { value: byKey.get(CONFIG_PREFIX + scope) || "0", fetchedAt: now });
  } catch {
    /* 网络抖动沿用旧代次：键保持稳定比强行失效更重要 */
  }
}

/** 只清本 isolate 的内存缓存；返回各作用域清除的条目数。 */
export function purgeLocal(scopes: readonly Exclude<CacheScope, "all">[]): Record<string, number> {
  const purged: Record<string, number> = {};
  for (const scope of scopes) {
    let total = 0;
    for (const fn of purgers.get(scope) ?? []) {
      try {
        total += fn();
      } catch {
        /* 单个清除器失败不拖垮整体 */
      }
    }
    purged[scope] = total;
  }
  return purged;
}

/** 清除 + 推进代次（写 D1）。scope=all 时作用于全部四个作用域。 */
export async function purgeCaches(
  db: D1Database | undefined,
  scope: CacheScope,
): Promise<{ purged: Record<string, number>; generation: Record<string, string> }> {
  const targets = scope === "all" ? PURGEABLE_SCOPES : [scope];
  const purged = purgeLocal(targets);
  const stamp = String(Date.now());
  if (db) {
    for (const s of targets) {
      await db
        .prepare(
          "INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(CONFIG_PREFIX + s, stamp)
        .run();
      generations.set(s, { value: stamp, fetchedAt: Date.now() });
    }
  }
  const generation: Record<string, string> = {};
  for (const s of targets) generation[s] = generations.get(s)?.value ?? "0";
  return { purged, generation };
}
