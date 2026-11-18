import { getUserFromToken } from "../account";
import {
  AiError,
  aiErrorPayload,
  aiErrorStatus,
  callAi,
  callModelAuto,
  composePrompt,
  listAiModels,
  readPromptOverride,
  resolveEndpoint,
  testAiConnection,
  validateUserConfig,
  type AiProtocol,
  type AiScene,
  type ResolvedAi,
} from "../ai";
import {
  jevChoose,
  jevPick,
  jevRank,
  parseJevChooseBody,
  parseJevPickBody,
  parseJevRankBody,
  resolveJevConfig,
  testJevConnection,
  type JevCallConfig,
} from "../typesafe";
import {
  allowUpstreamRequest,
  assertSameOrigin,
  cleanOptionalString,
  isObject,
  json,
  readJson,
  type Env,
  type JsonObject,
} from "../http";

const MAX_AI_DATA_BYTES = 16 * 1024;

function resolveJevRequestConfig(body: JsonObject, env: Env): JevCallConfig | Response {
  const config = resolveJevConfig(body.config, body.useBuiltin, env.JEV_API_KEY);
  if (config) return config;
  if (body.useBuiltin === true)
    return json(
      {
        ok: false,
        error: "builtin_unavailable",
        msg: "站内免费通道暂不可用，可在「AI 服务」配置自己的 TypeSafe Key",
      },
      503,
    );
  return json(
    { ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" },
    400,
  );
}

export async function handleAiRoutes(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (url.pathname === "/api/ai/test" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_test", 5, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateUserConfig(body.config);
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "API 配置不合法（检查地址/密钥/模型名）" },
        400,
      );
    try {
      return json(await testAiConnection(config));
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev/test" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_test", 5, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const resolved = resolveJevRequestConfig(body, env);
    if (resolved instanceof Response) return resolved;
    try {
      return json(await testJevConnection(resolved));
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-rank" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev", 10, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const resolved = resolveJevRequestConfig(body, env);
    if (resolved instanceof Response) return resolved;
    const parsed = parseJevRankBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "作品数据不合法" }, 400);
    try {
      const result = await jevRank(parsed, resolved);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-disambiguate" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_disambiguate", 20, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const resolved = resolveJevRequestConfig(body, env);
    if (resolved instanceof Response) return resolved;
    const parsed = parseJevChooseBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "候选数据不合法" }, 400);
    try {
      const result = await jevChoose(parsed, resolved);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error), fallback: "rules" }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-pick" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_pick", 60, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const resolved = resolveJevRequestConfig(body, env);
    if (resolved instanceof Response) return resolved;
    const parsed = parseJevPickBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "作品数据不合法" }, 400);
    try {
      const result = await jevPick(parsed, resolved);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/models" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_models", 10, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const raw = (body.config ?? {}) as Record<string, unknown>;
    const config = validateUserConfig({
      ...raw,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : "list",
    });
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "API 配置不合法（检查地址/密钥）" },
        400,
      );
    try {
      const result = await listAiModels(config);
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/insights" && request.method === "POST") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const scene = cleanOptionalString(body.scene, "scene", 10);
    if (scene !== "ranking" && scene !== "profile" && scene !== "compare")
      return json({ error: "invalid_scene" }, 400);
    const data = body.data;
    if (!isObject(data)) return json({ error: "invalid_data", msg: "数据格式不正确" }, 400);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_AI_DATA_BYTES)
      return json({ error: "data_too_large", msg: "数据过大" }, 413);
    const locale = body.locale === "en" ? "en" : "zh";
    const length = body.length === "brief" || body.length === "deep" ? body.length : "standard";
    const maxTokens = length === "deep" ? 6000 : length === "standard" ? 3500 : 2000;
    const maxOutputChars = length === "deep" ? 9000 : length === "standard" ? 5000 : 2500;
    const custom = body.config !== undefined ? validateUserConfig(body.config) : null;
    if (body.config !== undefined && !custom)
      return json({ error: "invalid_config", msg: "API 配置不合法（检查地址/密钥/模型名）" }, 400);
    let source: "builtin" | "custom";
    let resolved: ResolvedAi | null = null;
    if (custom) {
      if (!(await allowUpstreamRequest(request, "ai_custom", 15, env.DB)))
        return json({ error: "rate_limited", msg: "操作太频繁，请 10 分钟后再试" }, 429, {
          "retry-after": "600",
        });
      source = "custom";
    } else {
      if (!env.AI_API_KEY)
        return json(
          { error: "ai_not_configured", msg: "服务端未配置 AI，可在设置里填入自己的 API" },
          503,
        );
      if (!(await allowUpstreamRequest(request, "ai", 8, env.DB)))
        return json({ error: "rate_limited", msg: "操作太频繁，请 10 分钟后再试" }, 429, {
          "retry-after": "600",
        });
      const aiUser = env.DB ? await getUserFromToken(request, env.DB) : null;
      if (!aiUser)
        return json(
          {
            error: "authentication_required",
            msg: "内置 AI 仅对登录用户开放，也可在设置里填入自己的 API",
          },
          401,
        );
      const model = env.AI_MODEL?.trim() || "claude-3-5-haiku-latest";
      const protocol: AiProtocol =
        env.AI_PROTOCOL === "chat" ||
        env.AI_PROTOCOL === "responses" ||
        env.AI_PROTOCOL === "gemini"
          ? env.AI_PROTOCOL
          : "anthropic";
      const base = (
        env.AI_API_URL?.trim() || "https://token-plan-cn.xiaomimimo.com/anthropic"
      ).replace(/\/+$/, "");
      resolved = {
        endpoint: protocol === "anthropic" ? base : resolveEndpoint(base, protocol, model),
        apiKey: env.AI_API_KEY,
        model,
        protocol,
      };
      source = "builtin";
    }
    const overrideSystem = await readPromptOverride(env.DB, scene);
    const spec = composePrompt(scene as AiScene, data, locale, { length, overrideSystem });
    if (!spec) return json({ error: "invalid_data", msg: "数据格式不正确" }, 400);
    try {
      if (custom) {
        const outcome = await callModelAuto(custom, spec);
        return json(
          {
            insight: outcome.text,
            source,
            model: outcome.model,
            protocol: outcome.protocol,
            promptVersion: spec.version,
          },
          200,
          { "cache-control": "no-store" },
        );
      }
      const outcome = resolved as ResolvedAi;
      return json(
        {
          insight: await callAi(outcome, spec, { maxTokens, maxOutputChars }),
          source,
          model: outcome.model,
          protocol: outcome.protocol,
          promptVersion: spec.version,
        },
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (error instanceof AiError) console.warn(`ai insights failed: ${error.code}`);
      return json(aiErrorPayload(error), aiErrorStatus(error));
    }
  }
  return null;
}
