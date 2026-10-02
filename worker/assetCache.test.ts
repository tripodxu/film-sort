import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";

/** 假 ASSETS：按请求路径回一个带默认 `max-age=0, must-revalidate` 的响应，
 *  与 Workers 静态资源的真实默认行为一致（2026-10-02 线上实测该头就来自这里）。 */
function fakeAssets() {
  return {
    async fetch(request: Request): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/" || pathname === "/index.html") {
        return new Response("<!doctype html>", {
          headers: {
            "content-type": "text/html",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      }
      if (pathname === "/assets/index-Cix8RSlz.js") {
        return new Response("console.log(1)", {
          headers: {
            "content-type": "text/javascript",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      }
      if (pathname === "/assets/index-BNDWEENQ.css") {
        return new Response("body{}", {
          headers: {
            "content-type": "text/css",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      }
      if (pathname === "/assets/three.module-YZZFkaN9.js") {
        return new Response("export{}", {
          headers: {
            "content-type": "text/javascript",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      }
      // 无哈希的资源：必须真的返回 200，否则缓存策略会在 status !== 200 处短路，
      // 根本走不到「正则拒绝」这一步，断言就成摆设（这是本文件第一版的漏洞）。
      if (pathname === "/assets/favicon.svg" || pathname === "/assets/orbit-zoom.png") {
        return new Response("<svg/>", {
          headers: {
            "content-type": "image/svg+xml",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  };
}

function envWithAssets(): Env {
  return { ASSETS: fakeAssets() as unknown as Fetcher } as unknown as Env;
}

function assetGet(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://sort.logicc.top${path}`, { headers }), envWithAssets(), {
    waitUntil: () => undefined,
  } as unknown as ExecutionContext);
}

describe("静态资源缓存策略（PLAN-ASSET-CACHE）", () => {
  it("内容哈希产物挂 immutable 一年", async () => {
    for (const path of [
      "/assets/index-Cix8RSlz.js",
      "/assets/index-BNDWEENQ.css",
      "/assets/three.module-YZZFkaN9.js",
    ]) {
      const res = await assetGet(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=31536000, immutable");
    }
  });

  it("index.html 保持 must-revalidate：它是部署切换的入口", async () => {
    const res = await assetGet("/", { accept: "text/html" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("无哈希的 /assets 文件不得被判成 immutable", async () => {
    // 两者都必须真的 200 才有意义：非 200 时策略直接短路，正则根本不被调用。
    for (const path of ["/assets/favicon.svg", "/assets/orbit-zoom.png"]) {
      const res = await assetGet(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=0, must-revalidate");
    }
  });

  it("未知路径的 404 不被改头（策略只对 200/304 生效）", async () => {
    const res = await assetGet("/assets/does-not-exist.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("安全头一条都不能因为改缓存头而丢掉", async () => {
    const res = await assetGet("/assets/index-Cix8RSlz.js");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("SPA fallback 仍要求 Accept: text/html，且 fallback 回来的 index.html 不带 immutable", async () => {
    const withHtml = await assetGet("/plaza", { accept: "text/html" });
    expect(withHtml.status).toBe(200);
    expect(withHtml.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const withoutHtml = await assetGet("/plaza");
    expect(withoutHtml.status).toBe(404);
  });
});
