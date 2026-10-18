import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { sceneRuntime } from "./build/sceneRuntimePlugin";

// 开发期把 /api 代理到后端；前端只通过相对路径访问，不接触任何凭证。
// @hwpc/scenes 指向 code/scenes（场景库，已加入根 workspaces；别名让 Vite 直接读源码，便于热更新）。
// 需要连 mock 演示后端时：$env:VITE_API_TARGET='http://localhost:8788'
export default defineConfig({
  plugins: [react(), sceneRuntime()],
  resolve: { alias: { "@hwpc/scenes": fileURLToPath(new URL("../../scenes/src/index.ts", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8787", changeOrigin: true } },
  },
});
