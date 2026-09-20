export function ExpandableNote({
  text,
  maxLength = 30,
  onView,
  style,
}: {
  text: string;
  maxLength?: number;
  onView?: (text: string) => void;
  style?: React.CSSProperties;
}) {
  const isLong = text.length > maxLength;
  // 键盘可达（UI_REVIEW 2.6）：可展开时作为按钮语义，Enter/Space 触发查看全文。
  const interactive = isLong && onView;
  return (
    <p
      onClick={(e) => {
        if (interactive) {
          e.stopPropagation();
          onView(text);
        }
      }}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onView(text);
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={{
        fontSize: 12,
        color: "var(--accent)",
        marginTop: 4,
        lineHeight: 1.5,
        opacity: 0.85,
        whiteSpace: "pre-wrap",
        cursor: interactive ? "pointer" : undefined,
        ...style,
      }}
    >
      📝 {isLong ? text.slice(0, maxLength) + "…" : text}
      {interactive && (
        <span style={{ fontSize: 11, marginLeft: 4, textDecoration: "underline" }}>查看全文</span>
      )}
    </p>
  );
}
