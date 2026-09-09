import type { ReactNode } from "react";

export function IconButton({ title, children, onClick, disabled = false }: { title: string; children: ReactNode; onClick: (event: React.MouseEvent) => void; disabled?: boolean }) {
  return <button className="icon-button" aria-label={title} title={title} onClick={onClick} disabled={disabled}>{children}<span className="tooltip" role="tooltip">{title}</span></button>;
}
