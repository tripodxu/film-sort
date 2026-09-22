import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * 首轮只开两类规则，避免一上来成百上千条告警把真正的信号淹掉：
 *
 *   - `react-hooks/recommended` —— f62affa 手修的三处 Hook 回归（缺依赖数组、
 *     无限 PUT、登出竞态）本来都能被它拦下；`useMemo` 写在 map 回调里这类
 *     违规同样由它负责。
 *   - `@typescript-eslint/no-unused-vars` —— 只报 warning，用于发现死代码。
 *
 * 其余 typescript-eslint 规则暂时不开，避免与既有写法大面积冲突；后续可以
 * 按目录逐步收紧，而不是一次性全仓开火。
 *
 * 注意：ESLint 只是开发期工具，不进任何 bundle。
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".wrangler/**",
      "coverage/**",
      ".goatgauge-data/**",
      ".zcode/**",
      ".mimocode/**",
      ".localappdata/**",
      ".npm-cache/**",
      // 截图工具链的产物与 Chrome 热缓存 profile（内含第三方扩展 JS，非本仓代码）。
      ".tmp/**",
      // Deno Deploy 的独立代理脚本，运行环境不同（Deno 全局、无 tsconfig）。
      "gd-proxy/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "worker/**/*.ts", "shared/**/*.ts"],
    extends: [tseslint.configs.base],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
);
