// 画像云同步的纯语义层（findings DATA-03/DATA-04）：
//  - 批注的「未提供」与「显式空」必须分开——否则用户清空批注后永远同步不到云端；
//  - 异步响应只有属于当前会话代际才允许落地——旧响应覆盖新会话是跨账户数据污染的入口。
import type { ArtisticProfile } from "./profile";

export interface ProfileSyncBody {
  profile: ArtisticProfile;
  notes?: Record<string, string>;
}

/**
 * 组装画像同步 PUT 请求体。
 * includeNotes=false：整个 notes 字段缺省，服务端语义 = 保留云端旧批注；
 * includeNotes=true：即使空对象也显式携带，服务端语义 = 整体替换（可清空）。
 */
export function buildProfileSyncBody(
  profile: ArtisticProfile,
  notes: Record<string, string>,
  includeNotes: boolean,
): ProfileSyncBody {
  return includeNotes ? { profile, notes } : { profile };
}

/** 会话代际校验：current 是当前代际，received 是发起请求时捕获的代际。 */
export function isCurrentGeneration(current: number, received: number): boolean {
  return current === received;
}
