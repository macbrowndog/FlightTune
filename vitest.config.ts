import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "release/**", "node_modules/**", "outputs/**", "work/**"],
  },
});
