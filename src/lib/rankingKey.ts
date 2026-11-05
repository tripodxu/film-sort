/**
 * 榜单行的稳定渲染键。
 *
 * 列表来自用户导入，可增删可换序。用数组下标当 key 时，换画像 / 删榜单
 * 会让同一个 key 指向另一份内容，React 复用旧 DOM，勾选态、展开态与焦点
 * 可能串到别的行。键里带上内容身份，保证「同一 key 永远对应同一份榜单」；
 * 末尾下标只用于同维度 + 同标题的重复项去重。
 */
import type { RankingExport } from "./profile";

export function rankingRowKey(
  entry: Pick<RankingExport, "kind" | "collectionTitle">,
  index: number,
): string {
  return `${entry.kind}|${entry.collectionTitle}#${index}`;
}
