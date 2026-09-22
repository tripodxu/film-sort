import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { readTheme } from "./lib/theme";
import { readLayout } from "./lib/layout";
import "./styles.css";

// Apply the saved theme before React mounts to avoid a first-frame flash.
try {
  const theme = readTheme();
  if (theme !== "modern") document.documentElement.setAttribute("data-theme", theme);
  const layout = readLayout();
  if (layout !== "archive") document.documentElement.setAttribute("data-layout", layout);
} catch {
  /* Private browsing can disable storage. */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service Worker is production-only; localhost must keep Vite HMR and source modules fresh.
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
