import { describe, expect, it } from "vitest";
import { compareRankings, mergeRanking, parseProfile, profileText, type RankingExport } from "./profile";

const ranking = (kind: RankingExport["kind"], titles: string[], name = "Test") => ({
  version: 1 as const, profileId: `${kind}-1`, profileName: name, kind, collectionTitle: "List", createdAt: "2026-09-06T00:00:00.000Z",
  items: titles.map((title, index) => ({ id: `${kind}-${index}`, title, rank: index + 1 })),
});

describe("artistic profile data", () => {
  it("merges one ranking per medium and migrates v1 JSON", () => {
    const first = mergeRanking(null, ranking("film", ["A", "B"]));
    const merged = mergeRanking(first, ranking("book", ["C", "D"], "Reader"));
    expect(merged.rankings.map((entry) => entry.kind)).toEqual(["film", "book"]);
    expect(parseProfile(ranking("music", ["X", "Y"])).version).toBe(2);
    expect(profileText(merged, "csv")).toContain('"medium","rank","title"');
  });

  it("rejects sparse ranks and computes overlap plus order agreement", () => {
    expect(() => parseProfile({ ...ranking("film", ["A", "B"]), items: [{ id: "a", title: "A", rank: 2 }] })).toThrow();
    const result = compareRankings(ranking("film", ["A", "B", "C"]), ranking("film", ["B", "A", "C"]));
    expect(result.overlap).toBe(100);
    expect(result.orderAgreement).toBe(67);
    expect(result.disagreements[0]).toMatchObject({ title: "A", difference: 1 });
  });
});
