export function ExpandableNote({ text, maxLength = 30, onExpand, onView, style }: { text: string; maxLength?: number; onExpand?: () => void; onView?: (text: string) => void; style?: React.CSSProperties }) {
  const isLong = text.length > maxLength;
  const handleClick = () => {
    if (isLong && onExpand) onExpand();
    else if (isLong && onView) onView(text);
  };
  return (
    <p onClick={(e) => { if (isLong) { e.stopPropagation(); handleClick(); } }} style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, lineHeight: 1.5, opacity: 0.85, whiteSpace: "pre-wrap", cursor: isLong ? "pointer" : undefined, ...style }}>
      📝 {isLong ? text.slice(0, maxLength) + "…" : text}
      {isLong && <span style={{ fontSize: 11, marginLeft: 4, textDecoration: "underline" }}>{onExpand ? "查看全文" : "查看全文"}</span>}
    </p>
  );
}
