import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-extension");
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "dist"), { recursive: true });
await Promise.all([
  cp(path.join(root, "manifest.json"), path.join(output, "manifest.json")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md")),
  cp(path.join(root, "background.js"), path.join(output, "background.js")),
  cp(path.join(root, "page-write.js"), path.join(output, "page-write.js")),
  cp(path.join(root, "dist", "content.js"), path.join(output, "dist", "content.js"))
]);

console.log(`Extensión creada en ${path.relative(root, output)}`);
