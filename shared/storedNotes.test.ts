import { describe, expect, it } from "vitest";
import { encodeStoredNotes } from "./storedItem";

describe("notes whitelist encode", () => {
  it("filters keys and non-strings", () => {
    const encoded = encodeStoredNotes({
      "work:film:tt1": "good",
      "ranking:film:my": "note",
      "profile:self": "p",
      "evil:drop": "x",
      nested: { a: 1 },
      "work:film:tt2": 123,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(JSON.parse(encoded.json!)).toEqual({
      "work:film:tt1": "good",
      "ranking:film:my": "note",
      "profile:self": "p",
    });
    expect(encoded.count).toBe(3);
  });

  it("empty notes encode to null", () => {
    expect(encodeStoredNotes({})).toEqual({ ok: true, json: null, count: 0 });
    expect(encodeStoredNotes(null)).toEqual({ ok: true, json: null, count: 0 });
    expect(encodeStoredNotes([{ x: 1 }])).toEqual({ ok: true, json: null, count: 0 });
  });

  it("drops oversized note text", () => {
    const encoded = encodeStoredNotes({
      "work:music:1": "a".repeat(5001),
      "work:music:3": "fine",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(JSON.parse(encoded.json!)).toEqual({ "work:music:3": "fine" });
  });

  it("keeps keys with spaces and full-width spaces (collection titles are free text)", () => {
    const longTitleKey = `ranking:film:${"长".repeat(220)}`;
    const encoded = encodeStoredNotes({
      "ranking:film:My Top 10": "a",
      "ranking:film:我的 2024 榜单": "b",
      "ranking:film:我的\u30002024": "c",
      "work:film:My Movie": "d",
      [longTitleKey]: "e",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(JSON.parse(encoded.json!)).toEqual({
      "ranking:film:My Top 10": "a",
      "ranking:film:我的 2024 榜单": "b",
      "ranking:film:我的\u30002024": "c",
      "work:film:My Movie": "d",
      [longTitleKey]: "e",
    });
    expect(encoded.count).toBe(5);
  });

  it("keeps multi-line text (newlines/tabs are normal note content)", () => {
    const encoded = encodeStoredNotes({
      "work:film:tt1": "第一行\n第二行\r\n\t缩进",
      "work:film:tt2": "bad\u0000null",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(JSON.parse(encoded.json!)).toEqual({ "work:film:tt1": "第一行\n第二行\r\n\t缩进" });
  });

  it("still rejects control characters inside keys", () => {
    const encoded = encodeStoredNotes({
      "work:film:bad\nkey": "x",
      "work:film:good": "y",
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(JSON.parse(encoded.json!)).toEqual({ "work:film:good": "y" });
  });
});
