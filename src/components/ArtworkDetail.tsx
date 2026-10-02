import { useState } from "react";
import { Music2, Play, X } from "lucide-react";
import { Poster, rememberPickedCover } from "./Poster";
import { CoverChoice } from "./CoverChoice";
import { choiceAppliesToKind } from "../lib/coverChoice";
import { detailFields, splitDetailFields } from "../lib/detailFields";
import { FocusTrap } from "./FocusTrap";
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
  onCoverChange,
}: {
  detail: ArtworkDetailInfo;
  label: (kind: MediaKind) => string;
  t: (zh: string, en: string) => string;
  onClose: () => void;
  /**
   * 用户在「让用户选」里换封面后回调（PLAN-CHOICE-UI）。
   * 只有一个出口：App 收到后把 work.posterUrls 换成本次选择，
   * 于是**这个弹窗**的 `<Poster>` 立即生效（网络往返之前的第一枪）。
   *
   * 同一个弹窗之外的同名作品（榜单里、画廊里的其它卡片）由消歧记忆负责，
   * 见 ArtworkDetail 里的 rememberPickedCover 接线与 PLAN-COVER-MEMORY。
   */
  onCoverChange?: (url: string) => void;
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
    // 焦点与键盘：role="dialog" + aria-modal 只是给 AT 的一行**声明**，
    // 声明本身不产生行为——焦点仍留在打开它的那个按钮上、Tab 会走到弹窗背后去、
    // 读屏用户按 Esc 什么也不会发生。FocusTrap 把 Esc / Tab 循环 / 首焦点都实现了，
    // 这里只是**接上**（全站唯一漏接的模态，PLAN-DETAIL-DIALOG-A11Y §3.1）。
    <FocusTrap onEscape={onClose}>
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
              {choiceAppliesToKind(detail.kind) && onCoverChange && (
                <CoverChoice
                  title={detail.work.title}
                  english={detail.work.subtitle}
                  year={detail.work.year}
                  t={t}
                  onPicked={(url, wikiTitle) => {
                    // 先记事实，再走视觉：记忆是这一页所有同名作品的真相来源，
                    // 而 onPicked 只 patch 当前弹窗那一个 work 对象（PLAN-COVER-MEMORY）。
                    rememberPickedCover(detail.work, detail.kind, url, wikiTitle);
                    onCoverChange(url);
                  }}
                />
              )}
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
                  {playUrl && (
                    // 无障碍名称：裸 <audio> 对读屏用户只是一个「控件」，
                    // 播的是谁的歌、能不能听，全靠这一个 label 传达（PLAN-DETAIL-DIALOG-A11Y §3.4）。
                    <audio
                      controls
                      autoPlay
                      src={playUrl}
                      aria-label={t("歌曲试听", "Audio preview")}
                    />
                  )}
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
                  {(() => {
                    // 「后端返回了什么」不等于「界面该显示什么」：API 有内部键
                    // （id / matchedTitle）、有裸 URL（poster_url / detail_url）、
                    // 有长文本（author_intro 实测 389 字符）。detailFields 负责翻译，
                    // splitDetailFields 负责把长文本摘出来走块级排版
                    // （PLAN-DETAIL-DIALOG-A11Y §3.2 / §3.3）。
                    const { rows, blocks } = splitDetailFields(detailFields(detail.data, t));
                    return (
                      <>
                        <dl>
                          {rows.map((field) => (
                            <div key={field.key}>
                              <dt>{field.label}</dt>
                              <dd>{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {blocks.map((field) => (
                          <div className="detail-synopsis" key={field.key}>
                            <h3>{field.label}</h3>
                            <p>{field.value}</p>
                          </div>
                        ))}
                      </>
                    );
                  })()}
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
    </FocusTrap>
  );
}
