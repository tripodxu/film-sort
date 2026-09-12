const NOTES_KEY = "art-rank:notes";

export type NoteScope = "profile" | "ranking" | "work";

export function noteKey(scope: NoteScope, ...parts: string[]): string {
  return `${scope}:${parts.join(":")}`;
}

export function readNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}"); } catch { return {}; }
}

export function writeNotes(notes: Record<string, string>) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* quota */ }
}

export function setNote(notes: Record<string, string>, key: string, text: string): Record<string, string> {
  const next = { ...notes };
  if (text.trim()) next[key] = text.trim();
  else delete next[key];
  return next;
}

export function hasNote(notes: Record<string, string>, key: string): boolean {
  return !!notes[key]?.trim();
}
