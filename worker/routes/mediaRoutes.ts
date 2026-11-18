import { getUserFromToken } from "../account";
import { recordAudit } from "../audit";
import { DeadlineError, withDeadline } from "../deadline";
import {
  gdLyric,
  gdPlayUrl,
  gdSearch,
  isCoverTrack,
  lyricNeedsUpstream,
  pickTrack,
  pickTracks,
  playNeedsUpstream,
  stripLrc,
} from "../gdstudio";
import {
  MAX_POSTER_BATCH_BYTES,
  allowUpstreamRequest,
  assertSameOrigin,
  cleanString,
  cleanOptionalString,
  isObject,
  json,
  readJson,
  sanitizePosterBatch,
  withSecurityHeaders,
  upstreamTimeout,
  type Env,
} from "../http";
import {
  allowedImage,
  doubanBookDetail,
  doubanBookSuggest,
  doubanBookTop250,
  doubanMovieDetail,
  doubanMusicTop250,
  doubanSearch,
  doubanSuggest,
  doubanTop250,
  fetchContentIntro,
  posterMediaKey,
  proxyImage,
  resolvePosters,
  resolvePostersBatch,
  tallyBatchOutcomes,
} from "../media";
import { otherCandidateReport, otherDetail, otherSearch } from "../other";
import { loadPosterUrls, normalizeYear, posterKeyFor, saveResolvedPosters } from "../posterStore";

const OTHER_DETAIL_DEADLINE_MS = 25_000;
const OTHER_CANDIDATES_DEADLINE_MS = 15_000;

export async function handleMediaRoutes(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (url.pathname === "/api/douban/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/books/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanBookTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/music/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanMusicTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try {
      return json({ works: await doubanSuggest(query) }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ error: "douban_unavailable", works: [] }, 502);
    }
  }
  if (url.pathname === "/api/douban/books/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try {
      return json({ works: await doubanBookSuggest(query) }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ error: "douban_unavailable", works: [] }, 502);
    }
  }
  if (url.pathname === "/api/posters" && request.method === "GET") {
    const title = url.searchParams.get("q")?.trim();
    const english = url.searchParams.get("en")?.trim() ?? "";
    const year = Number(url.searchParams.get("year")) || undefined;
    const rawType = url.searchParams.get("type")?.trim();
    if (rawType !== undefined && rawType !== "movie" && rawType !== "book" && rawType !== "music")
      return json({ error: "invalid_query" }, 400);
    const type = rawType as "movie" | "book" | "music" | undefined;
    if (
      !title ||
      title.length > 160 ||
      english.length > 160 ||
      (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200))
    )
      return json({ error: "invalid_query" }, 400);
    // Phase 1：先查库。已落库的条目直接返回，不再回源。
    const cacheKey = posterMediaKey(title, english, type, year);
    const stored = env.DB ? (await loadPosterUrls(env.DB, [cacheKey])).get(cacheKey) : undefined;
    const poster_urls = stored?.length
      ? stored
      : await resolvePosters(title, english, year, type, env);
    if (!stored?.length && poster_urls.length)
      await saveResolvedPosters(env.DB, [{ key: cacheKey, urls: poster_urls }]);
    if (!stored?.length && poster_urls.length === 0 && env.DB) {
      void env.DB.prepare(
        "INSERT INTO poster_errors (title, media_type, error, source) VALUES (?, ?, ?, ?)",
      )
        .bind(title, type ?? "movie", "no_poster_found", "single")
        .run()
        .catch(() => {});
    }
    return json({ poster_urls }, 200, {
      "cache-control": `public, max-age=${poster_urls.length ? 86400 : 300}`,
    });
  }
  if (url.pathname === "/api/posters/batch" && request.method === "POST") {
    // 独立限流桶：批量解析的上游开销远大于单条查询，不该和试听共享 music 配额。
    if (!(await allowUpstreamRequest(request, "posters", 60, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_POSTER_BATCH_BYTES)
      return json({ error: "payload_too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!isObject(parsed) || !Array.isArray((parsed as { items?: unknown }).items))
      return json({ error: "invalid_json" }, 400);
    const items = sanitizePosterBatch((parsed as { items: unknown[] }).items);
    if (items.length === 0)
      return json({ results: {}, keys: [] }, 200, { "cache-control": "public, max-age=300" });
    // Phase 1：先算出这一批的键，再一次性查库，命中项短路掉上游。
    const batchKeys = items.map((item) =>
      posterMediaKey(item.title, item.english ?? "", item.type, item.year),
    );
    const known = env.DB ? await loadPosterUrls(env.DB, batchKeys) : undefined;
    // 客户端在每次页面加载的首次批量带 retry：绕过「被限流」的负缓存，
    // 让「刷新 = 真重试」是确定的（正缓存与「确实没有」的负缓存仍然生效）。
    const retry = (parsed as { retry?: unknown }).retry === true;
    const { results, keys, outcomes } = await resolvePostersBatch(items, env, 8, known, { retry });
    // 写穿：只把**新解析到**的地址落库（已知命中项不必重写）。
    await saveResolvedPosters(
      env.DB,
      keys
        .filter((key) => !known?.get(key)?.length)
        .map((key) => ({ key, urls: results[key] ?? [] })),
    );
    // 批量失败原先在后台完全不可见——这里落一条 poster_errors(source=batch)，
    // 且严格限量（每请求最多 10 条），避免把 D1 写成热点。
    if (env.DB) {
      const failures = keys
        .map((key, index) => ({ key, item: items[index] }))
        .filter(({ key }) => !results[key]?.length)
        .slice(0, 10);
      if (failures.length) {
        const statement = env.DB.prepare(
          "INSERT INTO poster_errors (title, media_type, error, source) VALUES (?, ?, ?, ?)",
        );
        void env.DB.batch(
          failures.map(({ key, item }) =>
            statement.bind(
              (item?.title ?? key).slice(0, 160),
              item?.type ?? "movie",
              outcomes[key] === "throttled" ? "throttled" : "no_poster_found",
              "batch",
            ),
          ),
        ).catch(() => undefined);
      }
      // 每批一行 outcome 分布：poster_errors 只有失败行、没有分母，throttled 占比
      // 必须有 total/found 才算得出来（migrations/0026）。单行/请求，火后不管。
      // found 从 results 有无数据推导（tallyBatchOutcomes），不按 outcome 标签 else
      // 归入——未知状态永不虚增 found（A4 / T-20261014-07）。
      const tally = tallyBatchOutcomes(keys, results, outcomes);
      void env.DB.prepare(
        "INSERT INTO poster_batch_stats (total, found, absent, throttled) VALUES (?, ?, ?, ?)",
      )
        .bind(keys.length, tally.found, tally.absent, tally.throttled)
        .run()
        .catch(() => undefined);
    }
    // 真正的 1 天缓存发生在服务端（L1 isolate + L2 Edge Cache）；
    // 这里只是顺带声明新鲜度，浏览器通常不缓存 POST 响应。
    // outcomes 一并发出：found / absent / throttled 是本文件上一段算出来的，
    // 不发出去的话前端只能把「维基没这个条目」和「维基现在取不到」渲染成同一个空格子。
    return json({ results, keys, outcomes }, 200, { "cache-control": "private, max-age=86400" });
  }
  if (url.pathname === "/api/image" && request.method === "GET") {
    // 匿名图片代理必须有频控（白名单已收窄 SSRF 面，这里补带宽面）。
    // 额度从 120 提到 300（收口 2026-10-28）：一个 3 榜单 × 30 条的画像页就要 ~90 次，
    // 紧接着导出 PNG 会再逐张走一遍代理（exportPng 的解码池只控并发、不控总数），
    // 120 在正常「看画像 → 导出 → 逛广场」连招里就会撞线。撞线后 Poster 只是静默
    // 降级成占位方块（不报错、不白屏），用户只会觉得「图没了」，极难归因。
    // 300 次/10 分（≈30 张/分钟）仍足以拦住单 IP 的批量抓图。
    if (!(await allowUpstreamRequest(request, "image", 300)))
      return withSecurityHeaders(json({ error: "rate_limited" }, 429, { "retry-after": "600" }));
    return withSecurityHeaders(await proxyImage(url.searchParams.get("url") ?? ""));
  }

  // Search list APIs
  if (url.pathname === "/api/book/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("book", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }
  if (url.pathname === "/api/movie/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("movie", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }
  if (url.pathname === "/api/music/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("music", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }

  // Detail APIs
  if (url.pathname === "/api/book/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!detailUrl && !title)
      return json({ status: false, msg: "缺少参数 url 或 name", data: null }, 400);

    let bookTitle = title ?? "";
    const data: Record<string, unknown> = {};
    let subjectUrl = detailUrl ?? "";

    // Step 1: Get basic info from search.douban.com
    if (bookTitle || detailUrl) {
      const bookId = detailUrl?.match(/subject\/(\d+)/)?.[1];
      try {
        const search = await doubanSearch("book", bookTitle || bookId!, 1);
        const wantCreator = url.searchParams.get("creator")?.trim() ?? "";
        const scoreHit = (i: (typeof search.data)[number]) => {
          let sc = 0;
          const hay = `${i.title ?? ""} ${i.author ?? ""}`;
          if (wantCreator && hay.includes(wantCreator)) sc += 4;
          if ((i.title ?? "").startsWith(bookTitle)) sc += 1;
          return sc;
        };
        const found = bookId
          ? (search.data.find((i) => i.cover_link?.includes(`/subject/${bookId}/`)) ??
            search.data[0])
          : wantCreator
            ? [...search.data].sort((a, b) => scoreHit(b) - scoreHit(a))[0]
            : search.data[0];
        if (found) {
          bookTitle = found.title || bookTitle;
          data.title = found.title;
          data.pic = found.cover;
          data.rating = String(found.rating ?? "");
          data.author = found.author ?? "";
          data.press = found.press ?? "";
          data.date = found.date ?? "";
          if (!subjectUrl && typeof found.cover_link === "string") subjectUrl = found.cover_link;
        }
      } catch {}
    }

    // Step 2: 豆瓣官方详情页简介优先（零歧义；失败静默降级维基）
    if (subjectUrl.includes("book.douban.com/subject/")) {
      try {
        const detail = await doubanBookDetail(subjectUrl);
        if (detail.status && detail.data) {
          if (detail.data.content_intro) {
            data.content_intro = detail.data.content_intro;
            data.content_source = "douban";
          }
          if (detail.data.author_intro) data.author_intro = detail.data.author_intro;
          if (detail.data.tags) data.tags = detail.data.tags;
          for (const [k, v] of Object.entries(detail.data)) {
            if (v && !data[k]) data[k] = v;
          }
        }
      } catch {}
    }

    // Step 3: 维基兜底
    if (!data.content_intro && bookTitle) {
      const wikiTitle = title && bookTitle.includes(title) ? title : bookTitle;
      const intro = await fetchContentIntro(
        wikiTitle,
        "book",
        typeof data.author === "string" ? data.author.split("/")[0] : undefined,
        data.date,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    // Step 4: douban 搜索完全失败时，用维基搜索兜底获取标题和简介
    if (!data.title && title) {
      const intro = await fetchContentIntro(title, "book", undefined, undefined, env);
      if (intro) {
        data.title = title;
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    if (data.title) {
      return json({ status: true, msg: "ok", time: "0s", data }, 200, {
        "cache-control": "public, max-age=86400",
      });
    }
    return json({ status: false, msg: "未找到书籍信息", data: null }, 404, {
      "cache-control": "public, max-age=60",
    });
  }
  if (url.pathname === "/api/movie/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!detailUrl && !title)
      return json({ status: false, msg: "Missing url or name", data: null }, 400);

    const movieId = detailUrl?.match(/subject\/(\d+)/)?.[1];
    let movieTitle = title ?? "";
    const data: Record<string, unknown> = {};
    let subjectUrl = detailUrl ?? "";

    // Step 1: Get basic info from search.douban.com
    if (movieTitle || movieId) {
      try {
        const search = await doubanSearch("movie", movieTitle || movieId!, 1);
        const wantCreator = url.searchParams.get("creator")?.trim() ?? "";
        const scoreHit = (i: (typeof search.data)[number]) => {
          let sc = 0;
          const hay = `${i.title ?? ""} ${String(Array.isArray(i.actors) ? i.actors.join(" ") : "")}`;
          if (wantCreator && hay.includes(wantCreator)) sc += 4;
          if ((i.title ?? "").startsWith(movieTitle)) sc += 1;
          return sc;
        };
        const found = movieId
          ? (search.data.find((i) => i.cover_link?.includes(`/subject/${movieId}/`)) ??
            search.data[0])
          : wantCreator
            ? [...search.data].sort((a, b) => scoreHit(b) - scoreHit(a))[0]
            : search.data[0];
        if (found) {
          movieTitle = found.title || movieTitle;
          data.title = found.title;
          data.pic = found.cover;
          data.rating = String(found.rating ?? "");
          data.year = found.year ?? "";
          data.type = Array.isArray(found.type) ? found.type.join("/") : "";
          data.country = found.country ?? "";
          data.duration = found.duration ?? "";
          data.actors = Array.isArray(found.actors) ? found.actors.join("/") : "";
          if (!subjectUrl && typeof found.cover_link === "string") subjectUrl = found.cover_link;
        }
      } catch {}
    }

    // Step 2: 豆瓣官方详情页简介优先（v:summary，零歧义；失败静默降级维基）
    if (subjectUrl.includes("movie.douban.com/subject/")) {
      try {
        const detail = await doubanMovieDetail(subjectUrl);
        if (detail.status && detail.data) {
          if (detail.data.content_intro) {
            data.content_intro = detail.data.content_intro;
            data.content_source = "douban";
          }
          for (const [k, v] of Object.entries(detail.data)) {
            if (v && !data[k]) data[k] = v;
          }
        }
      } catch {}
    }

    // Step 3: 维基兜底（豆瓣详情未取到简介时）
    if (!data.content_intro && movieTitle) {
      const wikiTitle = title && movieTitle.includes(title) ? title : movieTitle;
      const intro = await fetchContentIntro(
        wikiTitle,
        "movie",
        typeof data.actors === "string" ? data.actors.split("/")[0] : undefined,
        data.year,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    // Step 4: douban 搜索完全失败时，用维基搜索兜底获取标题和简介
    if (!data.title && title) {
      const intro = await fetchContentIntro(title, "movie", undefined, undefined, env);
      if (intro) {
        data.title = title;
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    if (data.title) {
      return json({ status: true, msg: "ok", time: "0s", data }, 200, {
        "cache-control": "public, max-age=86400",
      });
    }
    return json({ status: false, msg: "not found", data: null }, 404, {
      "cache-control": "public, max-age=60",
    });
  }
  if (url.pathname === "/api/music/detail" && request.method === "GET") {
    const startedAt = Date.now();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!title) return json({ status: false, msg: "缺少参数 name", data: null }, 400);
    if (title.length > 120) return json({ status: false, msg: "invalid_title", data: null }, 400);
    const creator = url.searchParams.get("creator")?.trim() ?? "";
    const year = url.searchParams.get("year")?.trim() ?? "";

    const data: Record<string, unknown> = { title };

    // 两步并行（互不依赖）：Step 1 歌曲导向元数据——gdstudio 搜索按歌名+歌手
    // 匹配单曲/歌曲条目，不做专辑联想（豆瓣音乐详情已移除：专辑导向且反爬不稳）；
    // Step 2 简介——中文歌名百度百科优先 → 维基消歧打分，均在 fetchContentIntro 内。
    const [track, intro] = await Promise.all([
      gdSearch(title, 10, env)
        .then(({ tracks }) => pickTrack(tracks, title, creator || undefined))
        .catch(() => null),
      fetchContentIntro(title, "music", creator || undefined, year || undefined, env),
    ]);
    if (track) {
      if (track.name) data.matchedTitle = track.name;
      const artist = Array.isArray(track.artist)
        ? track.artist.join(" / ")
        : String(track.artist ?? "");
      if (artist) data.artist = artist;
      if (track.album) data.album = track.album;
    }
    if (intro) {
      data.content_intro = intro.intro;
      data.content_source = intro.source;
    }

    return json(
      {
        status: true,
        msg: "ok",
        time: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        data,
      },
      200,
      { "cache-control": "public, max-age=3600" },
    );
  }
  if (url.pathname === "/api/artwork/detail" && request.method === "GET") {
    const kind = url.searchParams.get("kind");
    const title = url.searchParams.get("q")?.trim();
    if (
      !title ||
      title.length > 120 ||
      (kind !== "film" && kind !== "book" && kind !== "music" && kind !== "other")
    ) {
      return json({ status: false, msg: "invalid_query", data: null }, 400);
    }
    // 同 /api/other/detail：年份是消歧最硬信号（清单格式「标题 - 游戏 (年)」）
    const detailYear = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    if (kind === "other") {
      try {
        const work = await withDeadline(
          otherDetail(title, detailYear),
          OTHER_DETAIL_DEADLINE_MS,
          "artwork-detail-other",
        );
        if (!work)
          return json({ status: false, msg: "not_found", data: null }, 404, {
            "cache-control": "public, max-age=300",
          });
        return json({ status: true, msg: "ok", data: work }, 200, {
          "cache-control": "public, max-age=3600",
        });
      } catch (error) {
        if (error instanceof DeadlineError) return upstreamTimeout();
        return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
          "cache-control": "public, max-age=300",
        });
      }
    }
    // 歌曲导向（去豆瓣）：gdstudio 单曲元数据 + 维基/百科简介
    if (kind === "music") {
      const data: Record<string, unknown> = { title };
      try {
        const { tracks } = await gdSearch(title, 10, env);
        const track = pickTrack(tracks, title, undefined);
        if (track) {
          if (track.name) data.matchedTitle = track.name;
          const artist = Array.isArray(track.artist)
            ? track.artist.join(" / ")
            : String(track.artist ?? "");
          if (artist) data.artist = artist;
          if (track.album) data.album = track.album;
        }
      } catch {}
      // creator 透传（复审 #6）：启用泛义词条防线，且缓存键与 music/detail 分开
      const intro = await fetchContentIntro(
        title,
        "music",
        data.artist as string | undefined,
        undefined,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
      return json({ status: true, msg: "ok", data }, 200, {
        "cache-control": "public, max-age=3600",
      });
    }
    const type = kind === "film" ? "movie" : kind;
    try {
      const search = await doubanSearch(type, title, 1);
      const subject = search.data.find(
        (item) =>
          typeof item.cover_link === "string" && item.cover_link.includes("douban.com/subject/"),
      );
      if (!subject?.cover_link)
        return json({ status: false, msg: "not_found", data: null }, 404, {
          "cache-control": "public, max-age=300",
        });
      // music 已在上方早返回；此处只剩 film/book
      const detail =
        kind === "film"
          ? await doubanMovieDetail(subject.cover_link)
          : await doubanBookDetail(subject.cover_link);
      return json({ ...detail, source_url: subject.cover_link }, detail.status ? 200 : 502, {
        "cache-control": detail.status ? "public, max-age=86400" : "public, max-age=300",
      });
    } catch {
      return json({ status: false, msg: "douban_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=300",
      });
    }
  }
  if (url.pathname === "/api/other/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim() ?? "";
    if (!key || key.length > 80) return json({ status: false, msg: "invalid_key", data: [] }, 400);
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const works = await otherSearch(key);
      return json({ status: true, msg: "ok", data: works }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ status: false, msg: "wiki_unavailable", data: [] }, 502);
    }
  }
  if (url.pathname === "/api/other/detail" && request.method === "GET") {
    const name = (url.searchParams.get("name") ?? url.searchParams.get("title"))?.trim() ?? "";
    if (!name || name.length > 120)
      return json({ status: false, msg: "invalid_name", data: null }, 400);
    // 用户条目的年份是消歧最硬信号（清单格式「标题 - 游戏 (年)」）：精确页是
    // 系列页/同名概念页时按年份重新择优（动物森友会→2001 首作 vs 2020 正作）
    const year = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const work = await withDeadline(
        otherDetail(name, year),
        OTHER_DETAIL_DEADLINE_MS,
        "other-detail",
      );
      if (!work)
        return json({ status: false, msg: "not_found", data: null }, 404, {
          "cache-control": "public, max-age=300",
        });
      return json({ status: true, msg: "ok", data: work }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch (error) {
      if (error instanceof DeadlineError) return upstreamTimeout();
      return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=300",
      });
    }
  }
  if (url.pathname === "/api/other/candidates" && request.method === "GET") {
    const name = (url.searchParams.get("name") ?? url.searchParams.get("title"))?.trim() ?? "";
    const english = (url.searchParams.get("english") ?? "").trim();
    if (!name || name.length > 120)
      return json({ status: false, msg: "invalid_name", data: null }, 400);
    // 与 name 同口径的上限：english 原样进上游查询 URL，当前前端虽不发这个
    // 参数，也别留一个无界的口子在这。
    if (english.length > 120)
      return json({ status: false, msg: "invalid_english", data: null }, 400);
    const year = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    // 与 /api/other/detail 共享「other」限流桶：诊断端点不能变成绕过配额的旁路。
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const report = await withDeadline(
        otherCandidateReport(name, english, year),
        OTHER_CANDIDATES_DEADLINE_MS,
        "other-candidates",
      );
      return json({ status: true, msg: "ok", data: report }, 200, {
        "cache-control": "public, max-age=300",
      });
    } catch (error) {
      if (error instanceof DeadlineError) return upstreamTimeout();
      return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=60",
      });
    }
  }
  if (url.pathname === "/api/other/cover-choice" && request.method === "POST") {
    // 用户的封面选择写进 poster_urls —— 不新增表、不加列，直接 UPSERT 同一张表，
    // 于是前端 <Poster> 零改动就能吃到它（PLAN-CHOICE-UI §3.3）。
    //
    // 三道闸门，缺一不可：
    //  ① assertSameOrigin —— 挡跨站表单/跨源脚本写入。
    //  ② getUserFromToken —— 必须登录：这是**全站封面位**的写入口，匿名可写等于
    //     任何人都能改别人看到的封面。/api/poster-errors/client 那类匿名写端点
    //     只写 poster_errors 错误日志，不碰展示数据，性质不同。
    //  ③ allowedImage + 维基域白名单 —— allowedImage 管「能不能取图」，
    //     白名单管「能不能把一个地址塞进封面位」：只收 upload/thumb.wikimedia.org。
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "auth_required" }, 401);
    const body = await readJson(request);
    const title = cleanString(body.title, "title", 160);
    // english 缺省回落到标题：Poster.tsx 的 batchKey 就是这个口径（subtitle ?? title），
    // 少了这个回落就会算出一个前端永远取不到的键。
    const english = cleanOptionalString(body.english, "english", 160) ?? title;
    const wikiTitle = cleanString(body.wikiTitle, "wiki_title", 160);
    const rawUrl = cleanString(body.url, "url", 1200);
    const parsed = allowedImage(rawUrl);
    // 维基之外一律拒绝：这条写入会直接变成用户看到的封面位。
    if (!parsed || !/^(?:upload|thumb)\.wikimedia\.org$/.test(parsed.hostname))
      return json({ error: "invalid_url" }, 400);
    const key = posterKeyFor({ title, english, year: body.year, type: "other" });
    if (!key) return json({ error: "invalid_title" }, 400);
    const storedUrl = parsed.href;
    await saveResolvedPosters(env.DB, [{ key, urls: [storedUrl] }]);
    // 回读确认：poster_urls 无 TTL，一次写错就是永久的一行。
    // 注意这只能证明「写进去又读得回来」，证明不了「键与前端要的那把一致」——
    // 那条不变量由 worker/coverChoice.test.ts 用前端公式 posterMediaKey 钉住。
    const stored = await loadPosterUrls(env.DB, [key]);
    const urls = stored.get(key) ?? [];
    if (!urls.includes(storedUrl)) return json({ error: "write_verify_failed" }, 500);
    // 审计留痕：任何登录用户都能改全站封面位（注释已声明的产品取舍），
    // 这笔写必须可追溯——与管理操作同表（admin_audit，看板渲染已过 esc）。
    await recordAudit(
      env,
      "cover_choice",
      JSON.stringify({ title, wikiTitle, url: storedUrl, userId: user.id, email: user.email }),
      request,
    );
    return json({ ok: true, key, url: storedUrl, wikiTitle }, 200);
  }
  if (url.pathname === "/api/music/play" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    const artist = url.searchParams.get("artist")?.trim() ?? "";
    if (!query || query.length > 80 || artist.length > 80)
      return json({ error: "invalid_query" }, 400);
    // 试听与歌词**各自独立**的配额（各 12 次/10 分钟）：一个入口不再吃掉另一个的额度。
    // 命中缓存（同一首歌重听）时零上游调用，就不记账；只有真会打上游的请求才占额度。
    // 限流窗口是 10 分钟，retry-after 必须与之一致，否则客户端按 60 秒重试仍会被拦。
    if (
      playNeedsUpstream(query, artist) &&
      !(await allowUpstreamRequest(request, "music_play", 12))
    ) {
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    }
    try {
      const { tracks, blocked } = await gdSearch(query, 10, env);
      if (blocked)
        return json({ error: "music_upstream_limited" }, 429, {
          "retry-after": "300",
          msg: "音乐服务暂时限流，稍后再试",
        });
      if (!tracks.length)
        return json({ error: "music_search_failed", msg: "音乐搜索暂不可用，请稍后重试" }, 502, {
          "cache-control": "public, max-age=60",
        });
      let track = null;
      let playUrl = "";
      for (const candidate of pickTracks(tracks, query, artist, 3)) {
        const candidateUrl = await gdPlayUrl(String(candidate.id), env);
        if (candidateUrl) {
          track = candidate;
          playUrl = candidateUrl;
          break;
        }
      }
      if (!track)
        return json({ error: "music_not_found" }, 404, { "cache-control": "public, max-age=300" });
      const isCover = isCoverTrack(track, query, artist);
      return json({ track, playUrl, lyricId: String(track.lyric_id || track.id), isCover }, 200, {
        "cache-control": "no-store",
      });
    } catch {
      return json({ error: "music_unavailable" }, 502);
    }
  }
  // 歌词：按歌曲名（+可选歌手）解析曲目后返回 LRC 剥离时间轴的纯文本
  if (url.pathname === "/api/music/lyric" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    const artist = url.searchParams.get("artist")?.trim() ?? "";
    if (!query || query.length > 80 || artist.length > 80)
      return json({ error: "invalid_query" }, 400);
    if (
      lyricNeedsUpstream(query, artist) &&
      !(await allowUpstreamRequest(request, "music_lyric", 12))
    ) {
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    }
    try {
      const { tracks, blocked } = await gdSearch(query, 10, env);
      if (blocked)
        return json({ error: "music_upstream_limited" }, 429, {
          "retry-after": "300",
          msg: "歌词服务暂时限流，稍后再试",
        });
      if (!tracks.length)
        return json({ error: "music_search_failed", msg: "歌词搜索暂不可用，请稍后重试" }, 502, {
          "cache-control": "public, max-age=60",
        });
      const track = pickTrack(tracks, query, artist);
      if (!track)
        return json({ error: "music_not_found" }, 404, { "cache-control": "public, max-age=300" });
      const result = await gdLyric(String(track.lyric_id || track.id), env);
      if (!result)
        return json({ error: "lyric_not_found" }, 404, { "cache-control": "public, max-age=3600" });
      const lyric = stripLrc(result.lyric);
      const tlyric = stripLrc(result.tlyric);
      return json(
        {
          title: track.name,
          artist: Array.isArray(track.artist)
            ? track.artist.join(" / ")
            : String(track.artist ?? ""),
          lyric,
          ...(tlyric ? { tlyric } : {}),
        },
        200,
        { "cache-control": "public, max-age=86400" },
      );
    } catch {
      return json({ error: "lyric_unavailable" }, 502);
    }
  }
  return null;
}
