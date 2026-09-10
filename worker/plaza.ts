import type { Env } from "./index";
import { getUserFromToken } from "./account";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return (!cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) ? null : cleaned;
}

export async function plazaRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // GET /api/plaza/posts — list posts (paginated, filterable by kind)
  if (path === "/api/plaza/posts" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));
    const kind = url.searchParams.get("kind")?.trim() || null;
    const offset = (page - 1) * limit;

    let sql = `SELECT p.id, p.user_id, p.post_type, p.kind, p.collection_title, p.description, p.items, p.notes, p.item_count, p.like_count, p.comment_count, p.is_public, p.created_at, p.updated_at, u.nickname
      FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id WHERE p.is_public = 1`;
    const params: unknown[] = [];
    if (kind) {
      sql += ` AND p.kind = ?`;
      params.push(kind);
    }
    sql += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await env.DB.prepare(sql).bind(...params).all();

    let countSql = `SELECT COUNT(*) AS total FROM plaza_posts WHERE is_public = 1`;
    const countParams: unknown[] = [];
    if (kind) {
      countSql += ` AND kind = ?`;
      countParams.push(kind);
    }
    const countRow = await env.DB.prepare(countSql).bind(...params.slice(0, kind ? 1 : 0)).first<{ total: number }>();

    return json({
      posts: (rows.results ?? []).map((row) => ({ ...row, items: JSON.parse(String((row as Record<string, unknown>).items ?? "[]")) })),
      page,
      limit,
      total: countRow?.total ?? 0,
    });
  }

  // GET /api/plaza/posts/:id — single post with comments
  const postDetailMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postDetailMatch && method === "GET") {
    const postId = Number(postDetailMatch[1]);
    const post = await env.DB.prepare(
      `SELECT p.id, p.user_id, p.post_type, p.kind, p.collection_title, p.description, p.items, p.notes, p.item_count, p.like_count, p.comment_count, p.is_public, p.created_at, p.updated_at, u.nickname
       FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id WHERE p.id = ?`
    ).bind(postId).first<Record<string, unknown>>();
    if (!post) return json({ error: "post_not_found" }, 404);

    const comments = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.nickname
       FROM plaza_comments c LEFT JOIN user_accounts u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 100`
    ).bind(postId).all();

    return json({
      post: { ...post, items: JSON.parse(String(post.items ?? "[]")) },
      comments: comments.results ?? [],
    });
  }

  // POST /api/plaza/posts — create post (requires login)
  if (path === "/api/plaza/posts" && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const raw = await request.text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

    const postType = cleanString(body.post_type, 40);
    if (!postType) return json({ error: "invalid_post_type" }, 400);
    const kind = cleanString(body.kind, 20);
    const collectionTitle = cleanString(body.collection_title, 200);
    if (!collectionTitle) return json({ error: "invalid_collection_title" }, 400);
    const description = cleanString(body.description, 500);
    const notes = cleanString(body.notes, 2000);
    const isPublic = body.is_public === undefined || body.is_public === null ? 1 : (body.is_public ? 1 : 0);

    if (!Array.isArray(body.items) || body.items.length < 1) return json({ error: "invalid_items" }, 400);
    const itemsJson = JSON.stringify(body.items);
    const itemCount = body.items.length;

    const result = await env.DB.prepare(
      `INSERT INTO plaza_posts (user_id, post_type, kind, collection_title, description, items, notes, item_count, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(user.id, postType, kind, collectionTitle, description, itemsJson, notes, itemCount, isPublic).run();

    return json({ id: result.meta.last_row_id, stored: true }, 201);
  }

  // PUT /api/plaza/posts/:id — edit own post
  const postEditMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postEditMatch && method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(postEditMatch[1]);
    const existing = await env.DB.prepare("SELECT user_id FROM plaza_posts WHERE id = ?").bind(postId).first<{ user_id: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    const raw = await request.text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

    const postType = cleanString(body.post_type, 40);
    const kind = cleanString(body.kind, 20);
    const collectionTitle = cleanString(body.collection_title, 200);
    const description = cleanString(body.description, 500);
    const notes = cleanString(body.notes, 2000);
    const isPublic = body.is_public === undefined || body.is_public === null ? undefined : (body.is_public ? 1 : 0);

    let itemsJson: string | undefined;
    let itemCount: number | undefined;
    if (Array.isArray(body.items)) {
      if (body.items.length < 1) return json({ error: "invalid_items" }, 400);
      itemsJson = JSON.stringify(body.items);
      itemCount = body.items.length;
    }

    await env.DB.prepare(
      `UPDATE plaza_posts SET post_type = COALESCE(?, post_type), kind = COALESCE(?, kind), collection_title = COALESCE(?, collection_title), description = COALESCE(?, description), items = COALESCE(?, items), notes = COALESCE(?, notes), item_count = COALESCE(?, item_count), is_public = COALESCE(?, is_public), updated_at = datetime('now') WHERE id = ?`
    ).bind(postType, kind, collectionTitle, description, itemsJson, notes, itemCount, isPublic, postId).run();

    return json({ ok: true });
  }

  // DELETE /api/plaza/posts/:id — delete own post
  const postDeleteMatch = path.match(/^\/api\/plaza\/posts\/(\d+)$/);
  if (postDeleteMatch && method === "DELETE") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(postDeleteMatch[1]);
    const existing = await env.DB.prepare("SELECT user_id FROM plaza_posts WHERE id = ?").bind(postId).first<{ user_id: number }>();
    if (!existing) return json({ error: "post_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    await env.DB.prepare("DELETE FROM plaza_comments WHERE post_id = ?").bind(postId).run();
    await env.DB.prepare("DELETE FROM plaza_likes WHERE post_id = ?").bind(postId).run();
    await env.DB.prepare("DELETE FROM plaza_posts WHERE id = ?").bind(postId).run();

    return json({ ok: true });
  }

  // POST /api/plaza/posts/:id/like — toggle like (requires login)
  const likeMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/like$/);
  if (likeMatch && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(likeMatch[1]);
    const post = await env.DB.prepare("SELECT id FROM plaza_posts WHERE id = ?").bind(postId).first();
    if (!post) return json({ error: "post_not_found" }, 404);

    const existing = await env.DB.prepare("SELECT id FROM plaza_likes WHERE post_id = ? AND user_id = ?").bind(postId, user.id).first();

    if (existing) {
      // Unlike
      await env.DB.prepare("DELETE FROM plaza_likes WHERE post_id = ? AND user_id = ?").bind(postId, user.id).run();
      await env.DB.prepare("UPDATE plaza_posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(postId).run();
      return json({ liked: false });
    } else {
      // Like
      await env.DB.prepare("INSERT INTO plaza_likes (post_id, user_id) VALUES (?, ?)").bind(postId, user.id).run();
      await env.DB.prepare("UPDATE plaza_posts SET like_count = like_count + 1 WHERE id = ?").bind(postId).run();
      return json({ liked: true });
    }
  }

  // GET /api/plaza/posts/:id/comments — get comments
  const commentsGetMatch = path.match(/^\/api\/plaza\/posts\/(\d+)\/comments$/);
  if (commentsGetMatch && method === "GET") {
    const postId = Number(commentsGetMatch[1]);
    const comments = await env.DB.prepare(
      `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.nickname
       FROM plaza_comments c LEFT JOIN user_accounts u ON c.user_id = u.id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 100`
    ).bind(postId).all();

    return json({ comments: comments.results ?? [] });
  }

  // POST /api/plaza/posts/:id/comments — add comment (requires login, max 500 chars)
  if (commentsGetMatch && method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const postId = Number(commentsGetMatch[1]);
    const post = await env.DB.prepare("SELECT id FROM plaza_posts WHERE id = ?").bind(postId).first();
    if (!post) return json({ error: "post_not_found" }, 404);

    const raw = await request.text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

    const content = cleanString(body.content, 500);
    if (!content) return json({ error: "invalid_content", msg: "评论内容不能为空且不超过500字" }, 400);

    const result = await env.DB.prepare("INSERT INTO plaza_comments (post_id, user_id, content) VALUES (?, ?, ?)").bind(postId, user.id, content).run();
    await env.DB.prepare("UPDATE plaza_posts SET comment_count = comment_count + 1 WHERE id = ?").bind(postId).run();

    return json({ id: result.meta.last_row_id, stored: true }, 201);
  }

  // DELETE /api/comments/:id — delete own comment
  const commentDeleteMatch = path.match(/^\/api\/comments\/(\d+)$/);
  if (commentDeleteMatch && method === "DELETE") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);

    const commentId = Number(commentDeleteMatch[1]);
    const existing = await env.DB.prepare("SELECT id, post_id, user_id FROM plaza_comments WHERE id = ?").bind(commentId).first<{ id: number; post_id: number; user_id: number }>();
    if (!existing) return json({ error: "comment_not_found" }, 404);
    if (existing.user_id !== user.id) return json({ error: "forbidden" }, 403);

    await env.DB.prepare("DELETE FROM plaza_comments WHERE id = ?").bind(commentId).run();
    await env.DB.prepare("UPDATE plaza_posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?").bind(existing.post_id).run();

    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
