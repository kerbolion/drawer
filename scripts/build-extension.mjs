import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-extension");
const options = {
  ecma: 2020,
  compress: {
    drop_console: true,
    drop_debugger: true,
    passes: 3,
    toplevel: true
  },
  mangle: { toplevel: true },
  format: { comments: false }
};

async function minifyFile(source, destination) {
  const code = await readFile(path.join(root, source), "utf8");
  const result = await minify(code, options);
  if (!result.code) throw new Error(`Terser no produjo contenido para ${source}`);
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${result.code}\n`, "utf8");
}

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "dist"), { recursive: true });
await Promise.all([
  cp(path.join(root, "manifest.json"), path.join(output, "manifest.json")),
  cp(path.join(root, "THIRD_PARTY_NOTICES.md"), path.join(output, "THIRD_PARTY_NOTICES.md")),
  minifyFile("background.js", "background.js"),
  minifyFile("page-write.js", "page-write.js"),
  minifyFile("dist/content.js", "dist/content.js")
]);

console.log(`Extensión protegida creada en ${path.relative(root, output)}`);
