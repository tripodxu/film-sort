import { CloudDownload, CloudUpload } from "lucide-react";
import { Modal } from "../Modal";
import { mergeProfiles, type ArtisticProfile } from "../../lib/profile";
import { writeNotes } from "../../lib/notes";
import { buildProfileSyncBody } from "../../lib/profileSync";

export interface CloudConflictModalProps {
  t: (zh: string, en: string) => string;
  cloudConflict: { profile: ArtisticProfile; notes: Record<string, string> };
  profile: ArtisticProfile | null;
  notes: Record<string, string>;
  accountToken: string;
  persist: (next: ArtisticProfile) => void;
  setNotes: (notes: Record<string, string>) => void;
  setSyncStatus: (status: "idle" | "saving" | "saved" | "error") => void;
  setNotice: (msg: string) => void;
  onClose: () => void;
}

export function CloudConflictModal({
  t,
  cloudConflict,
  profile,
  notes,
  accountToken,
  persist,
  setNotes,
  setSyncStatus,
  setNotice,
  onClose,
}: CloudConflictModalProps) {
  return (
    <Modal
      t={t}
      headingId="cloud-conflict-heading"
      title={t("数据冲突", "Data conflict")}
      onClose={onClose}
    >
      <p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
        {t(
          "本地有游客数据，云端也有数据。请选择如何处理：",
          "You have local guest data and cloud data. Choose how to proceed:",
        )}
      </p>
      <div className="u-col">
        <button
          className="button primary"
          onClick={() => {
            if (profile && cloudConflict) {
              const merged = mergeProfiles(cloudConflict.profile, profile);
              persist(merged);
              setSyncStatus("saving");
              fetch("/api/account/profile", {
                method: "PUT",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${accountToken}`,
                },
                body: JSON.stringify(buildProfileSyncBody(merged, notes, true)),
              })
                .then((r) => {
                  setSyncStatus(r.ok ? "saved" : "error");
                  if (r.ok) setNotice(t("已增量合并到云端。", "Merged to cloud."));
                })
                .catch(() => setSyncStatus("error"));
            }
            onClose();
          }}
        >
          <CloudUpload size={16} />
          {t("增量合并到云端", "Merge to cloud")}
        </button>
        <button
          className="button secondary"
          onClick={() => {
            persist(cloudConflict.profile);
            setNotes({ ...cloudConflict.notes });
            writeNotes({ ...cloudConflict.notes });
            onClose();
            setNotice(t("已使用云端数据。", "Cloud data applied."));
          }}
        >
          <CloudDownload size={16} />
          {t("使用云端数据", "Use cloud data")}
        </button>
        <button className="button quiet" onClick={onClose}>
          {t("取消，各自保留", "Cancel, keep both")}
        </button>
      </div>
    </Modal>
  );
}
