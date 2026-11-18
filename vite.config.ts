import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    manifest: true,
    // 生产不外泄可下载的 source map（REVIEW P2 #15）
    sourcemap: false,
    rollupOptions: {
      output: {
        experimentalMinChunkSize: 4096,
        manualChunks(id) {
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/")) {
            return "framework";
          }
          if (
            id.includes("\\node_modules\\react\\") ||
            id.includes("\\node_modules\\react-dom\\")
          ) {
            return "framework";
          }
        },
      },
    },
  },
});
