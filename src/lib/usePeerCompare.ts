import { useRef, useState } from "react";
import type { MediaCollection, MediaKind } from "../data/mediaKinds";
import { parseProfile, type ArtisticProfile, type RankingExport } from "./profile";
import { PEER_KEY, stored } from "./storageKeys";
import { decode } from "./utils";

function loadPeer(): ArtisticProfile | null {
  try {
    return parseProfile(JSON.parse(stored(PEER_KEY) ?? ""));
  } catch {
    return null;
  }
}

export interface PeerCompareDeps {
  t: (zh: string, en: string) => string;
  setNotice: (n: string) => void;
  setActiveKind: (k: string) => void;
  navigateTo: (view: "compare") => void;
  chooseKind: (kind: MediaKind) => void;
  openCollection: (collection: MediaCollection) => void;
}

export function usePeerCompare(deps: PeerCompareDeps) {
  const [peer, setPeer] = useState<ArtisticProfile | null>(loadPeer);
  const [peerNotes, setPeerNotes] = useState<Record<string, string>>({});
  const [compareActiveKind, setCompareActiveKind] = useState<MediaKind>("film");
  const [compareMode, setCompareMode] = useState<"auto" | "manual">("auto");
  const [manualOwnSelections, setManualOwnSelections] = useState<Set<number>>(new Set());
  const [manualPeerSelections, setManualPeerSelections] = useState<Set<number>>(new Set());
  const [compareRankDetail, setCompareRankDetail] = useState<{
    side: "own" | "peer";
    collectionTitle: string;
    ranking: RankingExport | null;
    highlightId?: string;
  } | null>(null);
  const [compareSortBy, setCompareSortBy] = useState<"own" | "peer">("own");
  const [peerRankPickOpen, setPeerRankPickOpen] = useState(false);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerUrlBusy, setPeerUrlBusy] = useState(false);
  const peerImportGenRef = useRef(0);

  function acceptPeer(next: ArtisticProfile) {
    setPeer(next);
    deps.setActiveKind(next.rankings[0].kind);
    setCompareActiveKind(next.rankings[0].kind);
    deps.navigateTo("compare");
    try {
      localStorage.setItem(PEER_KEY, JSON.stringify(next));
    } catch {
      /* Keep the in-memory copy. */
    }
  }

  function createFromPeer(nextKind: MediaKind) {
    const entry = peer?.rankings.find((item) => item.kind === nextKind);
    if (!entry || entry.items.length < 2) {
      deps.chooseKind(nextKind);
      return;
    }
    deps.openCollection({
      id: `peer-${entry.profileId}`,
      kind: nextKind,
      source: "custom",
      title: entry.collectionTitle,
      description: "",
      topN: entry.items.length,
      works: entry.items,
    });
  }

  async function importPeerFromUrl() {
    const url = peerUrl.trim();
    if (!url || peerUrlBusy) return;
    const gen = ++peerImportGenRef.current;
    setPeerUrlBusy(true);
    try {
      const parsed = new URL(url, location.origin);
      const shareMatch = parsed.pathname.match(/^\/share\/([0-9a-f]{8,12})$/i);
      if (shareMatch) {
        const r = await fetch(`/api/share/${shareMatch[1]}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { profile: unknown; notes?: Record<string, string> };
        if (gen !== peerImportGenRef.current) return;
        acceptPeer(parseProfile(d.profile));
        if (d.notes && typeof d.notes === "object") setPeerNotes(d.notes);
        setPeerUrl("");
        return;
      }
      const payload =
        parsed.searchParams.get("payload") ??
        new URLSearchParams(parsed.hash.slice(1)).get("profile");
      if (payload) {
        if (/^[0-9a-f]{8,12}$/i.test(payload)) {
          const r = await fetch(`/api/share/${payload}`, { signal: AbortSignal.timeout(15000) });
          if (!r.ok) throw new Error();
          const d = (await r.json()) as { profile: unknown };
          if (gen !== peerImportGenRef.current) return;
          acceptPeer(parseProfile(d.profile));
        } else {
          const decoded = await decode(payload);
          if (gen !== peerImportGenRef.current) return;
          acceptPeer(decoded);
        }
        setPeerUrl("");
        return;
      }
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error();
      const parsedJson: unknown = await r.json();
      if (gen !== peerImportGenRef.current) return;
      acceptPeer(parseProfile(parsedJson));
      setPeerUrl("");
    } catch {
      if (gen === peerImportGenRef.current) {
        deps.setNotice(
          deps.t(
            "无法导入该链接，请检查是否为有效分享链接或 JSON 文件。",
            "Could not import from this URL. Check that it is a valid share link or JSON.",
          ),
        );
      }
    } finally {
      if (gen === peerImportGenRef.current) setPeerUrlBusy(false);
    }
  }

  return {
    peer,
    setPeer,
    peerNotes,
    setPeerNotes,
    compareActiveKind,
    setCompareActiveKind,
    compareMode,
    setCompareMode,
    manualOwnSelections,
    setManualOwnSelections,
    manualPeerSelections,
    setManualPeerSelections,
    compareRankDetail,
    setCompareRankDetail,
    compareSortBy,
    setCompareSortBy,
    peerRankPickOpen,
    setPeerRankPickOpen,
    peerUrl,
    setPeerUrl,
    peerUrlBusy,
    acceptPeer,
    createFromPeer,
    importPeerFromUrl,
  };
}
