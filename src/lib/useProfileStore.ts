import { useState } from "react";
import type { MediaKind } from "../data/mediaKinds";
import { readNotes, setNote, writeNotes } from "./notes";
import {
  deleteRanking,
  readProfile,
  renameRanking,
  reorderRanking,
  toRankedItems,
  type ArtisticProfile,
  type RankedArtwork,
} from "./profile";
import { LIBRARY_KEY } from "./storageKeys";

export interface ProfileStoreDeps {
  t: (zh: string, en: string) => string;
  setNotice: (n: string) => void;
  onPersist?: () => void;
}

export function useProfileStore(deps: ProfileStoreDeps) {
  const [profile, setProfile] = useState<ArtisticProfile | null>(() => {
    try {
      return readProfile(localStorage);
    } catch {
      return null;
    }
  });
  const [profileName, setProfileName] = useState(
    () => profile?.profileName ?? deps.t("我的艺术人格", "My artistic profile"),
  );
  const [activeKind, setActiveKind] = useState<string>("film");
  const [editingRankIdx, setEditingRankIdx] = useState<number | null>(null);
  const [editingRankTitle, setEditingRankTitle] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>(readNotes);
  const [noteModal, setNoteModal] = useState<{
    key: string;
    title: string;
    kind: MediaKind;
    posterUrls?: readonly string[];
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteViewModal, setNoteViewModal] = useState<{
    title: string;
    text: string;
    posterUrls?: readonly string[];
  } | null>(null);
  const [reorderMode, setReorderMode] = useState<number | null>(null);
  const [reorderItems, setReorderItems] = useState<RankedArtwork[]>([]);

  const activeRanking =
    profile?.rankings.find((entry, idx) => `${entry.kind}-${idx}` === activeKind) ??
    profile?.rankings.find((entry) => entry.kind === activeKind) ??
    profile?.rankings[0];

  function openNoteModal(
    key: string,
    title: string,
    kind: MediaKind,
    posterUrls?: readonly string[],
  ) {
    setNoteModal({ key, title, kind, posterUrls });
    setNoteDraft(notes[key] ?? "");
  }

  function openNoteView(title: string, text: string, posterUrls?: readonly string[]) {
    setNoteViewModal({ title, text, posterUrls });
  }

  function saveNote() {
    if (!noteModal) return;
    const next = setNote(notes, noteModal.key, noteDraft);
    setNotes(next);
    writeNotes(next);
    setNoteModal(null);
  }

  function persist(next: ArtisticProfile) {
    // 复用唯一可落库形状（shared/storedItem.ts，经 profile.ts 的 toRankedItems）：
    // posterUrls 与任何未知字段都由白名单挡住，不再依赖这里手写 destructure。
    const cleaned: ArtisticProfile = {
      ...next,
      rankings: next.rankings.map((r) => ({ ...r, items: toRankedItems(r.items) })),
    };
    setProfile(cleaned);
    setProfileName(cleaned.profileName);
    deps.onPersist?.();
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(cleaned));
      writeNotes(notes);
    } catch (e) {
      console.error("[persist] localStorage write failed:", e);
      deps.setNotice(
        deps.t(
          "浏览器无法保存，请及时导出画像。",
          "Browser storage is unavailable. Export your profile to keep it.",
        ),
      );
    }
  }

  function renameRank(idx: number) {
    if (!profile || !editingRankTitle.trim()) return;
    const next = renameRanking(profile, idx, editingRankTitle.trim());
    persist(next);
    setEditingRankIdx(null);
    setEditingRankTitle("");
  }

  function deleteRank(idx: number) {
    if (!profile) return;
    const next = deleteRanking(profile, idx);
    if (next) persist(next);
    else {
      setProfile(null);
      try {
        localStorage.removeItem(LIBRARY_KEY);
      } catch {}
    }
    setEditingRankIdx(null);
  }

  function updateRankingWorks(rankingIdx: number, works: RankedArtwork[]) {
    if (!profile || works.length < 1) return;
    const rankings = [...profile.rankings];
    if (rankingIdx < 0 || rankingIdx >= rankings.length) return;
    rankings[rankingIdx] = {
      ...rankings[rankingIdx],
      items: works.map((w, i) => ({ ...w, rank: i + 1 })),
    };
    persist({ ...profile, rankings, updatedAt: new Date().toISOString() });
    deps.setNotice(deps.t("榜单作品已更新。", "Ranking works updated."));
  }

  function startReorder(rankingIdx: number) {
    if (!profile) return;
    setReorderMode(rankingIdx);
    setReorderItems([...profile.rankings[rankingIdx].items]);
  }

  function saveReorder() {
    if (!profile || reorderMode === null) return;
    const newOrderIds = reorderItems.map((item) => item.id);
    const next = reorderRanking(profile, reorderMode, newOrderIds);
    persist(next);
    setReorderMode(null);
    setReorderItems([]);
  }

  function cancelReorder() {
    setReorderMode(null);
    setReorderItems([]);
  }

  function moveItem(from: number, to: number) {
    setReorderItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return {
    profile,
    setProfile,
    profileName,
    setProfileName,
    activeKind,
    setActiveKind,
    activeRanking,
    editingRankIdx,
    setEditingRankIdx,
    editingRankTitle,
    setEditingRankTitle,
    notes,
    setNotes,
    noteModal,
    setNoteModal,
    noteDraft,
    setNoteDraft,
    noteViewModal,
    setNoteViewModal,
    reorderMode,
    setReorderMode,
    reorderItems,
    setReorderItems,
    openNoteModal,
    openNoteView,
    saveNote,
    persist,
    renameRank,
    deleteRank,
    updateRankingWorks,
    startReorder,
    saveReorder,
    cancelReorder,
    moveItem,
  };
}
