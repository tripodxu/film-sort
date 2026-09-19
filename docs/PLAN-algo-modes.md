# 算法三模式计划：1v1 排序（简易/经典/精确）+ 比较（简易/经典/精确）

> **实施状态（2026-09-20）：已全部落地。** 测试 239→255 全绿；gate 出局后仍走 quick 极简复测（1 条）；undoLastAction 重放时透传 mode（否则重放按 classic 跑导致 gate 丢失——实施中发现并修复）。

> 参考 `E:\mimo\temp\5\2.txt`（守门员截断 / 主动学习 / 验证式测评）。核心原则：**经典模式 = 现行行为逐字不变**（默认），简易与精确是它的两个方向——简易砍比较次数，精确加深校准。不引入完整 TrueSkill（会重写整个状态机/撤销/草稿链路），精确模式的"主动学习"以**验证覆盖度 + 结论一致率**落地，这正是 2.txt 测评方案 1/3 的工程化。

---

## 1. 1v1 排序三模式（src/lib/ranking.ts）

### 1.1 模型改动

- `RankingState` 新增 `mode: "quick" | "classic" | "precise"`；`RankingOptions` 新增同名可选字段，缺省 `"classic"`。
- 兼容：`isRankingState` 对缺失 `mode` 的旧状态/旧草稿按 `classic` 接受（deserialize 时补齐字段），旧 localStorage 草稿零迁移。
- `ActiveInsertion` 新增 `stage: "gate" | "bisect"`（仅 quick 模式使用 gate 阶段；classic/precise 恒为 bisect）。

### 1.2 简易模式（quick，守门员截断）

对齐 2.txt "第 2-10 轮"：

- **未满员阶段**（rankedIds.length < topN）：与经典一致，二分插入定位（建基准榜）。
- **满员后**：每个候选先与**守门员**（当前末位 rankedIds[last]）比较：
  - 输 → 候选直接进 `outsideTopIds`，**1 次比较出局**，不插入；
  - 赢 → 转入 bisect 阶段，仅在 topN 范围内二分定位插入（原第 topN 名顺延出局）。
- 实现：`getCurrentComparison` 在 quick+gate 阶段把对手固定为末位；`choosePreferred` 在 gate 阶段判胜负后要么完成出局（候选入 outsideTop、scheduleNextCandidate）要么把 stage 升级为 bisect。
- 冷却：保留 WORK_COOLDOWN（避免连续面对同一作品）；PAIR 冷却在 gate 阶段天然由守门员机制替代，不强求。
- 撤销/略过/暂放/决策日志**完全复用**现有机制（gate 出局也是一条 choose 决策，重放一致）。
- 预估比较次数：`estimateTotalComparisons` quick 分支 ≈ `前 topN 建榜 log 成本 + (n-topN)×1.3`。

### 1.3 精确模式（precise，主动校准）

在经典全部机制之上：

- **验证加强**：验证数量 `max(4, ceil(topN/2))`（经典 `min(4, ceil(topN/3))`）；验证队列除相邻对外，把 TopK 内**从未直接比较过的相邻对**（pairEvidence 无记录）也入队——主动学习"信息增益最高优先"。
- **回环更严**：cycle 确认阈值从 `memberIds.length` 次一致升到 `2×`；tensionRounds 上限同步提高。
- **校准一致率**（新增状态字段 `calibration: { checked: number; consistent: number }`）：验证阶段每条复测与首次结论一致则 `consistent+1`；完成后 `consistent/checked` 即 2.txt 测评方案 1 的预测准确率，展示于完成画像页（"校准一致率 95%"）。
- **早停兜底**：验证队列全部完成且校准一致率 <60% 时，追加一轮相邻对复测（最多 topN 条），防止收敛错误。
- 预估比较次数：经典成本 × ~1.4。

### 1.4 进度与 UI

- `getRankingProgress` 按 mode 调整 estimatedTotal（quick 低、precise 高）。
- `SetupView`：TopN 下方新增「排序模式」segmented（简易/经典/精确），选中项写入 `art-rank:rank-mode` 并随 `startRanking` 传入；附一句话说明（简易≈每件 1 次取舍、经典=推荐、精确≈更多复测校准）。
- `SortingView`：evidence-status 行显示当前模式徽标；quick 模式满员后提示文案变为"赢过守门员即可上榜"。

## 2. 比较三模式（src/lib/profile.ts + CompareView）

### 2.1 算法实质改动

- `mergeDimensionRankings(rankings, strategy?: "best" | "median")`：多榜单同作品聚合，`best` = 现行取最高名次（乐观）；`median` = 取名次**中位数**（对异常榜单更稳健，2.txt "排名稳定性"思想）。缺省 `best` 保持兼容。
- 指标计算本身不按模式分叉（全是 O(n·m) 内的纯计算，全量算好，模式只控制展示），避免三套指标代码。

### 2.2 三档展示（CompareView）

- 新增 state `compareLevel: "simple" | "classic" | "precise"`（缺省 classic，localStorage 持久化），与既有 auto/manual 比较模式正交；segmented 控件放在比较模式行。
- **简易**：共识圆环 + 三主指标（重合度/顺序一致/Top3 共识）+ 判词；隐藏"更多指标"折叠区与共同作品来源标签。
- **经典**：现状不变。
- **精确**：经典全部 + 「更多指标」默认展开 + 新增两块：
  - **共识构成**：五因子分项得分条（顺序一致 30%·得分 X / 重合 20%·Y / 加权偏好 20%·Z / 名次距离 15% / 年代 15%），让综合分可解释；
  - **全量分歧明细**：disagreements 不再截断 top5，全部共同作品按名次差排序成表（限 50 行防长榜）。
- `compareProfiles`/`compareRankings` 签名不变；仅 CompareView 内部按 level 调 `mergeDimensionRankings` 的 strategy（precise → median）并控制渲染分支。

## 3. 测试

- `ranking.test.ts`（+~16）：quick 守门员出局不占位/赢后二分插入正确/满员判断、precise 验证数量与"未比较相邻对"入队、calibration 统计、旧状态无 mode 反序列化 → classic、进度预估按模式分叉。
- `profile.test.ts`（+~6）：median 聚合（奇偶长度、与 best 差异）、strategy 缺省 best 兼容。
- 现有 239 项全绿（classic 默认路径不动）。

## 4. 实施顺序

1. ranking.ts：mode 字段 + 兼容 + quick 状态机 + precise 验证/校准 + 进度预估；ranking.test.ts。
2. profile.ts：merge strategy；profile.test.ts。
3. UI：SetupView 模式选择、SortingView 徽标与文案、CompareView level segmented 与三档渲染、App/types/useSorting 传线。
4. 文档：FEATURES/README/OPTIMIZATION/本计划标注实施状态。

预估：核心 ~300 行 + 测试 ~250 行 + UI ~150 行。
