// 出站请求统一策略 Seam：协议/精确 host/端口/凭据校验 → manual redirect 逐跳复核 →
// 超时与响应字节上限。所有指向用户可控 URL 或外部上游的 fetch 都应经由本模块，
// 否则子串 host 校验（url.includes）和跟随跳转会把 Worker 变成可借用的代理（findings SEC-01/02/OPS-01）。

export interface OutboundPolicy {
  /** 允许的精确 hostname（小写、不含端口）；大小写不敏感，但必须是完整匹配。 */
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** 最终响应的 content-type 前缀白名单；缺省不限制。 */
  allowedContentTypes?: readonly string[];
}

export class OutboundError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "disallowed_protocol"
      | "disallowed_credentials"
      | "disallowed_port"
      | "disallowed_host"
      | "disallowed_content_type"
      | "redirect_budget_exceeded"
      | "invalid_redirect"
      | "timeout"
      | "network_error"
      | "body_too_large",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OutboundError";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 精确校验 URL：https、无凭据、无显式非常规端口、hostname 完整命中白名单。 */
export function parseAllowedUrl(value: string, policy: OutboundPolicy): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundError("invalid_url", `URL not parseable: ${value.slice(0, 120)}`);
  }
  if (url.protocol !== "https:")
    throw new OutboundError("disallowed_protocol", `protocol must be https`);
  if (url.username || url.password)
    throw new OutboundError("disallowed_credentials", "URL must not carry credentials");
  // https 默认端口在 WHATWG URL 里归一化为 ""；任何显式端口都视为非常规。
  if (url.port) throw new OutboundError("disallowed_port", `port must be default, got ${url.port}`);
  const host = url.hostname.toLowerCase();
  if (!policy.allowedHosts.includes(host))
    throw new OutboundError("disallowed_host", `host ${host} is not allowed`);
  return url;
}

function isOutboundError(error: unknown): error is OutboundError {
  return error instanceof OutboundError;
}

/**
 * 受限 fetch：manual redirect，逐跳按同一 policy 校验 Location（相对跳转也解析复核），
 * 跳数超过 maxRedirects 直接拒绝；返回最终 Response 且不消费 body（由 readBounded* 限量读取）。
 */
export async function fetchBounded(
  input: string | URL,
  init: RequestInit,
  policy: OutboundPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let currentUrl = parseAllowedUrl(String(input), policy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
  // 显式传入的 signal（若有）一并联动，不覆盖调用方的取消语义。
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let currentInit: RequestInit = { ...init, redirect: "manual", signal: controller.signal };
  try {
    for (let hops = 0; ; hops += 1) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl.href, currentInit);
      } catch (error) {
        if (controller.signal.aborted)
          throw new OutboundError("timeout", `upstream timed out after ${policy.timeoutMs}ms`);
        if (isOutboundError(error)) throw error;
        throw new OutboundError(
          "network_error",
          `upstream fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!REDIRECT_STATUSES.has(response.status)) {
        const allowedTypes = policy.allowedContentTypes;
        if (allowedTypes && allowedTypes.length) {
          const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
          if (!allowedTypes.some((type) => contentType.startsWith(type)))
            throw new OutboundError(
              "disallowed_content_type",
              `content-type ${contentType || "(missing)"} is not allowed`,
            );
        }
        return response;
      }
      if (hops >= policy.maxRedirects)
        throw new OutboundError(
          "redirect_budget_exceeded",
          `redirect budget of ${policy.maxRedirects} exceeded`,
        );
      const location = response.headers.get("location");
      if (!location) return response;
      let next: URL;
      try {
        next = new URL(location, currentUrl);
      } catch {
        throw new OutboundError(
          "invalid_redirect",
          `redirect location not parseable: ${location.slice(0, 120)}`,
        );
      }
      currentUrl = parseAllowedUrl(next.href, policy);
      // 301/302/303 语义上改写为 GET（与浏览器一致）；307/308 原样重放方法与 body。
      if (
        response.status === 303 ||
        (response.status <= 302 && (currentInit.method ?? "GET").toUpperCase() !== "GET")
      )
        currentInit = { ...currentInit, method: "GET", body: undefined };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 流式限量读取 UTF-8 文本：累计字节超限立即取消 reader 并拒绝，不排空恶意超大 body。 */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new OutboundError("body_too_large", `response body exceeds ${maxBytes} bytes`);
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes)
        throw new OutboundError("body_too_large", `response body exceeds ${maxBytes} bytes`);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel(error instanceof Error ? error : undefined).catch(() => {});
    throw error;
  }
}

/** 限量读取并解析 JSON。 */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(response, maxBytes);
  return JSON.parse(text) as unknown;
}
