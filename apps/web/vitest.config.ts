import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sceneRuntime } from "./build/sceneRuntimePlugin";

// 仅用于 apps/web 内部测试：cd apps/web; npx vitest run
export default defineConfig({
  plugins: [sceneRuntime()],
  resolve: { alias: { "@hwpc/scenes": fileURLToPath(new URL("../../scenes/src/index.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
