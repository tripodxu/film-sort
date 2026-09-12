export function ExpandableNote({ text, maxLength = 30, onView, style }: { text: string; maxLength?: number; onView?: (text: string) => void; style?: React.CSSProperties }) {
  const isLong = text.length > maxLength;
  return (
    <p onClick={(e) => { if (isLong && onView) { e.stopPropagation(); onView(text); } }} style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, lineHeight: 1.5, opacity: 0.85, whiteSpace: "pre-wrap", cursor: isLong ? "pointer" : undefined, ...style }}>
      📝 {isLong ? text.slice(0, maxLength) + "…" : text}
      {isLong && <span style={{ fontSize: 11, marginLeft: 4, textDecoration: "underline" }}>查看全文</span>}
    </p>
  );
}
