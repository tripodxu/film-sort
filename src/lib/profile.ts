import { mediaLabels, type Artwork, type MediaKind } from "../data/media";

export interface RankedArtwork extends Artwork { rank: number }
export interface RankingExport {
  version: 1;
  profileId: string;
  profileName: string;
  kind: MediaKind;
  collectionTitle: string;
  createdAt: string;
  items: RankedArtwork[];
}
export interface ArtisticProfile {
  version: 2;
  profileId: string;
  profileName: string;
  updatedAt: string;
  rankings: RankingExport[];
}

export const LIBRARY_KEY = "art-rank:library:v2";
export const MAX_PROFILE_BYTES = 512 * 1024;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export const normalizeTitle = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const validDate = (value: unknown): value is string => typeof value === "string" && value.length < 40 && Number.isFinite(Date.parse(value));
const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
};

function parseRanking(value: unknown): RankingExport {
  if (!record(value) || value.version !== 1 || !text(value.profileId) || !text(value.profileName, 80) ||
    !text(value.collectionTitle) || !Object.hasOwn(mediaLabels, String(value.kind)) || !validDate(value.createdAt) ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 300) throw new Error("Invalid ranking");
  const ids = new Set<string>();
  const titles = new Set<string>();
  const ranks = new Set<number>();
  const items = value.items.map((item): RankedArtwork => {
    if (!record(item) || !text(item.id) || !text(item.title) || !Number.isInteger(item.rank) ||
      Number(item.rank) < 1 || Number(item.rank) > (value.items as unknown[]).length || ids.has(item.id) || ranks.has(Number(item.rank)) ||
      (item.creator !== undefined && !text(item.creator)) || (item.year !== undefined && (!Number.isInteger(item.year) || Number(item.year) < 1 || Number(item.year) > 2200))) throw new Error("Invalid artwork");
    const identity = `${normalizeTitle(item.title)}|${item.year ?? ""}|${normalizeTitle(String(item.creator ?? ""))}`;
    if (titles.has(identity)) throw new Error("Duplicate artwork");
    ids.add(item.id); titles.add(identity); ranks.add(Number(item.rank));
    return {
      id: item.id, title: item.title.trim(), rank: Number(item.rank),
      ...(item.creator ? { creator: String(item.creator) } : {}),
      ...(item.year ? { year: Number(item.year) } : {}),
      ...(text(item.subtitle) ? { subtitle: item.subtitle } : {}),
      ...(Array.isArray(item.posterUrls) ? { posterUrls: item.posterUrls.filter(validUrl).slice(0, 8) } : {}),
    };
  }).sort((a, b) => a.rank - b.rank);
  if (items.some((item, index) => item.rank !== index + 1)) throw new Error("Ranks must be contiguous");
  return { version: 1, profileId: value.profileId, profileName: value.profileName, kind: value.kind as MediaKind, collectionTitle: value.collectionTitle, createdAt: value.createdAt, items };
}

export function parseProfile(value: unknown): ArtisticProfile {
  if (!record(value)) throw new Error("Invalid profile");
  if (value.version === 1) {
    const ranking = parseRanking(value);
    return { version: 2, profileId: ranking.profileId, profileName: ranking.profileName, updatedAt: ranking.createdAt, rankings: [ranking] };
  }
  if (value.version !== 2 || !text(value.profileId) || !text(value.profileName, 80) || !validDate(value.updatedAt) ||
    !Array.isArray(value.rankings) || value.rankings.length < 1 || value.rankings.length > 20) throw new Error("Invalid profile");
  const rankings = value.rankings.map(parseRanking);
  return { version: 2, profileId: value.profileId, profileName: value.profileName, updatedAt: value.updatedAt, rankings };
}

export function readProfile(storage: Storage): ArtisticProfile | null {
  try {
    const stored = storage.getItem(LIBRARY_KEY);
    if (stored) return parseProfile(JSON.parse(stored));
    // Migrate earlier single-medium exports by timestamp, never by storage key order.
    const legacy: RankingExport[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith("art-rank:profile:")) continue;
      try { legacy.push(...parseProfile(JSON.parse(storage.getItem(key) ?? "")).rankings); } catch { /* Ignore unrelated name preferences. */ }
    }
    return legacy.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).reduce<ArtisticProfile | null>((profile, ranking) => mergeRanking(profile, ranking), null);
  } catch { return null; }
}

export function mergeRanking(profile: ArtisticProfile | null, ranking: RankingExport): ArtisticProfile {
  const existing = profile?.rankings ?? [];
  // Replace if same collectionTitle+kind exists, otherwise append
  const key = (r: RankingExport) => `${r.kind}|${r.collectionTitle}`;
  const rankingKey = key(ranking);
  const filtered = existing.filter((entry) => key(entry) !== rankingKey);
  return {
    version: 2, profileId: profile?.profileId ?? crypto.randomUUID(), profileName: ranking.profileName,
    updatedAt: ranking.createdAt,
    rankings: [...filtered, ranking].sort((a, b) => Object.keys(mediaLabels).indexOf(a.kind) - Object.keys(mediaLabels).indexOf(b.kind)),
  };
}

export function renameRanking(profile: ArtisticProfile, index: number, newTitle: string): ArtisticProfile {
  const rankings = [...profile.rankings];
  if (index < 0 || index >= rankings.length) return profile;
  rankings[index] = { ...rankings[index], collectionTitle: newTitle };
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

export function deleteRanking(profile: ArtisticProfile, index: number): ArtisticProfile | null {
  const rankings = profile.rankings.filter((_, i) => i !== index);
  if (rankings.length === 0) return null;
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

function sameArtwork(a: RankedArtwork, b: RankedArtwork): boolean {
  return normalizeTitle(a.title) === normalizeTitle(b.title) &&
    (!a.year || !b.year || a.year === b.year) &&
    (!a.creator || !b.creator || normalizeTitle(a.creator) === normalizeTitle(b.creator));
}

export function compareRankings(own: RankingExport, peer: RankingExport) {
  if (own.kind !== peer.kind) throw new Error("Different media cannot be compared");
  const matched = new Set<string>();
  const shared = own.items.flatMap((item) => {
    const other = peer.items.find((candidate) => !matched.has(candidate.id) && sameArtwork(item, candidate));
    if (!other) return [];
    matched.add(other.id);
    return [{ title: item.title, ownRank: item.rank, peerRank: other.rank, difference: Math.abs(item.rank - other.rank) }];
  });
  let agreements = 0;
  let pairs = 0;
  for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
    pairs++;
    if ((shared[i].ownRank - shared[j].ownRank) * (shared[i].peerRank - shared[j].peerRank) > 0) agreements++;
  }
  return {
    shared,
    overlap: Math.round(100 * shared.length / (own.items.length + peer.items.length - shared.length)),
    orderAgreement: pairs ? Math.round(100 * agreements / pairs) : null,
    top5Overlap: shared.filter((item) => item.ownRank <= 5 && item.peerRank <= 5).length,
    disagreements: [...shared].filter((item) => item.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5),
  };
}

export function profileText(profile: ArtisticProfile, format: "txt" | "md" | "csv"): string {
  if (format === "csv") {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    return "\uFEFF" + [["medium", "rank", "title", "creator", "year"], ...profile.rankings.flatMap((ranking) => ranking.items.map((item) => [ranking.kind, item.rank, item.title, item.creator, item.year]))].map((row) => row.map(cell).join(",")).join("\r\n");
  }
  return `${format === "md" ? "# " : ""}${profile.profileName}\n\n` + profile.rankings.map((ranking) => `${format === "md" ? "## " : ""}${mediaLabels[ranking.kind].label} / ${ranking.collectionTitle}\n\n${ranking.items.map((item) => `${item.rank}. ${item.title}${item.creator ? ` / ${item.creator}` : ""}`).join("\n")}`).join("\n\n");
}
