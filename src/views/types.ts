import type { ReactNode } from "react";
import type { RankingState } from "../lib/ranking";
import type { MediaCollection, MediaKind } from "../data/media";
import type { ArtisticProfile, RankingExport, RankedArtwork } from "../lib/profile";

export type Locale = "zh" | "en";

export interface HomeViewProps {
  locale: Locale;
  t: (zh: string, en: string) => string;
  accountEmail: string;
  setAccountOpen: (open: boolean) => void;
  setShowGuide: (show: boolean) => void;
  kind: MediaKind;
  chooseKind: (kind: MediaKind) => void;
  navigateTo: (view: "home" | "source" | "setup" | "sorting" | "profile" | "compare") => void;
  draft: { collection: MediaCollection; ranking: string; profileName: string } | null;
  resume: () => void;
  profile: ArtisticProfile | null;
  label: (kind: MediaKind) => string;
  setRingsLayout: (layout: "row" | "col") => void;
  ringsLayout: "row" | "col";
  clearAllData: () => void;
  editingRankIdx: number | null;
  setEditingRankIdx: (idx: number | null) => void;
  editingRankTitle: string;
  setEditingRankTitle: (title: string) => void;
  renameRank: (idx: number) => void;
  deleteRank: (idx: number) => void;
  setActiveKind: (kind: string) => void;
  openCollection: (collection: MediaCollection) => void;
  importProfile: (file: File, target: "own" | "peer") => void;
}

export interface SourceViewProps {
  kind: MediaKind;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  source: "builtin" | "custom" | "douban";
  setSource: (source: "builtin" | "custom" | "douban") => void;
  setNotice: (notice: string) => void;
  search: string;
  setSearch: (search: string) => void;
  colCount: number;
  changeCols: (n: number) => void;
  collections: MediaCollection[];
  openCollection: (collection: MediaCollection) => void;
  customItem: string;
  setCustomItem: (item: string) => void;
  addCustomItem: () => void;
  customText: string;
  setCustomText: (text: string) => void;
  importCollection: (kind: MediaKind, text: string) => MediaCollection;
  saveCollectionCloud: (collection: MediaCollection) => void;
  cloudCollections: Array<MediaCollection & { remoteId: number }>;
  loadCloudCollections: () => void;
  deleteCloudCollection: (item: MediaCollection & { remoteId: number }) => void;
  doubanLimit: number;
  setDoubanLimit: (limit: number) => void;
  busy: boolean;
  loadDouban: () => void;
}

export interface SetupViewProps {
  collection: MediaCollection;
  kind: MediaKind;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  selected: string[];
  setSelected: (selected: string[]) => void;
  topN: number;
  setTopN: (topN: number) => void;
  seed: string;
  setSeed: (seed: string) => void;
  setCollection: (collection: MediaCollection) => void;
  startRanking: () => void;
}

export interface SortingViewProps {
  collection: MediaCollection;
  ranking: RankingState;
  comparison: { leftId: string; rightId: string; phase: "ranking" | "verification" };
  progress: { fraction: number; phase: "ranking" | "verification" | "complete"; processed: number; total: number; estimatedRemaining: number; comparisonCount: number; verificationRemaining: number };
  label: (kind: MediaKind) => string;
  kind: MediaKind;
  t: (zh: string, en: string) => string;
  worksById: Map<string, import("../data/media").Artwork>;
  act: (action: "left" | "right" | "undo" | "skip-left" | "skip-right" | "defer-left" | "defer-right") => void;
}

export interface ProfileViewProps {
  profile: ArtisticProfile;
  activeRanking: RankingExport;
  locale: Locale;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  format: "json" | "txt" | "md" | "csv" | "png";
  setFormat: (format: "json" | "txt" | "md" | "csv" | "png") => void;
  exportLayout: "editorial" | "collage" | "minimal";
  setExportLayout: (layout: "editorial" | "collage" | "minimal") => void;
  exportProfile: () => void;
  share: () => void;
  shareUrl: string;
  qrUrl: string;
  profileName: string;
  setProfileName: (name: string) => void;
  namedProfile: () => ArtisticProfile | null;
  persist: (profile: ArtisticProfile) => void;
  navigateTo: (view: "home" | "source" | "setup" | "sorting" | "profile" | "compare") => void;
  peer: ArtisticProfile | null;
  editingRankIdx: number | null;
  setEditingRankIdx: (idx: number | null) => void;
  editingRankTitle: string;
  setEditingRankTitle: (title: string) => void;
  renameRank: (idx: number) => void;
  openCollection: (collection: MediaCollection) => void;
  shareSingleRanking: (ranking: RankingExport) => void;
  setActiveKind: (kind: string) => void;
  ranking: RankingState | null;
  setRanking: (ranking: RankingState | null) => void;
  collection: MediaCollection | null;
  notes: Record<string, string>;
  openNoteModal: (key: string, title: string, kind: MediaKind, posterUrls?: readonly string[]) => void;
}

export interface CompareViewProps {
  kinds: MediaKind[];
  profile: ArtisticProfile | null;
  peer: ArtisticProfile | null;
  compareActiveKind: MediaKind;
  setCompareActiveKind: (kind: MediaKind) => void;
  compareMode: "auto" | "manual";
  setCompareMode: (mode: "auto" | "manual") => void;
  manualOwnSelections: Set<number>;
  setManualOwnSelections: (sel: Set<number>) => void;
  manualPeerSelections: Set<number>;
  setManualPeerSelections: (sel: Set<number>) => void;
  compareRankings: typeof import("../lib/profile").compareRankings;
  mergeDimensionRankings: typeof import("../lib/profile").mergeDimensionRankings;
  compareDimensions: typeof import("../lib/profile").compareDimensions;
  compareProfiles: typeof import("../lib/profile").compareProfiles;
  navigateTo: (view: "home" | "source" | "setup" | "sorting" | "profile" | "compare") => void;
  setPeer: (peer: ArtisticProfile | null) => void;
  setAiInsight: (insight: string) => void;
  label: (kind: MediaKind) => string;
  t: (zh: string, en: string) => string;
  setCompareSortBy: (by: "own" | "peer") => void;
  compareSortBy: "own" | "peer";
  setCompareRankDetail: (detail: { side: "own" | "peer"; collectionTitle: string; ranking: RankingExport | null; highlightId?: string } | null) => void;
  shareSingleRanking: (ranking: RankingExport) => void;
  exportProfile: () => void;
  setFormat: (format: "json" | "txt" | "md" | "csv" | "png") => void;
  busy: boolean;
  namedProfile: () => ArtisticProfile | null;
  setNotice: (notice: string) => void;
  requestInsight: () => void;
  aiBusy: boolean;
  aiInsight: string;
  createFromPeer: (kind: MediaKind) => void;
  setPeerRankPickOpen: (open: boolean) => void;
  openArtworkDetail: (work: RankedArtwork, kind: MediaKind) => void;
  peerUrl: string;
  setPeerUrl: (url: string) => void;
  peerUrlBusy: boolean;
  importPeerFromUrl: () => void;
  importProfile: (file: File, target: "own" | "peer") => void;
}
