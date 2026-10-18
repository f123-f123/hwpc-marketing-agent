import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "fixtures/test/**/*.test.ts", "scenes/test/**/*.test.ts"],
    environment: "node",
  },
});
