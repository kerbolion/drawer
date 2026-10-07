import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { minifyOptions } from "./minify-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-extension");

async function minifyFile(source, destination) {
  const code = await readFile(path.join(root, source), "utf8");
  const result = await minify(code, minifyOptions);
  if (!result.code) throw new Error(`Terser no produjo contenido para ${source}`);
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${result.code}\n`, "utf8");
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "dist"), { recursive: true });
await Promise.all([
  cp(path.join(root, "manifest.json"), path.join(output, "manifest.json")),
  cp(path.join(root, "icons"), path.join(output, "icons"), { recursive: true }),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md")),
  minifyFile("background.js", "background.js"),
  minifyFile("page-write.js", "page-write.js"),
  cp(path.join(root, "dist", "content.js"), path.join(output, "dist", "content.js"))
]);

console.log(`Extensión creada en ${path.relative(root, output)}`);
