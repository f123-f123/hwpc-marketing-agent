// 把创作规范库（仓库外的 skills/hwpc-creative-studio）的 presets.json 同步进应用。
// 规范库是设计来源；应用运行时读取 packages/contracts/src/creative-presets.json，部署时不依赖仓库外目录。
// 用法：npm run sync:creative
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../skills/hwpc-creative-studio/references/presets.json", import.meta.url));
const to = fileURLToPath(new URL("../packages/contracts/src/creative-presets.json", import.meta.url));
if (!existsSync(from)) {
  console.error(`没有找到创作规范库：${from}`);
  process.exit(1);
}
copyFileSync(from, to);
console.log(`已同步：${from}\n     → ${to}\n请运行 npx vitest run packages/contracts 检查引用是否完整。`);
