import type { MediaKind } from "../../data/mediaKinds";
import { setNote, writeNotes } from "../../lib/notes";
import { Modal } from "../Modal";

export interface NoteEditModalProps {
  t: (zh: string, en: string) => string;
  noteModal: { key: string; title: string; kind: MediaKind; posterUrls?: readonly string[] };
  noteDraft: string;
  setNoteDraft: (val: string) => void;
  notes: Record<string, string>;
  setNotes: (notes: Record<string, string>) => void;
  setNotice: (msg: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function NoteEditModal({
  t,
  noteModal,
  noteDraft,
  setNoteDraft,
  notes,
  setNotes,
  setNotice,
  onSave,
  onClose,
}: NoteEditModalProps) {
  return (
    <Modal
      t={t}
      headingId="note-heading"
      panelClassName="note-reader"
      backdropClassName="modal-backdrop note-backdrop"
      onClose={onClose}
    >
      <div
        className="note-reader-bg"
        style={{
          backgroundImage: noteModal.posterUrls?.[0]
            ? `url(/api/image?url=${encodeURIComponent(noteModal.posterUrls[0])})`
            : undefined,
        }}
      />
      <div className="note-reader-header">
        <span className="note-reader-eyebrow">NOTE</span>
        <h2 id="note-heading">{noteModal.title}</h2>
      </div>
      <textarea
        className="note-reader-body"
        value={noteDraft}
        onChange={(e) => setNoteDraft(e.target.value)}
        placeholder={t(
          "写下你对这部作品的看法、感想、回忆…",
          "Write your thoughts, feelings, memories about this work...",
        )}
        autoFocus
      />
      <div className="note-reader-footer">
        <button
          className="note-footer-btn"
          onClick={() => {
            const next = setNote(notes, noteModal.key, "");
            setNotes(next);
            writeNotes(next);
            setNoteDraft("");
            setNotice(t("批注已清除。", "Note cleared."));
          }}
        >
          {t("清除", "Clear")}
        </button>
        {noteDraft.length > 0 && (
          <span className="note-char-count">
            {noteDraft.length} {t("字", "chars")}
          </span>
        )}
        <div className="u-spacer" />
        <button className="note-footer-btn" onClick={onClose}>
          {t("取消", "Cancel")}
        </button>
        <button className="note-footer-btn note-footer-primary" onClick={onSave}>
          {t("保存", "Save")}
        </button>
      </div>
    </Modal>
  );
}

export interface NoteViewModalProps {
  t: (zh: string, en: string) => string;
  noteViewModal: { title: string; text: string; posterUrls?: readonly string[] };
  onClose: () => void;
}

export function NoteViewModal({ t, noteViewModal, onClose }: NoteViewModalProps) {
  return (
    <Modal
      t={t}
      headingId="note-view-heading"
      panelClassName="note-reader"
      backdropClassName="modal-backdrop note-backdrop"
      onClose={onClose}
    >
      <div
        className="note-reader-bg"
        style={{
          backgroundImage: noteViewModal.posterUrls?.[0]
            ? `url(/api/image?url=${encodeURIComponent(noteViewModal.posterUrls[0])})`
            : undefined,
        }}
      />
      <div className="note-reader-header">
        <span className="note-reader-eyebrow">NOTE</span>
        <h2 id="note-view-heading">{noteViewModal.title}</h2>
      </div>
      <div className="note-reader-body note-reader-view">
        <p>{noteViewModal.text}</p>
      </div>
      <div className="note-reader-footer">
        <div className="u-spacer" />
        <button className="note-footer-btn note-footer-primary" onClick={onClose}>
          {t("关闭", "Close")}
        </button>
      </div>
    </Modal>
  );
}
