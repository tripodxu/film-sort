import { useEffect, useRef, useState } from "react";
import type { MediaCollection, MediaKind } from "../data/mediaKinds";
import { dedupeByTitle } from "./profile";

export interface CloudCollectionsDeps {
  accountToken: string;
  setNotice: (msg: string) => void;
  t: (zh: string, en: string) => string;
}

export type CloudCollection = MediaCollection & { remoteId: number };

export function useCloudCollections(deps: CloudCollectionsDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { accountToken } = deps;

  const [cloudCollections, setCloudCollections] = useState<CloudCollection[]>([]);

  async function loadCloudCollections() {
    const token = depsRef.current.accountToken;
    if (!token) {
      setCloudCollections([]);
      return;
    }
    try {
      const response = await fetch("/api/account/collections", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = response.ok
        ? ((await response.json()) as {
            collections?: Array<{
              id: number;
              kind: MediaKind;
              title: string;
              description: string;
              items: MediaCollection["works"];
            }>;
          })
        : null;
      // 云端清单也要过一遍去重：历史清单里可能已经存了重复曲目（本轮事故的来源），
      // 载入时合并，避免用户点进来又保存一次同样的坏数据。
      setCloudCollections(
        (data?.collections ?? []).map((item) => {
          const works = dedupeByTitle(item.items ?? []);
          return {
            remoteId: item.id,
            id: `cloud-${item.id}`,
            kind: item.kind,
            source: "custom",
            title: item.title,
            description: item.description,
            topN: Math.min(10, works.length),
            works,
          };
        }),
      );
    } catch {
      setCloudCollections([]);
    }
  }

  async function saveCollectionCloud(collectionToSave: MediaCollection) {
    const token = depsRef.current.accountToken;
    if (!token) return;
    try {
      // 云端清单也按同一口径去重后再上传：历史清单里可能已经存了重复曲目
      // （本轮事故的来源），顺手把库里那份也洗干净。
      const items = dedupeByTitle(collectionToSave.works);
      const response = await fetch("/api/account/collections", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: collectionToSave.kind,
          title: collectionToSave.title,
          description: collectionToSave.description,
          items,
        }),
      });
      if (response.ok) void loadCloudCollections();
    } catch {
      /* */
    }
  }

  async function deleteCloudCollection(item: CloudCollection) {
    const d = depsRef.current;
    if (!d.accountToken) return;
    try {
      const response = await fetch(`/api/account/collections/${item.remoteId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${d.accountToken}` },
      });
      if (!response.ok) throw new Error();
      setCloudCollections((current) => current.filter((entry) => entry.remoteId !== item.remoteId));
      d.setNotice(d.t("云端清单已移除。", "Cloud list removed."));
    } catch {
      d.setNotice(
        d.t("无法移除云端清单，请稍后重试。", "Could not remove the cloud list. Please retry."),
      );
    }
  }

  // Load cloud collections on token change (login, logout)
  useEffect(() => {
    void loadCloudCollections();
  }, [accountToken]);

  return {
    cloudCollections,
    saveCollectionCloud,
    loadCloudCollections,
    deleteCloudCollection,
  };
}
