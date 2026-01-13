import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/calculators/**/*.ts"],
      exclude: [
        "src/calculators/**/*.test.ts",
        "src/calculators/__tests__/**",
        "src/calculators/registry.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@soccer/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
});
