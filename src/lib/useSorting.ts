import { useRef } from "react";
import type { MediaKind } from "../data/mediaKinds";
import { useCloudCollections } from "./useCloudCollections";
import { useCollectionImporter } from "./useCollectionImporter";
import {
  loadDraft,
  resolveRankingTabKey,
  useSortingSession,
  type Draft,
  type SortingSessionDeps,
} from "./useSortingSession";

export { loadDraft, resolveRankingTabKey, type Draft };
export type SortingDeps = SortingSessionDeps;

export function useSorting(deps: SortingDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const session = useSortingSession(deps);
  const cloud = useCloudCollections({
    accountToken: deps.accountToken,
    setNotice: deps.setNotice,
    t: deps.t,
  });
  const importer = useCollectionImporter({
    accountToken: deps.accountToken,
    profileName: deps.profileName,
    getProfile: deps.getProfile,
    persist: deps.persist,
    setActiveKind: deps.setActiveKind,
    setNotice: deps.setNotice,
    navigateTo: deps.navigateTo,
    t: deps.t,
    label: deps.label,
    kind: session.kind,
    openCollection: session.openCollection,
    saveCollectionCloud: cloud.saveCollectionCloud,
    resolveRankingTabKey,
  });

  function chooseKind(next: MediaKind) {
    const d = depsRef.current;
    session.setKind(next);
    session.setSource("builtin");
    session.setSearch("");
    importer.setCustomText("");
    importer.setCustomWorks([]);
    d.navigateTo("source");
  }

  return {
    ...session,
    ...cloud,
    ...importer,
    chooseKind,
  };
}
