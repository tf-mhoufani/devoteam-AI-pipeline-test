import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/middlewares/**/*.ts"],
      exclude: ["src/middlewares/**/__tests__/**", "src/middlewares/fixtures.ts"],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 85 },
    },
  },
});