import { describe, expect, it } from "vitest";
import type { Env } from "./index";
import { plazaRoute } from "./plaza";

// 状态型 fake D1：维护 likes/comments/posts 的内存行，按 SQL 语句原型模拟 changes 语义，
// 使条件写入（INSERT OR IGNORE / 条件 DELETE）和计数重算可以被端到端验证。
function statefulDb(state: {
  user: { id: number; email: string } | null;
  posts: Map<number, Record<string, unknown>>;
  likes: Set<string>;
  comments: Array<Record<string, unknown>>;
  nextCommentId: number;
  statements: Array<{ sql: string; args: unknown[] }>;
}): D1Database {
  const { posts, likes, comments } = state;
  const likeKey = (postId: number, userId: number) => `${postId}:${userId}`;
  const countComments = (postId: number) => comments.filter((c) => c.post_id === postId).length;

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const record = () => state.statements.push({ sql, args });
          return {
            first: async () => {
              if (/FROM user_sessions/.test(sql)) return state.user;
              if (/SELECT user_id, post_type FROM plaza_posts/.test(sql)) {
                const post = posts.get(args[0] as number);
                return post ? { user_id: post.user_id, post_type: post.post_type } : null;
              }
              if (/SELECT user_id, is_public FROM plaza_posts/.test(sql)) {
                const post = posts.get(args[0] as number);
                return post ? { user_id: post.user_id, is_public: post.is_public } : null;
              }
              if (/SELECT post_id FROM plaza_comments WHERE id = \?/.test(sql)) {
                const comment = comments.find((c) => c.id === args[0]);
                return comment ? { post_id: comment.post_id } : null;
              }
              if (/SELECT id, post_id, user_id FROM plaza_comments/.test(sql)) {
                const comment = comments.find((c) => c.id === args[0]);
                return comment
                  ? {
                      id: comment.id,
                      post_id: comment.post_id,
                      user_id: comment.user_id,
                    }
                  : null;
              }
              if (/SELECT id FROM plaza_posts WHERE id = \?/.test(sql)) {
                return posts.has(args[0] as number) ? { id: args[0] } : null;
              }
              return null;
            },
            all: async () => {
              if (/SELECT id FROM plaza_comments WHERE parent_id IN/.test(sql)) {
                const parents = args as number[];
                return {
                  results: comments
                    .filter((c) => parents.includes(c.parent_id as number))
                    .map((c) => ({ id: c.id })),
                };
              }
              return { results: [] };
            },
            run: async () => {
              record();
              if (/INSERT OR IGNORE INTO plaza_likes/.test(sql)) {
                const key = likeKey(args[0] as number, args[1] as number);
                if (likes.has(key)) return { success: true, meta: { changes: 0 } };
                likes.add(key);
                return { success: true, meta: { changes: 1 } };
              }
              if (/DELETE FROM plaza_likes WHERE post_id = \? AND user_id = \?/.test(sql)) {
                const key = likeKey(args[0] as number, args[1] as number);
                if (!likes.has(key)) return { success: true, meta: { changes: 0 } };
                likes.delete(key);
                return { success: true, meta: { changes: 1 } };
              }
              if (/like_count = like_count \+ 1/.test(sql)) {
                const post = posts.get(args[0] as number);
                if (post) post.like_count = (post.like_count as number) + 1;
                return { success: true, meta: { changes: post ? 1 : 0 } };
              }
              if (/like_count = MAX\(0, like_count - 1\)/.test(sql)) {
                const post = posts.get(args[0] as number);
                if (post) post.like_count = Math.max(0, (post.like_count as number) - 1);
                return { success: true, meta: { changes: post ? 1 : 0 } };
              }
              if (/INSERT INTO plaza_comments/.test(sql)) {
                comments.push({
                  id: state.nextCommentId++,
                  post_id: args[0],
                  user_id: args[1],
                  content: args[2],
                  parent_id: args[3],
                });
                return {
                  success: true,
                  meta: { changes: 1, last_row_id: state.nextCommentId - 1 },
                };
              }
              if (/DELETE FROM plaza_comments WHERE id = \?/.test(sql)) {
                const index = comments.findIndex((c) => c.id === args[0]);
                if (index === -1) return { success: true, meta: { changes: 0 } };
                comments.splice(index, 1);
                return { success: true, meta: { changes: 1 } };
              }
              if (
                /comment_count = \(SELECT COUNT\(\*\) FROM plaza_comments/.test(sql) &&
                /WHERE id = \?$/.test(sql.trim())
              ) {
                const post = posts.get(args[0] as number);
                if (post) post.comment_count = countComments(args[0] as number);
                return { success: true, meta: { changes: post ? 1 : 0 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

// getUserFromToken 要求 Bearer token 至少 32 字符。
const TOKEN = `${"x".repeat(40)}`;

function makeEnv(db: D1Database): Env {
  return { DB: db } as unknown as Env;
}

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    user_id: 1,
    post_type: "ranking",
    kind: "film",
    is_public: 1,
    like_count: 0,
    comment_count: 0,
    items: JSON.stringify([{ id: "a", title: "A", rank: 1 }]),
    ...overrides,
  };
}

function authedUser(state: { user: { id: number; email: string } | null }) {
  state.user = { id: 1, email: "u@example.com" };
}

describe("Plaza 请求形状（PLAZA-02）", () => {
  it("create 请求体为 JSON null 时返回 400 而不是 500", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map(),
      likes: new Set<string>(),
      comments: [] as Array<Record<string, unknown>>,
      nextCommentId: 1,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: "null",
      }),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_json");
  });

  it('create 的 is_public 为字符串 "false" 时被拒绝而不是当成 true', async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map(),
      likes: new Set<string>(),
      comments: [] as Array<Record<string, unknown>>,
      nextCommentId: 1,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          post_type: "ranking",
          kind: "film",
          collection_title: "榜单",
          items: [{ id: "a", title: "A", rank: 1 }],
          is_public: "false",
        }),
      }),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_is_public");
  });

  it("列表页 page=Infinity 落回默认页而不是产生无限 offset", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map(),
      likes: new Set<string>(),
      comments: [] as Array<Record<string, unknown>>,
      nextCommentId: 1,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts?page=Infinity&limit=Infinity"),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(200);
    const listWrite = state.statements.find((entry) => entry.sql.includes("LIMIT"));
    expect(listWrite).toBeUndefined();
  });

  it("PUT 不允许修改 post_type", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map<number, Record<string, unknown>>([[7, postRow({ user_id: 1 })]]),
      likes: new Set<string>(),
      comments: [] as Array<Record<string, unknown>>,
      nextCommentId: 1,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts/7", {
        method: "PUT",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ post_type: "profile" }),
      }),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("post_type_immutable");
  });
});

describe("评论父帖与计数（PLAZA-01）", () => {
  it("回复不属于该帖子的父评论被拒绝", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map<number, Record<string, unknown>>([
        [7, postRow()],
        [9, postRow({ id: 9 })],
      ]),
      likes: new Set<string>(),
      comments: [{ id: 100, post_id: 9, user_id: 2, content: "x", parent_id: null }],
      nextCommentId: 101,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts/7/comments", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ content: "回复", parent_id: 100 }),
      }),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_parent_id");
    expect(state.comments).toHaveLength(1);
  });

  it("点赞切换基于 changes 语义，双击往返后计数归零", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map<number, Record<string, unknown>>([[7, postRow()]]),
      likes: new Set<string>(),
      comments: [] as Array<Record<string, unknown>>,
      nextCommentId: 1,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const db = statefulDb(state);
    const request = () =>
      plazaRoute(
        new Request("https://example.com/api/plaza/posts/7/like", {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
        makeEnv(db),
      );

    await expect(request()).resolves.toMatchObject({ status: 200 });
    expect(state.posts.get(7)?.like_count as number).toBe(1);
    await expect(request()).resolves.toMatchObject({ status: 200 });
    expect(state.posts.get(7)?.like_count as number).toBe(0);
  });
});

describe("评论删除（PLAZA-01）", () => {
  it("删除带嵌套回复的评论时整棵子树被删且计数按行数重算", async () => {
    const state = {
      user: null as { id: number; email: string } | null,
      posts: new Map<number, Record<string, unknown>>([[7, postRow({ comment_count: 4 })]]),
      likes: new Set<string>(),
      comments: [
        { id: 100, post_id: 7, user_id: 1, content: "root", parent_id: null },
        { id: 101, post_id: 7, user_id: 2, content: "reply", parent_id: 100 },
        { id: 102, post_id: 7, user_id: 3, content: "grandchild", parent_id: 101 },
        { id: 103, post_id: 7, user_id: 4, content: "other", parent_id: null },
      ],
      nextCommentId: 104,
      statements: [] as Array<{ sql: string; args: unknown[] }>,
    };
    authedUser(state);
    const response = await plazaRoute(
      new Request("https://example.com/api/comments/100", {
        method: "DELETE",
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      makeEnv(statefulDb(state)),
    );
    expect(response.status).toBe(200);
    const remaining = state.comments.map((c) => c.id);
    expect(remaining).toEqual([103]);
    expect(state.posts.get(7)?.comment_count).toBe(1);
  });
});
