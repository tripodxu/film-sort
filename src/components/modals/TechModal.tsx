import { Modal } from "../Modal";

export interface TechModalProps {
  t: (zh: string, en: string) => string;
  onClose: () => void;
}

export function TechModal({ t, onClose }: TechModalProps) {
  return (
    <Modal
      t={t}
      headingId="tech-heading"
      panelClassName="tech-modal account-dialog"
      onClose={onClose}
    >
      <span className="eyebrow">ART/RANK TECHNICAL</span>
      <h2 id="tech-heading">{t("技术说明", "Technical Details")}</h2>
      <p className="guide-subtitle">
        {t(
          "算法怎么算、数据存在哪。想知道按钮在哪、功能怎么用，回到「使用说明」。",
          "How the algorithms work and where data lives. For where the buttons are and how features work, go back to the guide.",
        )}
      </p>
      <div className="tech-sections">
        <details open>
          <summary>{t("排序模式", "Sort Modes")}</summary>
          <div className="tech-body">
            <p>
              {t(
                "四种模式共用同一套取舍记录，区别在于「问哪些对」和「怎么定名次」。准备页四选一，选择会被记住。",
                "All four modes share one record of choices; they differ in which pairs get asked and how ranks are settled. Pick one on the setup page — the choice is remembered.",
              )}
            </p>
            <p>
              <strong>{t("简易（quick）", "Quick")}</strong>：
              {t(
                "每件新作品只与榜单末位比一次：赢了上榜、输了出局。线性步数，没有验证阶段；适合从上百件里快速挖 Top N，代价是名次精度较低。",
                "Each new work meets the last place once: win and it enters, lose and it is out. Linear steps with no verification phase — good for digging a Top N out of hundreds, at the cost of precision.",
              )}
            </p>
            <p>
              <strong>{t("经典（classic，默认）", "Classic (default)")}</strong>：
              {t(
                "主动式二分插入：取出候选，与已排序区间的中位数比较并缩小范围，直到定位精确插入位置。n 件取 Top N 时每个候选最多 ⌈log₂(N+1)⌉ 次比较，整体 O(n log n)。",
                "Active binary insertion: compare the candidate against the median of the sorted range and halve the range until the exact slot is found. For a Top N out of n works each candidate costs at most ⌈log₂(N+1)⌉ comparisons — O(n log n) overall.",
              )}
            </p>
            <p>
              <strong>{t("精确（precise）", "Precise")}</strong>：
              {t(
                "在经典之上加倍复测，并主动补验从未直接比较过的相邻对；结束时汇报「校准一致率」，说明复测与首次判断的吻合程度。",
                "Classic plus doubled rechecks, and it probes adjacent pairs that were never compared head-to-head. It ends with a calibration rate showing how often rechecks agreed with first answers.",
              )}
            </p>
            <p>
              <strong>{t("自适应（adaptive）", "Adaptive")}</strong>：
              {t(
                "用 Bradley-Terry 能力模型估计每件作品的强度与不确定度，按信息量 p(1−p)(σᵢ²+σⱼ²) 加覆盖率补偿来挑「最该问」的一对，实时显示双方 90% 名次区间，预算约 4× 作品数。排序中的复测结论会回流模型，最终榜单按完整模型重建（2026-10-24）。",
                "A Bradley-Terry strength model tracks each work's score and uncertainty. Pairs are chosen by information p(1−p)(σᵢ²+σⱼ²) plus a coverage bonus, live 90% rank ranges are shown, and the budget is roughly 4× the number of works. Rechecks feed back into the model and the final ranking is rebuilt from the full model (2026-10-24).",
              )}
            </p>
          </div>
        </details>
        <details>
          <summary>{t("共识机制", "Shared Mechanics")}</summary>
          <div className="tech-body">
            <p>
              <strong>{t("冷却", "Cooldown")}</strong>：
              {t(
                "同一对作品至少间隔 3 次比较，同一作品至少间隔 4 次比较，防止顺序偏差和比较疲劳。",
                "Same pair at least 3 comparisons apart, same work at least 4 apart — prevents order bias and comparison fatigue.",
              )}
            </p>
            <p>
              <strong>{t("偏好回环检测", "Preference Loop Detection")}</strong>：
              {t(
                "检测到 A→B→C→A 的偏好循环时会安排复测。首次标记「观察中」，多次方向一致后标记「持久张力」——尊重真实的品味矛盾，而非强行纠正。",
                "When an A→B→C→A preference loop shows up, rechecks are scheduled. It starts as 'observed' and becomes 'persistent tension' if it keeps confirming — genuine taste contradictions are respected rather than overridden.",
              )}
            </p>
            <p>
              <strong>{t("验证阶段", "Verification Phase")}</strong>：
              {t(
                "经典与精确模式在主排序完成后复测少量相邻作品对和循环边，数量约为 Top N 的 1/3；简易模式没有这一阶段。",
                "In classic and precise, a few adjacent pairs and loop edges are rechecked after the main pass — about Top N / 3. Quick mode skips it.",
              )}
            </p>
            <p>
              <strong>{t("撤销", "Undo")}</strong>：
              {t(
                "重放决策日志（去掉最后一条）重建状态，保证撤销后的一致性。",
                "State is rebuilt by replaying the decision log minus the last entry, keeping undo consistent.",
              )}
            </p>
          </div>
        </details>
        <details>
          <summary>{t("比较算法", "Comparison Algorithm")}</summary>
          <div className="tech-body">
            <p>
              <strong>{t("合并", "Merging")}</strong>：
              {t(
                "同维度的多个榜单先合并：同一作品出现在多个榜单中时取最高名次。匹配依据是标题 + 年份 + 创作者的规范化比较。",
                "Multiple lists of the same medium are merged first: a work appearing in several lists takes its best rank. Matching compares normalized title + year + creator.",
              )}
            </p>
            <p>
              <strong>{t("贪心匹配", "Greedy Matching")}</strong>：
              {t(
                "为所有候选对算匹配评分（70–90 分），按评分降序、名次差升序排列，再贪心挑选互不冲突的最优配对。",
                "Every candidate pair gets a match score (70–90); pairs are sorted by score descending then rank gap ascending, and non-conflicting matches are taken greedily.",
              )}
            </p>
            <p>
              <strong>{t("相遇页 13 项指标", "13 metrics on the encounter page")}</strong>：
              {t(
                "重合类——作品重合度（交集 / 并集）、前五重合、Top 3 共识、Top-5 Jaccard、冠军一致；顺序类——顺序一致率、Kendall τ-b、Spearman 近似、名次距离、加权偏好一致（1/rank 加权）；画像类——年代偏好、覆盖率、收缩共识分。",
                "Overlap: work overlap (intersection / union), top-5 overlap, top-3 consensus, Top-5 Jaccard, same champion. Order: order agreement, Kendall τ-b, Spearman approximation, rank distance, weighted agreement (weighted by 1/rank). Profile: era affinity, coverage, shrunk consensus.",
              )}
            </p>
            <p>
              <strong>{t("深度页的五格第二读法", "Second reading on the depth page")}</strong>：
              {t(
                "只读、不写入任何数据：头部加权 τ（1/i 权重）、位置折扣一致度（每往后一位乘 0.85）、τ 的 bootstrap 区间（200 轮 · 90% 水平）、序对账本（可用序对 / 全部序对，含被剔除的并列），以及品味似然一致度（Plackett-Luce 双向似然，完全一致恒为 100，且计入「错得有多远」，2026-10-24 新增）。",
                "Read-only, writes nothing: head-weighted τ (1/i weights), position-discounted agreement (×0.85 per place), a bootstrap interval for τ (200 rounds at 90%), a pair ledger (usable / total pairs, ties excluded), and likelihood agreement (two-way Plackett-Luce likelihood — exactly 100 when identical, and it accounts for how far a work is misplaced; added 2026-10-24).",
              )}
            </p>
          </div>
        </details>
        <details>
          <summary>{t("AI 能力", "AI Capabilities")}</summary>
          <div className="tech-body">
            <p>
              {t(
                "三条独立通道，互不影响：AI 点评（文字解读）、AI 快排（一次成榜）、Jev 代判（逐对替你选择）。点评走「AI 服务」里配置的通用模型；快排与代判共用同一把 TypeSafe Key——没配 Key 时走站主提供的免费通道（Worker Secret 保管，浏览器看不到），配置了就用你自己的。",
                "Three independent channels: AI notes (text), quick rank (one-shot ranking), and Jev decides (pair by pair). Notes use the general model configured in AI services; quick rank and Jev share one TypeSafe key — with no key configured they ride the owner-provided free channel (held as a Worker secret, never visible to the browser), and your own key takes priority once set.",
              )}
            </p>
            <p>
              <strong>{t("AI 点评", "AI notes")}</strong>：
              {t(
                "三个场景——榜单（截取前 150 件）、画像（跨维度汇总）、单件作品。默认走服务端内置模型，无需配置；填入自己的 Base URL、API Key 与 Model 后改走你的服务，Key 只存在本浏览器。",
                "Three scenarios — a list (first 150 works), a profile (across media), and a single work. A built-in server-side model works out of the box; entering your own Base URL, API key and model routes it to your provider, with the key kept only in this browser.",
              )}
            </p>
            <p>
              <strong>{t("AI 快排", "Quick rank")}</strong>：
              {t(
                "把整份清单一次交给模型预测名次，直接成榜，跳过所有 1v1 取舍（单次最多 255 件）。结果仍可在画像页手动微调。",
                "The whole list goes to the model in one prediction and becomes a ranked list directly, skipping every 1v1 (up to 255 works per call). You can still fine-tune it on the profile page.",
              )}
            </p>
            <p>
              <strong>{t("Jev 代判", "Jev decides")}</strong>：
              {t(
                "在每次取舍前预测你更可能选哪一件：置信度达到阈值才落位，并标注「上一对由 Jev 代判 · 置信 N%」、可撤销；低于阈值则不插手，仍由你判断。阈值默认 80%，可在 50–90% 五档调整——调低代判更频繁，调高更保守。",
                "Before each choice Jev predicts which work you'd keep. If confidence clears the threshold the pair is settled and labelled 'Last pair decided by Jev · N% confidence', undoable at any time; below it Jev stays out and the pair is yours. The default is 80%, adjustable in five steps from 50% to 90% — lower takes over more often, higher is more cautious.",
              )}
            </p>
            <p>
              <strong>{t("工程约束", "Engineering guardrails")}</strong>：
              {t(
                "Key 只存 localStorage，不经 Worker 落盘；代判请求带键控与代际守卫——换了一对、或你已手动选择时，迟到的响应一律丢弃，绝不复写你的决定。失败按限流、地区受限、key 无效分别提示，不静默吞掉。",
                "Keys live only in localStorage and are never persisted by the Worker. Assist requests are keyed and generation-guarded: if the pair changed or you already chose, late responses are dropped rather than overwriting your decision. Failures are surfaced by kind — rate limit, regional restriction, invalid key — instead of being swallowed.",
              )}
            </p>
          </div>
        </details>
        <details>
          <summary>{t("海报与详情 API", "Poster & Detail API")}</summary>
          <div className="tech-body">
            <p>
              <strong>{t("海报解析策略（按优先级）", "Poster resolution (by priority)")}</strong>：
            </p>
            <ul>
              <li>
                <strong>{t("电影", "Film")}</strong>：
                {t(
                  "豆瓣 suggest API → search.douban.com 搜索 → Top250 索引 → IMDb 备用",
                  "Douban suggest API → search.douban.com → Top250 index → IMDb fallback",
                )}
              </li>
              <li>
                <strong>{t("书籍", "Book")}</strong>：
                {t(
                  "豆瓣 suggest API（pic 字段）→ search.douban.com 搜索 → Top250 索引",
                  "Douban suggest API (pic field) → search.douban.com → Top250 index",
                )}
              </li>
              <li>
                <strong>{t("音乐", "Music")}</strong>：
                {t(
                  "网易云 CDN 封面直出优先 → search.douban.com 搜索 → Top250 索引（无 suggest API）",
                  "NetEase CDN cover first → search.douban.com → Top250 index (no suggest API)",
                )}
              </li>
            </ul>
            <p>
              {t(
                "以上都没命中时，所有类别统一按「维基百科 → 网易云 / gd-proxy」逐级兜底。",
                "When none of the above hit, every medium falls back through Wikipedia → NetEase / gd-proxy.",
              )}
            </p>
            <p>
              <strong>{t("识别纠错", "Disambiguation")}</strong>：
              {t(
                "标题重名或结果不确定时，详情弹窗会列出候选让你选一次，并记住「这个名字指哪部作品」，之后不再重复问；实在找不到封面时给出占位与重试出路，而不是一直转圈。",
                "When a title is ambiguous or the match is uncertain, the detail dialog offers candidates and remembers which work that name refers to, so you are not asked again. If no poster can be found it shows a placeholder with a retry path instead of spinning forever.",
              )}
            </p>
            <p>
              {t(
                "豆瓣返回的 URL 会展开成多个 CDN 镜像变体（img1/2/3/9.doubanio.com）并做 https 升级，前端按顺序尝试加载。",
                "A Douban URL expands into several CDN mirror variants (img1/2/3/9.doubanio.com) with https upgrade; the frontend tries them in order.",
              )}
            </p>
            <p>
              <strong>{t("详情获取策略", "Detail fetching")}</strong>：
              {t(
                "优先从 Wikipedia（中英文）获取简介，辅以类型限定词减少歧义；然后尝试创作者组合搜索；最后用百度百科兜底。元数据（评分、导演、出版社等）从豆瓣搜索结果解析。",
                "Prioritizes Wikipedia (zh/en) for content intros with type disambiguation; then creator+title combo search; Baidu Baike as fallback. Metadata (ratings, director, publisher) parsed from Douban search results.",
              )}
            </p>
            <p>
              <strong>{t("防限流机制", "Rate Limit Protection")}</strong>：
              {t(
                "4 个 Edge UA 轮换；同域名请求按域名串行并保持最小间隔（默认 800ms，search.douban.com 放宽到 200ms）；图片请求不参与节流；403/418 重试 2 次并递增冷却 5s→10s→15s。",
                "4 Edge UAs rotated; per-domain serialized requests with a minimum gap (800ms default, 200ms for search.douban.com); image requests skip throttling; 2 retries on 403/418 with escalating cooldown 5s→10s→15s.",
              )}
            </p>
          </div>
        </details>
        <details>
          <summary>{t("数据存储", "Data Storage")}</summary>
          <div className="tech-body">
            <p>
              <strong>{t("游客模式", "Guest mode")}</strong>：
              {t(
                "所有数据存储在浏览器 localStorage，不离开设备。",
                "All data in browser localStorage, never leaves the device.",
              )}
            </p>
            <p>
              <strong>{t("登录用户", "Signed-in users")}</strong>：
              {t(
                "画像和云端清单存储在 Cloudflare D1（SQLite），Token 有效期 30 天。画像变更自动防抖同步，切到后台或关闭页面时使用 keepalive 确保最后保存。",
                "Profiles and cloud lists stored in Cloudflare D1 (SQLite), 30-day token. Profile changes auto-debounced, with keepalive sync on page hide/close.",
              )}
            </p>
            <p>
              <strong>{t("分享链接", "Share links")}</strong>：
              {t(
                "统一走服务端 12 位短码（需要 D1）。旧版把画像压缩后内联在 URL 里的链接仍可打开，由前端 fflate 解压读取。",
                "Served as a 12-character server-side code (requires D1). Older links that inline a compressed profile in the URL still open, decoded client-side with fflate.",
              )}
            </p>
            <p>
              <strong>{t("离线与缓存", "Offline & cache")}</strong>：
              {t(
                "构建产物由 Service Worker 预缓存，装到桌面或主屏幕后断网也能打开访问过的页面；海报与简介另有一层服务端缓存，可在顶栏齿轮里按类型手动清除。",
                "Build assets are precached by a Service Worker, so an installed copy can open visited pages while offline. Posters and intros sit behind a separate server-side cache that can be cleared by type from the gear menu.",
              )}
            </p>
          </div>
        </details>
      </div>
      <div className="guide-modal-footer">
        <a
          className="button secondary"
          href="https://github.com/tripodxu/film-sort"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "none" }}
        >
          GitHub
        </a>
        <div className="u-spacer" />
        <button className="button primary" onClick={onClose}>
          {t("关闭", "Close")}
        </button>
      </div>
    </Modal>
  );
}
