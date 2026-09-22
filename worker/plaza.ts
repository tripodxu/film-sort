import type { Env } from "./index";
import { getUserFromToken, adminAuthLocal } from "./account";
import { recordAudit } from "./audit";
import { resolveStoredPosterUrls } from "./posterStore";
import {
  MAX_PAYLOAD_BYTES,
  encodeStoredNotes,
  encodeStoredRankings,
  encodeStoredWorks,
  toStoredRankings,
  toStoredWorks,
} from "../shared/storedItem";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return !cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned) ? null : cleaned;
}

/** 与 index.readJson 同口径：限长 + 必须是 JSON 对象。 */
const MAX_REQUEST_BYTES = 48 * 1024;

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function plazaRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  // GET /api/plaza/posts — list posts (paginated, filterable by kind, searchable, server-side sort)
  // 登录用户额外可见自己的隐藏帖（is_public = 0），便于找回与恢复
  if (path === "/api/plaza/posts" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));
    const kind = url.searchParams.get("kind")?.trim() || null;
    const sort = url.searchParams.get("sort") === "hottest" ? "hottest" : "newest";
    const q = url.searchParams.get("q")?.trim() || null;
    const offset = (page - 1) * limit;

    // 列表瘦身：不返回 items/notes 大 JSON，用 json_extract 只取前三名作品与批注数量
    const viewer = await getUserFromToken(request, env.DB);
    const where: string[] = [viewer ? "(p.is_public = 1 OR p.user_id = ?)" : "p.is_public = 1"];
    const params: unknown[] = viewer ? [viewer.id] : [];
    if (kind) {
      where.push("p.kind = ?");
      params.push(kind);
    }
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(p.collection_title LIKE ? ESCAPE '\\' OR u.nickname LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const whereSql = ` WHERE ${where.join(" AND ")}`;
    const orderSql =
      sort === "hottest"
        ? " ORDER BY p.like_count DESC, p.created_at DESC"
        : " ORDER BY p.created_at DESC";

    const rows = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.post_type, p.kind, p.collection_title, p.description, p.item_count, p.like_count, p.comment_count, p.is_public, p.created_at, p.updated_at, u.nickname,
        json_extract(p.items, '$[0]') AS item0,
        json_extract(p.items, '$[1]') AS item1,
        json_extract(p.items, '$[2]') AS item2,
        (SELECT COUNT(*) FROM json_each(COALESCE(p.notes, '{}'))) AS note_count
      FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id${whereSql}${orderSql} LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all();

    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id${whereSql}`,
    )
      .bind(...params)
      .first<{ total: number }>();

    return json({
      posts: (rows.results ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const { item0, item1, item2, ...rest } = r;
        const parse = (s: unknown) => {
          try {
            return JSON.parse(String(s));
          } catch {
            return null;
          }
        };
        const pieces = [item0, item1, item2].filter(Boolean);
        // ranking 帖的前三名就是作品；profile 帖的前三名取各榜单的第一件作品
        const topItems = (
          r.post_type === "profile"
            ? pieces.map(parse).map((ranking) => ranking?.items?.[0])
            : pieces.map(parse)
        ).filter(Boolean);
        return { ...rest, top_items: topItems, is_author: !!viewer && viewer.id === r.user_id };
      }),
      page,
      limit,
      total: total?.total ?? 0,
    });
  }

  // GET /api/plaza/posts/:id — single post with comments (+ is_author / liked_by_me for the current token)
  const postDetailMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postDetailMatch && method === "GET") {
    const postId = Number(postDetailMatch[1]);
    const post = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.post_type, p.kind, p.collection_title, p.description, p.items, p.notes, p.item_count, p.like_count, p.comment_count, p.is_public, p.created_at, p.updated_at, u.nickname,
        (SELECT COUNT(*) FROM plaza_post_edits e WHERE e.post_id = p.id) AS edit_count,
        (SELECT MAX(e.created_at) FROM plaza_post_edits e WHERE e.post_id = p.id) AS last_edited_at
       FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id WHERE p.id = ?`,
    )
      .bind(postId)
      .first<Record<string, unknown>>();
    if (!post) return json({ error: "post_not_found" }, 404);

    // 可选登录态：隐藏帖仅作者可见；is_author / liked_by_me 供前端按钮分支
    const viewer = await getUserFromToken(request, env.DB);
    if (!post.is_public && (!viewer || viewer.id !== post.user_id)) {
      return json({ error: "post_not_found" }, 404);
    }

    const comments = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.created_at, u.nickname
       FROM plaza_comments c LEFT JOIN user_accounts u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    )
      .bind(postId)
      .all();

    let likedByMe = false;
    if (viewer) {
      const like = await env.DB.prepare(
        "SELECT id FROM plaza_likes WHERE post_id = ? AND user_id = ?",
      )
        .bind(postId, viewer.id)
        .first();
      likedByMe = !!like;
    }

    // 海报地址走**旁路数组**，不再注入条目对象。
    //
    // 历史教训：曾经把 poster_urls 侧表的结果挂进 post.items，前端编辑帖子时
    // `{...w}` 展开把 posterUrls 原样带回 body.items，PUT 又没有护栏，
    // 于是海报地址重新进库、随覆盖率增长重演 512KB 故障（见
    // docs/PLAN-poster-pipeline.md §4.3）。改成旁路后，编辑流只碰干净的
    // post.items，泄漏路径从结构上消失，而不是靠「记得剥离」。
    const rawItems: unknown[] = JSON.parse(String(post.items ?? "[]"));
    const isProfilePost = post.post_type === "profile";
    // 读取时也过一遍白名单：库里残留 posterUrls 的旧行读出来即干净，
    // 客户端下一次保存就自动瘦身——不需要数据迁移脚本。
    const works = isProfilePost ? [] : toStoredWorks(rawItems);
    const posterUrls = await resolveStoredPosterUrls(env.DB, post.kind, works);
    const items: unknown[] = isProfilePost ? toStoredRankings(rawItems) : works;
    return json({
      post: {
        ...post,
        items,
        is_author: !!viewer && viewer.id === post.user_id,
        liked_by_me: likedByMe,
      },
      // 与 items 等长、按位置对齐；null 表示该条没有已持久化的海报地址。
      posterUrls,
      comments: comments.results ?? [],
    });
  }

  // POST /api/plaza/posts — create post (requires login)
  if (path === "/api/plaza/posts" && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES)
      return json({ error: "payload_too_large" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const postType = cleanString(body.post_type, 40);
    if (postType !== "ranking" && postType !== "profile")
      return json({ error: "invalid_post_type" }, 400);
    const kind = cleanString(body.kind, 20);
    const collectionTitle = cleanString(body.collection_title, 200);
    if (!collectionTitle) return json({ error: "invalid_collection_title" }, 400);
    const description = cleanString(body.description, 500);
    const notesRaw = body.notes;
    // 批注走白名单编码出口；字符串形态仅接受已是对象 JSON 的兼容路径，不再整包转发。
    let notesInput: unknown = notesRaw;
    if (typeof notesRaw === "string" && notesRaw.trim().startsWith("{")) {
      try {
        notesInput = JSON.parse(notesRaw) as unknown;
      } catch {
        notesInput = null;
      }
    }
    const notesEncoded = encodeStoredNotes(notesInput);
    if (!notesEncoded.ok) return json({ error: "notes_too_large" }, 413);
    const notes = notesEncoded.json;
    const isPublic =
      body.is_public === undefined || body.is_public === null ? 1 : body.is_public ? 1 : 0;

    // ranking 帖 items 为作品数组；profile 帖 items 为 RankingExport 数组（各维度榜单整体）
    if (!Array.isArray(body.items) || body.items.length < 1)
      return json({ error: "invalid_items" }, 400);
    if (postType === "ranking" && body.items.length > 300)
      return json({ error: "invalid_items" }, 400);
    if (postType === "profile" && body.items.length > 20)
      return json({ error: "invalid_items" }, 400);
    if (
      postType === "profile" &&
      body.items.some(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          !Array.isArray((item as Record<string, unknown>).items),
      )
    ) {
      return json({ error: "invalid_items" }, 400);
    }
    // 唯一编码出口：白名单投影顺带剔除 posterUrls 与任何未知字段。
    // 两种帖子形状不同（作品数组 vs 榜单数组），用错编码器会把整批数据判为非法，
    // 所以这里必须按 postType 分支——这也是原先最容易漏掉的一处。
    const encoded =
      postType === "profile" ? encodeStoredRankings(body.items) : encodeStoredWorks(body.items);
    if (!encoded.ok) {
      return encoded.error === "payload_too_large"
        ? json({ error: "payload_too_large" }, 413)
        : json({ error: "invalid_items" }, 400);
    }
    const itemCount = encoded.count;
    if (itemCount < 1 || itemCount > 300) return json({ error: "invalid_items" }, 400);

    const result = await env.DB.prepare(
      `INSERT INTO plaza_posts (user_id, post_type, kind, collection_title, description, items, notes, item_count, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        postType,
        kind,
        collectionTitle,
        description,
        encoded.json,
        notes,
        itemCount,
        isPublic,
      )
      .run();

    return json({ id: result.meta.last_row_id, stored: true }, 201);
  }

  // PUT /api/plaza/posts/:id — edit own post (items/description/metadata) + record edit history
  const postEditMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postEditMatch && method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(postEditMatch[1]);
    const existing = await env.DB.prepare("SELECT user_id, post_type FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first<{ user_id: number; post_type: string }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES)
      return json({ error: "payload_too_large" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const postType = cleanString(body.post_type, 40);
    const kind = cleanString(body.kind, 20);
    const collectionTitle = cleanString(body.collection_title, 200);
    const description = cleanString(body.description, 500);
    // 与创建路径同一白名单口径；COALESCE 更新，null 表示不改。
    let notes: string | null | undefined;
    if (body.notes !== undefined) {
      const notesEncoded = encodeStoredNotes(body.notes);
      if (!notesEncoded.ok) return json({ error: "notes_too_large" }, 413);
      notes = notesEncoded.json;
    }
    const isPublic =
      body.is_public === undefined || body.is_public === null ? undefined : body.is_public ? 1 : 0;

    // 这里正是 512KB 故障的复发点：客户端编辑帖子时会把详情接口拿到的 items 原样
    // 提交回来。只要详情接口不再把 posterUrls 注进 items（本文件 GET 分支已改为旁路），
    // 再加上这里的白名单编码器，海报地址就没有任何入口。
    let itemsJson: string | undefined;
    let itemCount: number | undefined;
    if (Array.isArray(body.items)) {
      if (body.items.length < 1 || body.items.length > 300)
        return json({ error: "invalid_items" }, 400);
      const effectiveType = postType ?? existing.post_type;
      const encoded =
        effectiveType === "profile"
          ? encodeStoredRankings(body.items)
          : encodeStoredWorks(body.items);
      if (!encoded.ok) {
        return encoded.error === "payload_too_large"
          ? json({ error: "payload_too_large" }, 413)
          : json({ error: "invalid_items" }, 400);
      }
      if (encoded.count < 1 || encoded.count > 300) return json({ error: "invalid_items" }, 400);
      itemsJson = encoded.json;
      itemCount = encoded.count;
    }

    // D1 bind 不接受 undefined：未提供的字段统一转 null，由 COALESCE 保留原值
    await env.DB.prepare(
      `UPDATE plaza_posts SET post_type = COALESCE(?, post_type), kind = COALESCE(?, kind), collection_title = COALESCE(?, collection_title), description = COALESCE(?, description), items = COALESCE(?, items), notes = COALESCE(?, notes), item_count = COALESCE(?, item_count), is_public = COALESCE(?, is_public), updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(
        postType ?? null,
        kind ?? null,
        collectionTitle ?? null,
        description ?? null,
        itemsJson ?? null,
        notes ?? null,
        itemCount ?? null,
        isPublic ?? null,
        postId,
      )
      .run();

    // 记录本次编辑的操作明细（客户端从差异生成，服务端写入权威时间戳）
    if (Array.isArray(body.edits) && body.edits.length) {
      const editStmt = env.DB.prepare(
        "INSERT INTO plaza_post_edits (post_id, action, detail) VALUES (?, ?, ?)",
      );
      const editRows = body.edits
        .slice(0, 50)
        .map((edit) =>
          edit && typeof edit === "object" ? (edit as Record<string, unknown>) : null,
        )
        .filter(
          (edit): edit is Record<string, unknown> =>
            !!edit && typeof edit.action === "string" && edit.action.length <= 40,
        )
        .map((edit) =>
          editStmt.bind(postId, cleanString(edit.action, 40), cleanString(edit.detail, 300)),
        );
      if (editRows.length) await env.DB.batch(editRows);
    }

    return json({ ok: true });
  }

  // GET /api/plaza/posts/:id/edits — 编辑历史（仅作者可见）
  const postEditsMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/edits$/);
  if (postEditsMatch && method === "GET") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const postId = Number(postEditsMatch[1]);
    const existing = await env.DB.prepare("SELECT user_id FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first<{ user_id: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);
    const rows = await env.DB.prepare(
      "SELECT id, action, detail, created_at FROM plaza_post_edits WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT 200",
    )
      .bind(postId)
      .all();
    return json({ edits: rows.results ?? [] });
  }

  // POST /api/plaza/posts/:id/visibility — 作者隐藏/恢复自己的帖子（区别于管理员同名接口）
  const authorVisibilityMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/visibility$/);
  if (authorVisibilityMatch && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const postId = Number(authorVisibilityMatch[1]);
    const existing = await env.DB.prepare(
      "SELECT id, user_id, is_public FROM plaza_posts WHERE id = ?",
    )
      .bind(postId)
      .first<{ id: number; user_id: number; is_public: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    const body = await readJsonObject(request);
    const isPublic = body?.is_public ? 1 : 0;
    await env.DB.prepare(
      "UPDATE plaza_posts SET is_public = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(isPublic, postId)
      .run();
    await env.DB.prepare("INSERT INTO plaza_post_edits (post_id, action, detail) VALUES (?, ?, ?)")
      .bind(
        postId,
        isPublic ? "restore" : "hide",
        isPublic ? "恢复公开展示" : "隐藏帖子（仅自己可见）",
      )
      .run();
    return json({ ok: true, is_public: isPublic });
  }

  // DELETE /api/plaza/posts/:id — delete own post
  const postDeleteMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postDeleteMatch && method === "DELETE") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(postDeleteMatch[1]);
    const existing = await env.DB.prepare("SELECT user_id FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first<{ user_id: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    // 帖子若被编辑/隐藏过，plaza_post_edits 有外键引用，须先删除历史再删帖子
    await env.DB.batch([
      env.DB.prepare("DELETE FROM plaza_post_edits WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_comments WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_likes WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_posts WHERE id = ?").bind(postId),
    ]);

    return json({ ok: true });
  }

  // POST /api/plaza/posts/:id/like — toggle like (requires login)
  const likeMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/like$/);
  if (likeMatch && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(likeMatch[1]);
    const post = await env.DB.prepare("SELECT id FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first();
    if (!post) return json({ error: "post_not_found" }, 404);

    const existing = await env.DB.prepare(
      "SELECT id FROM plaza_likes WHERE post_id = ? AND user_id = ?",
    )
      .bind(postId, user.id)
      .first();

    if (existing) {
      // Unlike
      await env.DB.prepare("DELETE FROM plaza_likes WHERE post_id = ? AND user_id = ?")
        .bind(postId, user.id)
        .run();
      await env.DB.prepare(
        "UPDATE plaza_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?",
      )
        .bind(postId)
        .run();
      return json({ liked: false });
    } else {
      // Like
      await env.DB.prepare("INSERT INTO plaza_likes (post_id, user_id) VALUES (?, ?)")
        .bind(postId, user.id)
        .run();
      await env.DB.prepare("UPDATE plaza_posts SET like_count = like_count + 1 WHERE id = ?")
        .bind(postId)
        .run();
      return json({ liked: true });
    }
  }

  // GET /api/plaza/posts/:id/comments — get comments
  const commentsGetMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/comments$/);
  if (commentsGetMatch && method === "GET") {
    const postId = Number(commentsGetMatch[1]);
    const viewer = await getUserFromToken(request, env.DB);
    const post = await env.DB.prepare("SELECT user_id, is_public FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first<{ user_id: number; is_public: number }>();
    if (!post || (!post.is_public && (!viewer || viewer.id !== post.user_id)))
      return json({ error: "post_not_found" }, 404);
    const comments = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.created_at, u.nickname
       FROM plaza_comments c LEFT JOIN user_accounts u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 200`,
    )
      .bind(postId)
      .all();

    return json({ comments: comments.results ?? [] });
  }

  // POST /api/plaza/posts/:id/comments — add comment (requires login, max 500 chars)
  if (commentsGetMatch && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(commentsGetMatch[1]);
    const post = await env.DB.prepare("SELECT user_id, is_public FROM plaza_posts WHERE id = ?")
      .bind(postId)
      .first<{ user_id: number; is_public: number }>();
    if (!post || (!post.is_public && post.user_id !== user.id))
      return json({ error: "post_not_found" }, 404);

    const raw = await request.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    const content = cleanString(body.content, 500);
    if (!content)
      return json({ error: "invalid_content", msg: "评论内容不能为空且不超过500字" }, 400);
    const parentId = body.parent_id ? Number(body.parent_id) : null;
    if (parentId !== null && (!Number.isInteger(parentId) || parentId < 1))
      return json({ error: "invalid_parent_id" }, 400);

    const result = await env.DB.prepare(
      "INSERT INTO plaza_comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)",
    )
      .bind(postId, user.id, content, parentId)
      .run();
    await env.DB.prepare("UPDATE plaza_posts SET comment_count = comment_count + 1 WHERE id = ?")
      .bind(postId)
      .run();

    return json({ id: result.meta.last_row_id, stored: true }, 201);
  }

  // DELETE /api/comments/:id — delete own comment
  const commentDeleteMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentDeleteMatch && method === "DELETE") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const commentId = Number(commentDeleteMatch[1]);
    const existing = await env.DB.prepare(
      "SELECT id, post_id, user_id FROM plaza_comments WHERE id = ?",
    )
      .bind(commentId)
      .first<{ id: number; post_id: number; user_id: number }>();
    if (!existing) return json({ error: "comment_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    await env.DB.prepare("DELETE FROM plaza_comments WHERE id = ?").bind(commentId).run();
    await env.DB.prepare(
      "UPDATE plaza_posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?",
    )
      .bind(existing.post_id)
      .run();

    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}

/**
 * 管理员广场管理路由（/api/admin/plaza/*）：
 * 查看全部帖子（含隐藏）、查看完整详情、删除任意帖子/评论、隐藏/恢复帖子。
 * 所有操作写入 admin_audit 审计日志。
 */
export async function adminPlazaRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await adminAuthLocal(request, env.DB))) return json({ error: "auth_required" }, 401);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // GET /api/admin/plaza/posts — 全量帖子列表（含隐藏帖，可筛选/搜索/分页）
  if (path === "/api/admin/plaza/posts" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));
    const kind = url.searchParams.get("kind")?.trim() || null;
    const q = url.searchParams.get("q")?.trim() || null;
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    if (kind) {
      where.push("p.kind = ?");
      params.push(kind);
    }
    if (q) {
      where.push("(p.collection_title LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";

    const rows = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.post_type, p.kind, p.collection_title, p.description, p.item_count, p.like_count, p.comment_count, p.is_public, p.created_at, p.updated_at, u.nickname, u.email,
        (SELECT COUNT(*) FROM plaza_comments c2 WHERE c2.post_id = p.id) AS live_comment_count
      FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id${whereSql}
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all();
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id${whereSql}`,
    )
      .bind(...params)
      .first<{ total: number }>();

    return json({
      // 管理列表刻意不返回 items 大 JSON（详情接口按需拉取），live_comment_count 用于校正可能漂移的计数
      posts: rows.results ?? [],
      page,
      limit,
      total: total?.total ?? 0,
    });
  }

  // GET /api/admin/plaza/posts/:id — 帖子完整详情（含全部评论与作者邮箱）
  const adminDetailMatch = path.match(/^\/api\/admin\/plaza\/posts\/(\d+)$/);
  if (adminDetailMatch && method === "GET") {
    const postId = Number(adminDetailMatch[1]);
    const post = await env.DB.prepare(
      `SELECT p.*, u.nickname, u.email,
        (SELECT COUNT(*) FROM plaza_post_edits e WHERE e.post_id = p.id) AS edit_count,
        (SELECT MAX(e.created_at) FROM plaza_post_edits e WHERE e.post_id = p.id) AS last_edited_at
       FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id WHERE p.id = ?`,
    )
      .bind(postId)
      .first<Record<string, unknown>>();
    if (!post) return json({ error: "post_not_found" }, 404);

    const comments = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.parent_id, c.created_at, u.nickname, u.email
       FROM plaza_comments c LEFT JOIN user_accounts u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 500`,
    )
      .bind(postId)
      .all();

    return json({
      post: { ...post, items: JSON.parse(String(post.items ?? "[]")) },
      comments: comments.results ?? [],
    });
  }

  // DELETE /api/admin/plaza/posts/:id — 删除任意帖子（batch 原子清理编辑历史/评论/点赞）
  const adminPostDeleteMatch = path.match(/^\/api\/admin\/plaza\/posts\/(\d+)$/);
  if (adminPostDeleteMatch && method === "DELETE") {
    const postId = Number(adminPostDeleteMatch[1]);
    const existing = await env.DB.prepare(
      "SELECT id, collection_title, user_id FROM plaza_posts WHERE id = ?",
    )
      .bind(postId)
      .first<{ id: number; collection_title: string; user_id: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM plaza_post_edits WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_comments WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_likes WHERE post_id = ?").bind(postId),
      env.DB.prepare("DELETE FROM plaza_posts WHERE id = ?").bind(postId),
    ]);
    await recordAudit(
      env,
      "plaza:delete_post",
      `删除帖子 #${postId}「${existing.collection_title}」（作者 #${existing.user_id}）`,
      request,
    );
    return json({ ok: true });
  }

  // POST /api/admin/plaza/posts/:id/visibility — 隐藏/恢复帖子
  const visibilityMatch = path.match(/^\/api\/admin\/plaza\/posts\/(\d+)\/visibility$/);
  if (visibilityMatch && method === "POST") {
    const postId = Number(visibilityMatch[1]);
    const body = await readJsonObject(request);
    const isPublic = body?.is_public ? 1 : 0;
    const existing = await env.DB.prepare(
      "SELECT id, collection_title FROM plaza_posts WHERE id = ?",
    )
      .bind(postId)
      .first<{ id: number; collection_title: string }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    await env.DB.prepare(
      "UPDATE plaza_posts SET is_public = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(isPublic, postId)
      .run();
    await recordAudit(
      env,
      `plaza:${isPublic ? "restore" : "hide"}_post`,
      `${isPublic ? "恢复" : "隐藏"}帖子 #${postId}「${existing.collection_title}」`,
      request,
    );
    return json({ ok: true, is_public: isPublic });
  }

  // DELETE /api/admin/plaza/comments/:id — 删除任意评论（连同其直接回复，计数按实际删除数修正）
  const adminCommentDeleteMatch = path.match(/^\/api\/admin\/plaza\/comments\/(\d+)$/);
  if (adminCommentDeleteMatch && method === "DELETE") {
    const commentId = Number(adminCommentDeleteMatch[1]);
    const existing = await env.DB.prepare(
      "SELECT id, post_id, user_id, content FROM plaza_comments WHERE id = ?",
    )
      .bind(commentId)
      .first<{ id: number; post_id: number; user_id: number; content: string }>();
    if (!existing) return json({ error: "comment_not_found" }, 404);
    const replies = await env.DB.prepare("SELECT id FROM plaza_comments WHERE parent_id = ?")
      .bind(commentId)
      .all<{ id: number }>();
    const replyIds = (replies.results ?? []).map((r) => r.id);
    const removed = 1 + replyIds.length;
    const db = env.DB;
    await db.batch([
      ...replyIds.map((id) => db.prepare("DELETE FROM plaza_comments WHERE id = ?").bind(id)),
      db.prepare("DELETE FROM plaza_comments WHERE id = ?").bind(commentId),
      db
        .prepare("UPDATE plaza_posts SET comment_count = MAX(0, comment_count - ?) WHERE id = ?")
        .bind(removed, existing.post_id),
    ]);
    await recordAudit(
      env,
      "plaza:delete_comment",
      `删除帖子 #${existing.post_id} 的评论 #${commentId}（含 ${replyIds.length} 条回复）`,
      request,
    );
    return json({ ok: true, removed });
  }

  return json({ error: "not_found" }, 404);
}
