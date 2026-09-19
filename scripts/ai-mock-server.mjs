/**
 * AI 上游 mock 服务器 —— 本地端到端验证用（docs/PLAN-ai-insights.md §7.2）。
 *
 * 不进构建、不进 bundle；仅在手动验证时运行：`npm run ai:mock`（端口 9393）。
 * 同时挂载四协议端点与两个模型列表端点，返回固定点评文本。
 *
 * 错误注入走 apiKey 前缀（网页端/CURL 都能触发，无需改 URL）：
 *   err401…   → 401   err404…  → 404   err429… → 429
 *   errslow…  → 延迟 6s 后 200（模拟超时）  errgarbage… → 200 + 非 JSON
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT || 9393);

const INSIGHT_ZH =
  "1. 总体印象：这是一份偏爱叙事与情绪密度的榜单。\n2. 品味亮点：对创作者生涯阶段的把握相当稳定。\n3. 可以留意的盲区：年代分布略有偏移，可补充更早的作品。";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

function modeOf(req, bodyApiKey) {
  // Node http 的 req.headers 是普通对象（键全小写），不是 Headers 实例。
  const key =
    req.headers["x-api-key"] ||
    req.headers["x-goog-api-key"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    bodyApiKey ||
    "";
  if (key.startsWith("err401")) return 401;
  if (key.startsWith("err404")) return 404;
  if (key.startsWith("err429")) return 429;
  if (key.startsWith("errslow")) return "slow";
  if (key.startsWith("errgarbage")) return "garbage";
  return "ok";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let bodyApiKey = "";
  try {
    bodyApiKey = JSON.parse(raw)?.model === "err401" ? "err401" : "";
  } catch {
    /* body 不总是 JSON */
  }

  const respond = (status, payload) => {
    res.writeHead(status, headers);
    res.end(JSON.stringify(payload));
  };

  // 模型列表端点
  if (
    req.method === "GET" &&
    (path === "/v1/models" || path === "/models" || path === "/v1beta/models")
  ) {
    const mode = modeOf(req);
    if (mode === 401) return respond(401, { error: "invalid_api_key" });
    if (mode === "garbage") {
      res.writeHead(200, headers);
      return res.end("not-json");
    }
    if (path === "/v1beta/models")
      return respond(200, { models: [{ name: "models/mock-flash" }, { name: "models/mock-pro" }] });
    return respond(200, { data: [{ id: "mock-mini" }, { id: "mock-large" }] });
  }

  // 四协议生成端点
  const isGenerate =
    (req.method === "POST" &&
      [
        "/v1/chat/completions",
        "/chat/completions",
        "/v1/responses",
        "/responses",
        "/v1/messages",
        "/messages",
      ].includes(path)) ||
    (req.method === "POST" && path.includes(":generateContent"));
  if (!isGenerate) return respond(404, { error: "not_found", path });

  const mode = modeOf(req, bodyApiKey);
  if (mode === 401) return respond(401, { error: { message: "invalid api key" } });
  if (mode === 404) return respond(404, { error: "not found" });
  if (mode === 429) return respond(429, { error: "rate limited" });
  if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 6000));
  if (mode === "garbage") {
    res.writeHead(200, headers);
    return res.end("<html>blocked</html>");
  }

  if (path.endsWith("/responses"))
    return respond(200, {
      output: [{ type: "message", content: [{ type: "output_text", text: INSIGHT_ZH }] }],
    });
  if (path.endsWith("/messages"))
    return respond(200, { content: [{ type: "text", text: INSIGHT_ZH }] });
  if (path.includes(":generateContent"))
    return respond(200, { candidates: [{ content: { parts: [{ text: INSIGHT_ZH }] } }] });
  return respond(200, { choices: [{ message: { content: INSIGHT_ZH } }] });
});

server.listen(PORT, () => {
  console.log(`AI mock server listening on http://localhost:${PORT}`);
  console.log(
    "Endpoints: /v1/chat/completions /v1/responses /v1/messages /v1beta/models/{m}:generateContent /v1/models /v1beta/models",
  );
  console.log("Error injection: apiKey prefix err401 / err404 / err429 / errslow / errgarbage");
});
