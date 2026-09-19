import { parseProfile, MAX_PROFILE_BYTES } from "./profile";

export type Locale = "zh" | "en";

export function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function track(event: string, payload: Record<string, string | number>) {
  try {
    const id = stored("art-rank:session:v1") ?? crypto.randomUUID();
    localStorage.setItem("art-rank:session:v1", id);
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_name: event, session_id: id, payload }),
    }).catch(() => undefined);
  } catch {
    /* Local privacy settings must not interrupt sorting. */
  }
}

export async function decode(payload: string) {
  const { decompressSync, strFromU8 } = await import("fflate");
  if (payload.length > 100000) throw new Error("Link too large");
  const binary = atob(
    payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4),
  );
  const data = decompressSync(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    { out: new Uint8Array(MAX_PROFILE_BYTES + 1) },
  );
  if (data.length > MAX_PROFILE_BYTES) throw new Error("Profile too large");
  return parseProfile(JSON.parse(strFromU8(data)));
}

export function saveFile(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
