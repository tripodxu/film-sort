import { Upload } from "lucide-react";
import type { ReactNode } from "react";

export const fileInput = (
  target: "own" | "peer",
  text: string,
  importProfile: (file: File, target: "own" | "peer") => void,
): ReactNode => (
  <label className="button secondary file-button">
    <Upload size={16} />{text}
    <input
      aria-label={text}
      type="file"
      accept=".json,application/json"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importProfile(file, target);
        event.target.value = "";
      }}
    />
  </label>
);

export const heading = (eyebrow: string, title: string, detail?: string): ReactNode => (
  <div className="page-heading">
    <span className="eyebrow">{eyebrow}</span>
    <h1>{title}</h1>
    {detail && <p>{detail}</p>}
  </div>
);
