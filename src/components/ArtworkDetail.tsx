import { useState } from "react";
import { Music2, Play, X } from "lucide-react";
import { Poster } from "./Poster";
import { IconButton } from "../views/IconButton";
import {
  gdPlay,
  gdLyric,
  buildLyricLines,
  type GdErrorInfo,
  type LyricResult,
} from "../lib/gdMusic";
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
export function ArtworkDetail({
  detail,
  label,
  t,
  onClose,
}: {
  detail: ArtworkDetailInfo;
  label: (kind: MediaKind) => string;
  t: (zh: string, en: string) => string;
  onClose: () => void;
}) {
  const [playUrl, setPlayUrl] = useState("");
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [isCover, setIsCover] = useState(false);
  // 歌词连同译文一起存：译文是上游免费给的（外语歌才有），旧实现拿到却丢掉了。
  const [lyrics, setLyrics] = useState<LyricResult | null>(null);
  const [lyricBusy, setLyricBusy] = useState(false);
  const [lyricError, setLyricError] = useState("");
  const isMusic = detail.kind === "music";
  /**
   * 把失败原因说清楚。旧实现把它一律当作"没找到"：用户连点几首撞上 12 次/10 分钟的
   * 限流后，界面仍显示"未找到可试听的版本"，于是看起来就像功能坏了。
   */
  function musicErrorText(error: GdErrorInfo, notFound?: string): string {
    if (error.reason === "rate_limited") {
      const wait = error.retryAfter > 0 ? error.retryAfter : 60;
      const hint =
        wait >= 120
          ? t(`${Math.ceil(wait / 60)} 分钟`, `${Math.ceil(wait / 60)} min`)
          : t(`${wait} 秒`, `${wait}s`);
      return t(`操作太频繁了，请 ${hint}后再试`, `Too many requests — retry in ${hint}`);
    }
    if (error.reason === "upstream_limited")
      return t(
        "音乐服务暂时限流，请稍后再试",
        "Music service is rate-limited — please retry later",
      );
    if (error.reason === "not_found")
      return notFound ?? t("未找到可试听的版本", "No playable version found");
    return t("试听服务暂不可用", "Preview unavailable");
  }
  async function playMusic() {
    if (playUrl) return;
    setPlayBusy(true);
    setPlayError("");
    const title = detail.work.title;
    const artist = detail.work.creator;
    try {
      const result = await gdPlay(title, artist);
      if (result.ok) {
        setPlayUrl(result.value.playUrl);
        setIsCover(result.value.isCover);
      } else setPlayError(musicErrorText(result.error));
    } catch {
      setPlayError(t("试听服务暂不可用", "Preview unavailable"));
    } finally {
      setPlayBusy(false);
    }
  }
  async function loadLyric() {
    if (lyrics) {
      setLyrics(null);
      return;
    }
    setLyricBusy(true);
    setLyricError("");
    const title = detail.work.title;
    const artist = detail.work.creator;
    try {
      const result = await gdLyric(title, artist);
      if (result.ok && result.value.lyric) setLyrics(result.value);
      else if (!result.ok)
        setLyricError(musicErrorText(result.error, t("暂无歌词", "No lyrics available")));
      else setLyricError(t("暂无歌词", "No lyrics available"));
    } catch {
      setLyricError(t("歌词服务暂不可用", "Lyrics unavailable"));
    } finally {
      setLyricBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={onClose}>
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {label(detail.kind)} / {t("作品详情", "WORK DETAIL")}
            </span>
            <h2 id="detail-heading">{detail.work.title}</h2>
          </div>
          <IconButton title={t("关闭", "Close")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="detail-body">
          <Poster work={detail.work} kind={detail.kind} large />
          <div className="detail-copy">
            {isMusic && (
              <div className="music-preview">
                <button
                  className="button secondary"
                  disabled={playBusy}
                  onClick={() => void playMusic()}
                >
                  <Play size={15} />
                  {playBusy ? t("准备试听…", "Preparing…") : t("试听", "Listen")}
                </button>
                <button
                  className="button secondary"
                  disabled={lyricBusy}
                  onClick={() => void loadLyric()}
                >
                  <Music2 size={15} />
                  {lyricBusy
                    ? t("加载歌词…", "Loading…")
                    : lyrics === null
                      ? t("歌词", "Lyrics")
                      : t("收起歌词", "Hide lyrics")}
                </button>
                {playUrl && <audio controls autoPlay src={playUrl} />}
                {playError && <small className="music-panel-msg">{playError}</small>}
                {isCover && playUrl && (
                  <small className="music-panel-msg" style={{ color: "var(--warn)" }}>
                    {t(
                      "未找到原版，仅提供翻唱试听",
                      "Original not found — playing a cover version",
                    )}
                  </small>
                )}
                {lyricError && <small className="music-panel-msg">{lyricError}</small>}
                {lyrics && (
                  <div className="music-lyric">
                    {buildLyricLines(lyrics.lyric, lyrics.tlyric).map((line, index) => (
                      <p key={index} className="music-lyric-line">
                        {line.text ? <span>{line.text}</span> : null}
                        {line.translation ? (
                          <small className="music-lyric-translation">{line.translation}</small>
                        ) : null}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {detail.loading ? (
              <p className="empty-state">
                {isMusic
                  ? t("正在读取歌曲信息…", "Loading song details…")
                  : t("正在读取作品信息…", "Loading work details…")}
              </p>
            ) : detail.data ? (
              <>
                <div className="detail-meta">
                  <span>{detail.work.creator ?? ""}</span>
                  <span>{detail.work.year ?? ""}</span>
                  <span>{String(detail.data.rating ?? "")}</span>
                </div>
                {typeof detail.data.content_intro === "string" && detail.data.content_intro ? (
                  <div className="detail-synopsis">
                    <h3>{t("简介", "Synopsis")}</h3>
                    <p>{detail.data.content_intro}</p>
                    {typeof detail.data.content_source === "string" && (
                      <span className="detail-source">— {detail.data.content_source}</span>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
                    {t("暂无简介，数据来源暂未收录该作品。", "No synopsis available yet.")}
                  </p>
                )}
                <dl>
                  {Object.entries(detail.data)
                    .filter(
                      ([key, value]) =>
                        value &&
                        ![
                          "title",
                          "pic",
                          "rating",
                          "imgs",
                          "content_intro",
                          "content_source",
                        ].includes(key),
                    )
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd>
                      </div>
                    ))}
                </dl>
              </>
            ) : (
              <p className="empty-state">
                {t("暂时没有更多资料，仍可保留这件作品。", "No additional details were found.")}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
