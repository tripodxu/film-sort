import { describe, expect, it } from "vitest";
import { buildProfileSyncBody, isCurrentGeneration } from "./profileSync";
import type { ArtisticProfile } from "./profile";

const profile = {
  version: 2,
  profileId: "p",
  profileName: "n",
  updatedAt: "2026-09-25T00:00:00.000Z",
  rankings: [],
} as unknown as ArtisticProfile;

describe("buildProfileSyncBody", () => {
  it("omits the notes field entirely when not included", () => {
    const body = buildProfileSyncBody(profile, {}, false);
    expect(Object.hasOwn(body, "notes")).toBe(false);
    expect(body.profile).toBe(profile);
  });

  it("includes an explicit empty notes object when requested", () => {
    const body = buildProfileSyncBody(profile, {}, true);
    expect(Object.hasOwn(body, "notes")).toBe(true);
    expect(body.notes).toEqual({});
  });

  it("carries the notes map through when included", () => {
    const body = buildProfileSyncBody(profile, { "work-1": "批注" }, true);
    expect(body.notes).toEqual({ "work-1": "批注" });
  });
});

describe("isCurrentGeneration", () => {
  it("accepts only the exact current generation", () => {
    expect(isCurrentGeneration(3, 3)).toBe(true);
    expect(isCurrentGeneration(3, 2)).toBe(false);
    expect(isCurrentGeneration(3, 4)).toBe(false);
  });
});
