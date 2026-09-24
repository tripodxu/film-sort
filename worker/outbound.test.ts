import { describe, expect, it, vi } from "vitest";
import { OutboundError, fetchBounded, parseAllowedUrl, readBoundedText } from "./outbound";

const doubanPolicy = {
  allowedHosts: ["book.douban.com", "movie.douban.com"],
  maxBytes: 1024,
  timeoutMs: 1000,
  maxRedirects: 2,
} as const;

function createOversizedMultibyteBody(maxBytes: number) {
  const characters = "界".repeat(Math.floor(maxBytes / 3) + 1);
  const bytes = new TextEncoder().encode(characters);
  let sent = false;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }

      sent = true;
      controller.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
    },
  });

  return { bytes, characters, stream, wasCancelled: () => cancelled };
}

describe("outbound policy", () => {
  it("accepts an exact allowed host and subject path", () => {
    const url = parseAllowedUrl("https://book.douban.com/subject/123/", doubanPolicy);

    expect(url.href).toBe("https://book.douban.com/subject/123/");
  });

  it("rejects a host that only contains the allowed substring", () => {
    expect(() =>
      parseAllowedUrl("https://book.douban.com.attacker.example/subject/123", doubanPolicy),
    ).toThrow(OutboundError);
  });

  it("rejects http, credentials, and non-allowed ports", () => {
    expect(() => parseAllowedUrl("http://book.douban.com/subject/123", doubanPolicy)).toThrow();
    expect(() =>
      parseAllowedUrl("https://u:p@book.douban.com/subject/123", doubanPolicy),
    ).toThrow();
    expect(() =>
      parseAllowedUrl("https://book.douban.com:8443/subject/123", doubanPolicy),
    ).toThrow();
  });

  it("does not follow a redirect to another host", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );

    await expect(
      fetchBounded("https://book.douban.com/subject/123", {}, doubanPolicy, fetchImpl),
    ).rejects.toThrow(OutboundError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://book.douban.com/subject/123",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows an allowed same-host redirect without automatic redirects", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://book.douban.com/subject/456/" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await fetchBounded(
      "https://book.douban.com/subject/123",
      {},
      doubanPolicy,
      fetchImpl,
    );

    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://book.douban.com/subject/123",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://book.douban.com/subject/456/",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects a multibyte response body over maxBytes without draining it", async () => {
    const body = createOversizedMultibyteBody(doubanPolicy.maxBytes);
    expect(body.characters.length).toBeLessThan(doubanPolicy.maxBytes);
    expect(body.bytes.byteLength).toBeGreaterThan(doubanPolicy.maxBytes);

    const response = new Response(body.stream, { status: 200 });

    await expect(readBoundedText(response, doubanPolicy.maxBytes)).rejects.toThrow(OutboundError);
    expect(body.wasCancelled()).toBe(true);
  });
});
