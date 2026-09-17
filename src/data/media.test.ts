import { describe, expect, it } from "vitest";
import { mediaCollections } from "./media";

describe("built-in media data", () => {
  it("preserves seeded years for non-film collections", () => {
    const book = mediaCollections.find((entry) => entry.id === "book-modern-classics");
    const music = mediaCollections.find((entry) => entry.id === "music-albums");
    const other = mediaCollections.find((entry) => entry.id === "other-cultural-works");
    expect(book?.works[0]?.year).toBe(1967);
    expect(music?.works[0]?.year).toBe(2004);
    expect(other?.works[0]?.year).toBe(2014);
  });
});
