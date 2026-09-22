import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    // 生产不外泄可下载的 source map（REVIEW P2 #15）
    sourcemap: false,
  },
});
