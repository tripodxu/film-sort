import { describe, it, expect, beforeAll } from "vitest";

const BASE = "https://sort.logicc.top";
const TIMEOUT = 45_000;

let apiAvailable = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
    const d = (await r.json()) as { ok: boolean };
    apiAvailable = d.ok === true;
  } catch { apiAvailable = false; }
}, 10_000);

async function getDetail(type: string, name: string) {
  const r = await fetch(`${BASE}/api/${type}/detail?name=${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  return (await r.json()) as { status: boolean; msg?: string; data?: Record<string, unknown> | null };
}

describe.skipIf(!apiAvailable)("detail APIs — content_intro", () => {
  it("movie: 活着", async () => {
    const d = await getDetail("movie", "活着");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
    expect(["douban", "zhwiki", "enwiki"]).toContain(d.data?.content_source);
  }, TIMEOUT);

  it("movie: 龙猫", async () => {
    const d = await getDetail("movie", "龙猫");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("movie: 霸王别姬", async () => {
    const d = await getDetail("movie", "霸王别姬");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("book: 三体", async () => {
    const d = await getDetail("book", "三体");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("book: 红楼梦", async () => {
    const d = await getDetail("book", "红楼梦");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("music: 古琴", async () => {
    const d = await getDetail("music", "古琴");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("music: 七里香", async () => {
    const d = await getDetail("music", "七里香");
    expect(d.status).toBe(true);
    expect(d.data?.content_intro).toBeTruthy();
  }, TIMEOUT);

  it("不存在的标题 → null", async () => {
    const d = await getDetail("movie", "xyznonexistent12345");
    expect(d.data?.content_intro).toBeFalsy();
  }, TIMEOUT);

  it("活着(movie) → 响应字段完整", async () => {
    const d = await getDetail("movie", "活着");
    expect(d.status).toBe(true);
    expect(d.data?.title).toBeTruthy();
    expect(d.data?.pic).toBeTruthy();
    expect(d.data?.rating).toBeTruthy();
  }, TIMEOUT);
});
