import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: ".tmp/vitest-cache",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
