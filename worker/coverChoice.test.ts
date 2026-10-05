import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";
import { posterMediaKey } from "../shared/posterKey";

/**
 * POST /api/other/cover-choice（PLAN-CHOICE-UI §3.3）。
 *
 * 这个端点把**用户的选择**写进全站共用的 `poster_urls` 表。三道闸门任缺其一，
 * 用户看到的封面就可能被换掉，所以按闸门逐个钉：
 *  ① 同源（assertSameOrigin）—— 缺 `Origin` 且无 `Sec-Fetch-Site` 一律 403。
 *  ② 登录（getUserFromToken）—— 匿名 401，且不落地任何行。
 *  ③ 维基域白名单（allowedImage + hostname 精确匹配）—— 非维基地址 400。
 * 外加一条最容易写错的不变量：**写入用的键必须等于前端 Poster 的兜底键**。
 *
 * fake D1 只按 SQL 前缀应答，够跑 getUserFromToken 与 poster_urls 两条路径；
 * `caches` 在 node 环境不存在，allowUpstreamRequest 的 Edge 分支被它自己的
 * try/catch 吞掉，限流退化为 isolate 内存窗口——本文件请求数远低于 20 的配额。
 */

const TOKEN = "t".repeat(40);
const OK_URL = "https://upload.wikimedia.org/wikipedia/zh/a/ab/Journey_PSN_Cover.png";
const OK_TITLE = "Journey";
const OK_YEAR = 2012;
const VALID_BODY = {
  title: OK_TITLE,
  english: OK_TITLE,
  year: OK_YEAR,
  wikiTitle: "风之旅人",
  url: OK_URL,
};

function fakeDb(options: { token?: string } = {}): {
  db: D1Database;
  rows: Map<string, string>;
  auditRows: Array<unknown[]>;
} {
  const rows = new Map<string, string>();
  const auditRows: Array<unknown[]> = [];
  const db = {
    prepare(sql: string) {
      const bound = {
        first: async () => {
          if (/FROM user_sessions/.test(sql)) {
            return options.token ? { id: 1, email: "reader@example.com" } : null;
          }
          return null;
        },
        run: async () => {
          if (/INSERT INTO poster_urls/.test(sql)) {
            rows.set(String(boundArgs[0]), String(boundArgs[1]));
          }
          if (/INSERT INTO admin_audit/.test(sql)) {
            auditRows.push([...boundArgs]);
          }
          return { success: true, meta: {} };
        },
        all: async () => {
          if (/FROM poster_urls WHERE media_key IN/.test(sql)) {
            return {
              results: boundArgs
                .map((arg) => String(arg))
                .filter((key) => rows.has(key))
                .map((key) => ({ media_key: key, urls: rows.get(key) as string })),
            };
          }
          return { results: [] };
        },
      };
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return bound;
        },
      };
    },
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      // saveResolvedPosters 走的是 db.batch([...prepare().bind()])，不逐条调 run 就等于没写。
      for (const statement of statements) await statement.run();
      return [];
    },
  };
  return { db: db as unknown as D1Database, rows, auditRows };
}

function send(
  db: D1Database | undefined,
  body: unknown,
  options: {
    token?: string | null;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  // origin === null 意味着「刻意不带 Origin」，用来验证 curl / 跨站表单那条路。
  if (options.origin !== null) headers.set("origin", options.origin ?? sameOrigin.origin);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const request = new Request("https://sort.logicc.top/api/other/cover-choice", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const env: Env = { ASSETS: {} as Fetcher, DB: db };
  const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
  return worker.fetch(request, env, ctx);
}

const sameOrigin = { origin: "https://sort.logicc.top" };

describe("POST /api/other/cover-choice · 同源闸", () => {
  it("无 Origin 且无 Sec-Fetch-Site 一律 403（curl / 跨站表单）", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(db, VALID_BODY, { token: TOKEN, origin: null });
    expect(response.status).toBe(403);
    expect(rows.size).toBe(0);
  });
  it("Origin 与本站不同一律 403", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(db, VALID_BODY, { token: TOKEN, origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(rows.size).toBe(0);
  });

  it("Sec-Fetch-Site: same-origin 顶替 Origin 时放行到下一道闸", async () => {
    const { db } = fakeDb({ token: TOKEN });
    const response = await send(db, VALID_BODY, {
      token: TOKEN,
      headers: { "sec-fetch-site": "same-origin" },
    });
    // 不再是 403：说明它走到了登录/白名单那几关。
    expect(response.status).not.toBe(403);
  });
});

describe("POST /api/other/cover-choice · 登录闸", () => {
  it("匿名（无 Authorization）401，且不落地", async () => {
    const { db, rows } = fakeDb();
    const response = await send(db, VALID_BODY, sameOrigin);
    expect(response.status).toBe(401);
    expect(rows.size).toBe(0);
  });

  it("DB 里没有该 token 的会话时 401", async () => {
    const { db } = fakeDb({});
    const response = await send(db, VALID_BODY, { token: TOKEN, headers: sameOrigin });
    expect(response.status).toBe(401);
  });
});

describe("POST /api/other/cover-choice · 维基域白名单", () => {
  it("allowedImage 放行但不是维基域的地址 400（豆瓣图不许塞进封面位）", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(
      db,
      { ...VALID_BODY, url: "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p/1.jpg" },
      { token: TOKEN, headers: sameOrigin },
    );
    expect(response.status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("形似维基的域名 400（后缀锚定，不做 includes）", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(
      db,
      { ...VALID_BODY, url: "https://upload.wikimedia.org.evil.example/x.png" },
      { token: TOKEN, headers: sameOrigin },
    );
    expect(response.status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("字段缺失 400", async () => {
    const { db } = fakeDb({ token: TOKEN });
    for (const partial of [
      { ...VALID_BODY, url: undefined },
      { ...VALID_BODY, wikiTitle: undefined },
      { ...VALID_BODY, title: undefined },
    ]) {
      const response = await send(db, partial, { token: TOKEN, headers: sameOrigin });
      expect(response.status).toBe(400);
    }
  });
});

describe("POST /api/other/cover-choice · 合法写入", () => {
  it("写入成功并回读得到 200 + 落库一行", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(db, VALID_BODY, { token: TOKEN, headers: sameOrigin });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; url?: string; wikiTitle?: string };
    expect(body.ok).toBe(true);
    expect(body.url).toBe(OK_URL);
    expect(body.wikiTitle).toBe("风之旅人");
    expect(rows.size).toBe(1);
  });

  it("写入用的键 = 前端 Poster 的兜底键（唯一实现 shared/posterKey.ts）", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    await send(db, VALID_BODY, { token: TOKEN, headers: sameOrigin });
    // 前端 Poster.tsx 的 batchKey 是 posterMediaKey(title, subtitle ?? title, type, year)
    expect([...rows.keys()]).toEqual([posterMediaKey(OK_TITLE, OK_TITLE, "other", OK_YEAR)]);
  });

  it("english 缺省回落到标题：仍是前端能取到的那把键", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    const response = await send(
      db,
      { ...VALID_BODY, english: undefined },
      {
        token: TOKEN,
        headers: sameOrigin,
      },
    );
    expect(response.status).toBe(200);
    expect([...rows.keys()]).toEqual([posterMediaKey(OK_TITLE, OK_TITLE, "other", OK_YEAR)]);
  });

  it("http 维基地址按 allowedImage 的口径升级为 https 后落库", async () => {
    const { db, rows } = fakeDb({ token: TOKEN });
    await send(
      db,
      { ...VALID_BODY, url: "http://upload.wikimedia.org/wikipedia/zh/a/ab/X.png" },
      {
        token: TOKEN,
        headers: sameOrigin,
      },
    );
    expect([...rows.values()][0]).toBe('["https://upload.wikimedia.org/wikipedia/zh/a/ab/X.png"]');
  });

  it("成功写入会留一条 cover_choice 审计（全站封面位的写必须可追溯）", async () => {
    const { db, auditRows } = fakeDb({ token: TOKEN });
    const response = await send(db, VALID_BODY, { token: TOKEN, headers: sameOrigin });
    expect(response.status).toBe(200);
    expect(auditRows).toHaveLength(1);
    const [action, detail] = auditRows[0] as [string, string];
    expect(action).toBe("cover_choice");
    const parsed = JSON.parse(detail) as { title?: string; wikiTitle?: string; email?: string };
    expect(parsed.title).toBe(OK_TITLE);
    expect(parsed.wikiTitle).toBe("风之旅人");
    expect(parsed.email).toBe("reader@example.com");
  });
});

describe("GET /api/other/candidates · 入参上限", () => {
  // english 原样进上游查询 URL。当前前端不发这个参数，但别留一个无界的口子：
  // 与 name 同口径 120，超长 400，且 400 必须发生在限流/回源之前（无需 D1）。
  // 刻意不写「合法长度放行」的用例：那条路会真回源维基，离线测试不碰网络。
  async function sendCandidates(english: string): Promise<Response> {
    const env: Env = { ASSETS: {} as Fetcher, DB: undefined as unknown as D1Database };
    const request = new Request(
      `https://sort.logicc.top/api/other/candidates?name=2012&english=${encodeURIComponent(english)}`,
    );
    const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
    return worker.fetch(request, env, ctx);
  }

  it("english 超长 400 invalid_english（与 name 同口径）", async () => {
    const response = await sendCandidates("e".repeat(121));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { msg?: string }).msg).toBe("invalid_english");
  });
});
