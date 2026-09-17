import { useState } from "react";
import { Music2, Play, X } from "lucide-react";
import { Poster } from "./Poster";
import { IconButton } from "../views/IconButton";
import { gdPlay, gdLyric } from "../lib/gdMusic";
import type { RankedArtwork } from "../lib/profile";
import type { MediaKind } from "../data/media";

export interface ArtworkDetailInfo {
  work: RankedArtwork;
  kind: MediaKind;
  data: Record<string, unknown> | null;
  loading: boolean;
}

/**
 * 统一的作品详情弹窗（与 RankingDetail 同属 components/ 父级）。
 * 所有点击「作品海报」的入口——文化索引、分享页、广场帖子、比较详情——都打开这一个组件；
 * 点击「榜单海报」的入口则打开对应的榜单详情（RankingDetail）。
 */
export function ArtworkDetail({ detail, label, t, onClose }: { detail: ArtworkDetailInfo; label: (kind: MediaKind) => string; t: (zh: string, en: string) => string; onClose: () => void }) {
  const [playUrl, setPlayUrl] = useState("");
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [isCover, setIsCover] = useState(false);
  const [lyric, setLyric] = useState<string | null>(null);
  const [lyricBusy, setLyricBusy] = useState(false);
  const [lyricError, setLyricError] = useState("");
  const isMusic = detail.kind === "music";
  async function playMusic() {
    if (playUrl) return;
    setPlayBusy(true); setPlayError("");
    const title = detail.work.title;
    const artist = detail.work.creator;
    try {
      const result = await gdPlay(title, artist);
      if (result) { setPlayUrl(result.playUrl); setIsCover(result.isCover); }
      else setPlayError(t("未找到可试听的版本", "No playable version found"));
    } catch { setPlayError(t("试听服务暂不可用", "Preview unavailable")); }
    finally { setPlayBusy(false); }
  }
  async function loadLyric() {
    if (lyric) { setLyric(null); return; }
    setLyricBusy(true); setLyricError("");
    const title = detail.work.title;
    const artist = detail.work.creator;
    try {
      const result = await gdLyric(title, artist);
      if (result?.lyric) setLyric(result.lyric);
      else setLyricError(t("暂无歌词", "No lyrics available"));
    } catch { setLyricError(t("歌词服务暂不可用", "Lyrics unavailable")); }
    finally { setLyricBusy(false); }
  }
  return <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={onClose}><section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-heading" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><span className="eyebrow">{label(detail.kind)} / {t("作品详情", "WORK DETAIL")}</span><h2 id="detail-heading">{detail.work.title}</h2></div><IconButton title={t("关闭", "Close")} onClick={onClose}><X size={18} /></IconButton></div><div className="detail-body"><Poster work={detail.work} kind={detail.kind} large /><div className="detail-copy">{isMusic && <div className="music-preview"><button className="button secondary" disabled={playBusy} onClick={() => void playMusic()}><Play size={15} />{playBusy ? t("准备试听…", "Preparing…") : t("试听", "Listen")}</button><button className="button secondary" disabled={lyricBusy} onClick={() => void loadLyric()}><Music2 size={15} />{lyricBusy ? t("加载歌词…", "Loading…") : lyric === null ? t("歌词", "Lyrics") : t("收起歌词", "Hide lyrics")}</button>{playUrl && <audio controls autoPlay src={playUrl} />}{playError && <small className="music-panel-msg">{playError}</small>}{isCover && playUrl && <small className="music-panel-msg" style={{ color: "var(--warn)" }}>{t("未找到原版，仅提供翻唱试听", "Original not found — playing a cover version")}</small>}{lyricError && <small className="music-panel-msg">{lyricError}</small>}{lyric && <pre className="music-lyric">{lyric}</pre>}</div>}{detail.loading ? <p className="empty-state">{isMusic ? t("正在读取专辑信息…", "Loading album details…") : t("正在读取作品信息…", "Loading work details…")}</p> : detail.data ? <><div className="detail-meta"><span>{detail.work.creator ?? ""}</span><span>{detail.work.year ?? ""}</span><span>{String(detail.data.rating ?? "")}</span></div>{typeof detail.data.content_intro === "string" && detail.data.content_intro ? <div className="detail-synopsis"><h3>{t("简介", "Synopsis")}</h3><p>{detail.data.content_intro}</p>{typeof detail.data.content_source === "string" && <span className="detail-source">— {detail.data.content_source}</span>}</div> : <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>{t("暂无简介，数据来源暂未收录该作品。", "No synopsis available yet.")}</p>}<dl>{Object.entries(detail.data).filter(([key, value]) => value && !["title", "pic", "rating", "imgs", "content_intro", "content_source"].includes(key)).slice(0, 8).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd></div>)}</dl></> : <p className="empty-state">{t("暂时没有更多资料，仍可保留这件作品。", "No additional details were found.")}</p>}</div></div></section></div>;
}
