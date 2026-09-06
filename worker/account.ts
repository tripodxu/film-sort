import type { Env } from "./index";

interface AccessClaims { aud?: string | string[]; email?: string; exp?: number; iss?: string; sub?: string }
interface AccessJwk extends JsonWebKey { kid?: string }
const encoder = new TextEncoder();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const base64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (char) => char.charCodeAt(0));

async function identity(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  const domain = env.ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!token || !domain || !env.ACCESS_AUD) return null;
  try {
    const [headerText, claimsText, signatureText] = token.split(".");
    if (!headerText || !claimsText || !signatureText) return null;
    const header = JSON.parse(new TextDecoder().decode(base64url(headerText))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(base64url(claimsText))) as AccessClaims;
    if (header.alg !== "RS256" || !header.kid || !claims.sub || !claims.email || !claims.exp || claims.exp < Date.now() / 1000 ||
      claims.iss !== `https://${domain}` || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(env.ACCESS_AUD)) return null;
    const certs = await fetch(`https://${domain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } }).then((response) => response.json()) as { keys?: AccessJwk[] };
    const jwk = certs.keys?.find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(signatureText), encoder.encode(`${headerText}.${claimsText}`));
    return valid ? { id: claims.sub, email: claims.email } : null;
  } catch { return null; }
}

export async function accountRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return json({ error: "account_sync_unavailable" }, 503);
  const user = await identity(request, env);
  if (!user) return json({ error: "authentication_required" }, 401);
  const path = new URL(request.url).pathname;
  if (path !== "/api/account/profile") return json({ error: "not_found" }, 404);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT profile, updated_at FROM user_profiles WHERE user_id = ? LIMIT 1").bind(user.id).first<{ profile: string; updated_at: string }>();
    return json({ email: user.email, profile: row ? JSON.parse(row.profile) : null, updatedAt: row?.updated_at ?? null });
  }
  if (request.method === "PUT") {
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > 512 * 1024) return json({ error: "payload_too_large" }, 413);
    let profile: unknown;
    try { profile = JSON.parse(raw).profile; } catch { return json({ error: "invalid_json" }, 400); }
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return json({ error: "invalid_profile" }, 400);
    await env.DB.prepare("INSERT INTO user_profiles (user_id, profile) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .bind(user.id, JSON.stringify(profile)).run();
    return json({ stored: true });
  }
  return json({ error: "method_not_allowed" }, 405);
}
