import { useEffect, useRef, useState } from "react";
import { ArrowRight, Pause, SkipForward, Sparkles, Undo2 } from "lucide-react";
import { Poster } from "../components/Poster";
import { IconButton } from "./IconButton";
import { decideSwipe } from "../lib/swipe";
import { track } from "../lib/utils";
import { readJevAssistEnabled, readTypesafeConfig, requestJevPick } from "../lib/typesafe";
import { useThemeFamily } from "../lib/useTheme";
import type { SortingViewProps } from "./types";

/** AI 代判的置信阈值:Jev 概率是校准过的,低于此值说明这对接近 toss-up,交给用户。 */
const ASSIST_CONFIDENCE_THRESHOLD = 0.8;

export function SortingView({
  collection,
  ranking,
  comparison,
  progress,
  label,
  kind,
  t,
  locale,
  tasteContext,
  worksById,
  act,
}: SortingViewProps) {
  // ===== 触屏滑动选择:往哪边甩就选哪边(与键盘 ←/A = 左同语义) =====
  // 仅触摸/笔启用——鼠标拖拽会与正文文字选择冲突,且桌面已有点击+键盘。
  // 拖动中的跟随位移直接写 transform(ref),不进 React state。
  // L3（PLAN-ui-modernization）：刊物家族才渲染「第 N 回合」水印。
  const isEditorial = useThemeFamily() === "editorial";
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ===== Jev 辅助模式(AI 代判,默认关)=====
  // 每对作品先请求预测:置信 ≥ 0.8 自动落位(进决策日志,可撤销),低于阈值
  // 或复测阶段交给用户——复测本来就是引擎挑出的接近 toss-up 的对。
  // 键控防竞态:assistKeyRef 记录已处理的对,响应到达时若键已变(用户手动
  // 操作过)则丢弃——绝不覆盖用户的真实选择。
  const [assistMarker, setAssistMarker] = useState<string | null>(null);
  const assistKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${comparison.leftId}|${comparison.rightId}|${comparison.phase}`;
    if (assistKeyRef.current === key) return;
    if (comparison.phase === "verification") {
      setAssistMarker(null);
      return;
    }
    if (!readJevAssistEnabled()) return;
    const config = readTypesafeConfig();
    if (!config) return;
    const left = worksById.get(comparison.leftId);
    const right = worksById.get(comparison.rightId);
    if (!left || !right) return;
    assistKeyRef.current = key;
    let stale = false;
    void (async () => {
      const result = await requestJevPick(
        {
          kind,
          left: {
            title: left.title,
            ...(left.creator ? { creator: left.creator } : {}),
            ...(left.year ? { year: left.year } : {}),
          },
          right: {
            title: right.title,
            ...(right.creator ? { creator: right.creator } : {}),
            ...(right.year ? { year: right.year } : {}),
          },
          ...(tasteContext ? { profileContext: tasteContext } : {}),
          locale,
        },
        config,
      );
      if (stale || assistKeyRef.current !== key) return; // 用户已手动操作
      if (!result.ok || result.confidence < ASSIST_CONFIDENCE_THRESHOLD) return; // 静默交还用户
      const confidencePct = Math.round(result.confidence * 100);
      setAssistMarker(
        t(
          `上一对由 Jev 代判 · 置信 ${confidencePct}%`,
          `Last pair decided by Jev · ${confidencePct}% confidence`,
        ),
      );
      track("jev_assist_pick", {
        mode: kind,
        confidence: result.confidence,
        pick: result.pick,
        input_tokens: result.inputTokens,
      });
      act(result.pick);
    })();
    return () => {
      stale = true;
    };
  }, [
    comparison.leftId,
    comparison.rightId,
    comparison.phase,
    kind,
    locale,
    tasteContext,
    t,
    worksById,
    act,
  ]);

  /** 手动提交:清除 AI 代判标注(键盘路径不清除——「上一对」本就是历史语义)。 */
  function commitManually(side: "left" | "right") {
    setAssistMarker(null);
    act(side);
  }

  function onSwipeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse") return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  }

  function onSwipeMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
    if (!drag.active) {
      drag.active = true;
      // 指针可能已被系统接管(如浏览器手势),捕获失败不影响判定链路
      try {
        event.currentTarget.setPointerCapture(drag.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!reducedMotion) {
      const nudge = Math.max(-24, Math.min(24, dx * 0.12));
      event.currentTarget.style.transition = "none";
      event.currentTarget.style.transform = `translateX(${nudge}px)`;
    }
  }

  function onSwipeEnd(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = null;
    event.currentTarget.style.transform = "";
    event.currentTarget.style.transition = "";
    const decision = decideSwipe(dx, dy);
    if (decision) {
      navigator.vibrate?.(10);
      act(decision);
    }
  }

  return (
    <>
      <div className="duel-heading">
        <div>
          <span className="eyebrow">
            {label(kind)} / {t("相遇", "ENCOUNTER")} TOP {ranking.topN}
            {ranking.mode === "quick" && t(" · 简易", " · Quick")}
            {ranking.mode === "precise" && t(" · 精确", " · Precise")}
          </span>
          <h1>{collection.title}</h1>
        </div>
        <div className="comparison-count">
          <strong>{progress.comparisonCount}</strong>
          <span>{t("次取舍", "choices")}</span>
        </div>
      </div>
      <div
        className={`evidence-status ${ranking.cycleStatus !== "none" ? `cycle-${ranking.cycleStatus}` : ""}`}
      >
        <span>
          {progress.phase === "verification"
            ? t("校准中", "Calibrating")
            : t("偏好采样中", "Preference sampling")}
        </span>
        <small>
          {progress.phase === "verification"
            ? t(
                `正在复测 ${progress.verificationRemaining} 组相近取舍，让结果更贴近你的直觉。`,
                `Rechecking ${progress.verificationRemaining} close calls for a truer result.`,
              )
            : ranking.mode === "quick" && ranking.rankedIds.length >= ranking.topN
              ? t(
                  "守门员模式：新作品赢过榜单末位即可上榜，否则直接出局。",
                  "Gatekeeper mode: a work enters only by beating the last spot, otherwise it's out.",
                )
              : t(
                  "相同组合会留出间隔；完成前会进行少量复测。",
                  "Pairs are spaced apart, then a few close calls are rechecked.",
                )}
        </small>
        {ranking.cycleStatus === "observed" && (
          <em>
            {t(
              "发现一个偏好回环，已安排复测。",
              "A preference loop was found and queued for review.",
            )}
          </em>
        )}
        {ranking.cycleStatus === "persistent" && (
          <em>
            {t(
              "这个偏好回环多次一致出现，保留它作为你的真实张力。",
              "This preference loop repeated consistently. It is part of your taste, not an error.",
            )}
          </em>
        )}
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={t("排序进度", "Ranking progress")}
        aria-valuenow={Math.round(progress.fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress.fraction * 100}%` }} />
      </div>
      <div className="progress-meta">
        <span>
          {progress.phase === "verification"
            ? t("复测阶段", "Verification")
            : `${progress.processed} / ${progress.total}`}
        </span>
        <span>
          {t("预计剩余", "Estimated remaining")} {progress.estimatedRemaining}
        </span>
      </div>
      {assistMarker && (
        <p className="assist-marker" role="status">
          <Sparkles size={12} />
          {assistMarker}
        </p>
      )}
      {/* L3（PLAN-ui-modernization）：刊物家族注入「第 N 回合」衬线水印；
          classic 路径不渲染，DOM 与之前一致。样式在 styles.css 的 .ed-round-mark。 */}
      {isEditorial && (
        <div className="ed-round-mark" aria-hidden="true">
          {t(
            `第 ${String(progress.processed + 1).padStart(2, "0")} 回合`,
            `ROUND ${String(progress.processed + 1).padStart(2, "0")}`,
          )}
        </div>
      )}
      <div
        className="duel-grid"
        role="group"
        aria-label={t("选择更偏好的作品", "Choose the work you prefer")}
        onPointerDown={onSwipeStart}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
      >
        {(["left", "right"] as const).map((side, index) => {
          const workId = side === "left" ? comparison.leftId : comparison.rightId;
          const work = worksById.get(workId)!;
          return (
            <div key={side} className="artwork-card">
              <button
                className="artwork-main"
                onClick={() => commitManually(side)}
                aria-label={`${t("选择", "Choose")} ${work.title}`}
              >
                <div className="artwork-top">
                  <span>0{index + 1}</span>
                  <span>
                    {comparison.phase === "verification" ? t("复测", "RECHECK") : label(kind)}
                  </span>
                </div>
                <Poster key={work.id} work={work} kind={kind} large />
                <div className="artwork-info" onClick={(event) => event.stopPropagation()}>
                  <h2>{work.title}</h2>
                  <p>
                    {work.creator || work.subtitle || label(kind)} {work.year}
                  </p>
                </div>
                <ArrowRight className="choose-arrow" size={19} />
              </button>
              <div className="artwork-card-tools">
                <IconButton
                  title={`${t("略过", "Skip")} ${work.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    act(side === "left" ? "skip-left" : "skip-right");
                  }}
                >
                  <SkipForward size={15} />
                </IconButton>
                <IconButton
                  title={`${t("暂放", "Defer")} ${work.title}`}
                  disabled={
                    comparison.phase === "verification"
                      ? ranking.verificationQueue.length === 0
                      : ranking.pendingIds.length + ranking.deferredIds.length === 0
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    act(side === "left" ? "defer-left" : "defer-right");
                  }}
                >
                  <Pause size={15} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
      <div className="duel-tools">
        <IconButton
          title={t("撤销", "Undo")}
          disabled={!ranking.decisionLog.length}
          onClick={() => act("undo")}
        >
          <Undo2 size={19} />
        </IconButton>
        <span className="keyboard-hint">
          <span className="kb-only">
            {t("点击卡片选择", "Click a card")} <kbd>A</kbd>/<kbd>D</kbd> <kbd>←</kbd>/<kbd>→</kbd>{" "}
            <kbd>1</kbd>/<kbd>2</kbd>
          </span>
          <span className="touch-hint">{t("左右滑动选择", "Swipe to choose")}</span>
        </span>
      </div>
    </>
  );
}
