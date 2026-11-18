import { GUIDE_DISMISSED_KEY } from "../../lib/storageKeys";
import { Modal } from "../Modal";

export interface GuideModalProps {
  t: (zh: string, en: string) => string;
  onClose: () => void;
  onOpenTech: () => void;
}

export function GuideModal({ t, onClose, onOpenTech }: GuideModalProps) {
  return (
    <Modal
      t={t}
      headingId="guide-heading"
      panelClassName="guide-modal account-dialog"
      onClose={onClose}
    >
      <span className="eyebrow">ART/RANK {t("使用说明", "GUIDE")}</span>
      <h2 id="guide-heading">{t("欢迎来到 ART/RANK", "Welcome to ART/RANK")}</h2>
      <p className="guide-subtitle">
        {t(
          "这里只讲怎么用：怎么选作品、怎么排、怎么导出与比较。想看算法怎么算，点底部「技术说明」。",
          "This is the how-to: picking works, sorting, exporting, comparing. For how the algorithms work, open Technical details at the bottom.",
        )}
      </p>
      <div className="guide-steps">
        <div className="guide-step">
          <span className="guide-step-num">1</span>
          <div className="guide-step-body">
            <strong>{t("选择媒介维度", "Choose a medium")}</strong>
            <p>
              {t(
                "电影、书籍、音乐或其他——每个维度可以创建多个独立榜单。",
                "Film, Books, Music, or Other — each medium can have multiple independent lists.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">2</span>
          <div className="guide-step-body">
            <strong>{t("选择作品来源", "Pick your works")}</strong>
            <p>
              {t(
                "精选榜单、即搜即加（输入标题搜出候选再点选）、批量导入（TXT / JSON / 粘贴清单）、豆瓣 Top 250；音乐还能扫码或 Cookie 连接网易云，按用户浏览全部歌单（含收藏）点选；也可以打开别人的分享链接直接取内容。",
                "Curated lists, instant search (type a title, pick a candidate), batch import (TXT / JSON / paste), or Douban Top 250. For music you can also connect NetEase by QR code or cookie and browse all of a user's playlists. You can also open someone's share link and take the works from it.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">3</span>
          <div className="guide-step-body">
            <strong>{t("选择排序模式", "Choose a sort mode")}</strong>
            <p>
              {t(
                "简易最快：每件只跟榜尾比一次，上百件里挖 Top N 的首选。经典是默认：二分定位加回环复测。精确会在经典之上加倍复测，完成后汇报校准一致率。自适应按信息量挑「最该问」的一对、实时给 90% 名次区间，超过 20 件建议换经典或简易。选择会被记住。",
                "Quick is fastest: each work meets only the last place — best for digging a Top N out of hundreds. Classic is the default: binary placement plus loop rechecks. Precise doubles the rechecks on top of classic and reports a calibration rate. Adaptive picks the most informative pair and shows live 90% rank ranges — switch to classic or quick above 20 works. Your choice is remembered.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">4</span>
          <div className="guide-step-body">
            <strong>{t("开始 1v1 取舍", "Sort, one pair at a time")}</strong>
            <p>
              {t(
                "点击你更想留下的那一件；键盘 A/D 或 ←/→；手机上左右滑动。可随时撤销、略过某件或暂放到队尾。进度自动存草稿，刷新后可继续。",
                "Tap the one you'd keep — keyboard A/D or ←/→, or swipe left/right on phones. Undo any time, skip a work, or park it at the back of the queue. Progress is draft-saved automatically and can be resumed after a refresh.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">5</span>
          <div className="guide-step-body">
            <strong>{t("查看与导出文化索引", "View and export your index")}</strong>
            <p>
              {t(
                "排序完成会自动保存到「我的文化索引」，每件作品都可加批注。导出支持 JSON / TXT / Markdown / CSV / PNG（五套版式，另有年度年鉴卡），PNG 配色跟随当前主题。",
                "Results save to My Index automatically, and every work can carry a note. Export as JSON / TXT / Markdown / CSV / PNG (five layouts plus a yearly report card); PNG colours follow the active theme.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">6</span>
          <div className="guide-step-body">
            <strong>{t("与他人比较", "Share and compare")}</strong>
            <p>
              {t(
                "「比较链接」让对方直接进比较界面，「分享链接」让对方先看内容再决定；都走 12 位短码，可扫码。相遇页看综合共识分，深度页是只读的第二读法，含似然一致度等新指标。",
                "A compare link drops them straight into the comparison; a share link lets them read your list first. Both use a 12-character code and can be scanned as a QR code. The encounter page shows the consensus score; the depth page is a read-only second reading with extra metrics such as likelihood agreement.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">7</span>
          <div className="guide-step-body">
            <strong>{t("（可选）AI 点评与 AI 快排", "(Optional) AI notes and quick rank")}</strong>
            <p>
              {t(
                "设置 → AI 服务：AI 点评默认走服务端内置模型，也可填自己的 Base URL / API Key / Model。Jev 快排不用配置也能用——未填 TypeSafe Key 时自动走站内免费通道；填入自己的 Key 则优先用你的（准备页出现「AI 快排」——一次预测直接成榜，跳过逐对比较，最多 255 件）。",
                "Settings → AI services. AI notes use a built-in model by default; you can plug in your own Base URL / API key / model instead. Quick rank works out of the box: with no TypeSafe key it uses the built-in free channel; your own key takes priority once added (a Quick rank button appears on the setup page: one prediction produces the whole list, skipping pairwise sorting, up to 255 works).",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">8</span>
          <div className="guide-step-body">
            <strong>{t("（可选）Jev 代判", "(Optional) Jev decides")}</strong>
            <p>
              {t(
                "同样在「AI 服务」里打开「Jev 代判」并选置信阈值（默认 80%，50–90% 五档）：达到阈值的那一对自动落位，标注「上一对由 Jev 代判 · 置信 N%」，随时可撤销；没达标的仍交给你自己。调低更省事，调高更保守。代判同样支持站内免费通道，不配 Key 也能用。",
                "Still in AI services, switch on Jev decides and pick a confidence threshold (80% by default, five steps from 50% to 90%): a pair that clears it is settled automatically and labelled 'Last pair decided by Jev · N% confidence', undoable at any time. Anything below the bar stays yours. Lower means less work, higher means more caution. Assist also works on the built-in free channel, no key needed.",
              )}
            </p>
          </div>
        </div>
        <div className="guide-step">
          <span className="guide-step-num">9</span>
          <div className="guide-step-body">
            <strong>{t("（可选）登录同步", "(Optional) Sign in to sync")}</strong>
            <p>
              {t(
                "邮箱注册，或用 Google / GitHub 登录后，画像、批注与云端清单自动同步；游客数据在登录时可选择增量合并到云端，或改用云端数据。",
                "Sign up with email, or sign in with Google / GitHub, and profiles, notes and cloud lists sync automatically. Guest data can be merged into the cloud or replaced by it at sign-in.",
              )}
            </p>
          </div>
        </div>
      </div>
      <div className="guide-modal-footer">
        <button
          className="button secondary"
          onClick={() => {
            onClose();
            onOpenTech();
          }}
        >
          {t("技术说明", "Technical details")}
        </button>
        <div className="u-spacer" />
        <button
          className="button quiet"
          onClick={() => {
            try {
              localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
            } catch {}
            onClose();
          }}
        >
          {t("不再显示", "Don't show again")}
        </button>
        <button className="button primary" onClick={onClose}>
          {t("知道了", "Got it")}
        </button>
      </div>
    </Modal>
  );
}
