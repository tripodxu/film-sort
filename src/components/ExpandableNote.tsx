import { useState } from "react";

export function ExpandableNote({ text, maxLength = 100, style }: { text: string; maxLength?: number; style?: React.CSSProperties }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxLength;
  const show = !isLong || expanded;
  return (
    <p style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, lineHeight: 1.5, opacity: 0.85, whiteSpace: "pre-wrap", ...style }}>
      📝 {show ? text : text.slice(0, maxLength) + "…"}
      {isLong && <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, marginLeft: 4, textDecoration: "underline" }}>{expanded ? "收起" : "展开"}</button>}
    </p>
  );
}
