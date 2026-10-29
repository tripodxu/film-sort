/**
 * D1 时间串统一解析。
 *
 * 库内时间格式是混合的（2026-10-30 验收发现）：plaza_posts 等表用
 * CURRENT_TIMESTAMP（"2026-09-19 16:58:23"，UTC 但无时区标记），而
 * plaza_post_edits 等表用 strftime('%Y-%m-%dT%H:%M:%fZ')（ISO 带 Z）。
 * `new Date("YYYY-MM-DD HH:MM:SS")` 会按**本地时区**解析前一种，
 * 在 UTC+8 下所有相对时间恰好漂移 8 小时（广场卡片显示「8 小时前」）。
 * 统一从这里解析：纯日期时间串补 UTC 标记，ISO 串原样交给 Date。
 */
export function parseDbTime(value: string): Date {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? new Date(value.replace(" ", "T") + "Z")
    : new Date(value);
}
