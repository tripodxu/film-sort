import { describe, expect, it, vi } from "vitest";
import { OutboundError, fetchBounded, parseAllowedUrl, readBoundedText } from "./outbound";

const doubanPolicy = {
  allowedHosts: ["book.douban.com", "movie.douban.com"],
  maxBytes: 1024,
  timeoutMs: 1000,
  maxRedirects: 2,
} as const;

describe("outbound policy", () => {
  it("accepts an exact allowed host and subject path", () => {
    expect(parseAllowedUrl("https://book.douban.com/subject/123/", doubanPolicy).hostname).toBe(
      "book.douban.com",
    );
  });

  it("rejects a host that only contains the allowed substring", () => {
    expect(() =>
      parseAllowedUrl("https://attacker.example/book.douban.com/subject/123", doubanPolicy),
    ).toThrow(OutboundError);
  });

  it("rejects http, credentials, and non-allowed ports", () => {
    expect(() => parseAllowedUrl("http://book.douban.com/subject/123", doubanPolicy)).toThrow();
    expect(() => parseAllowedUrl("https://u:p@book.douban.com/subject/123", doubanPolicy)).toThrow();
    expect(() => parseAllowedUrl("https://book.douban.com:8443/subject/123", doubanPolicy)).toThrow();
  });

  it("does not follow a redirect to another host", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(
      fetchBounded("https://book.douban.com/subject/123", {}, doubanPolicy, fetchImpl),
    ).rejects.toThrow(OutboundError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response body over maxBytes", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(1025), { status: 200 }));
    const response = await fetchBounded(
      "https://book.douban.com/subject/123",
      {},
      doubanPolicy,
      fetchImpl,
    );
    await expect(readBoundedText(response, doubanPolicy.maxBytes)).rejects.toThrow(OutboundError);
  });
});
