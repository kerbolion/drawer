import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { minifyOptions } from "../scripts/minify-options.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist-extension");
if (
  minifyOptions.mangle !== true
  || minifyOptions.compress?.drop_console !== true
  || minifyOptions.compress?.drop_debugger !== true
  || minifyOptions.format?.comments !== false
) {
  throw new Error("La distribución debe acortar identificadores y eliminar comentarios, console y debugger.");
}
const allowed = new Set([
  "THIRD_PARTY_NOTICES.md",
  "background.js",
  "dist/content.js",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon48.png",
  "manifest.json",
  "page-write.js"
]);

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

const files = (await listFiles(output)).sort();
const unexpected = files.filter(file => !allowed.has(file));
const missing = [...allowed].filter(file => !files.includes(file));
if (unexpected.length || missing.length) {
  throw new Error(`Paquete inválido. Sobrantes: ${unexpected.join(", ") || "ninguno"}. Faltantes: ${missing.join(", ") || "ninguno"}.`);
}

const [manifest, sourceManifest, packageJson] = await Promise.all([
  readFile(path.join(output, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "manifest.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "package.json"), "utf8").then(JSON.parse)
]);
if (manifest.version !== sourceManifest.version || manifest.version !== packageJson.version) {
  throw new Error("Las versiones del paquete, manifest y proyecto no coinciden.");
}
if (!manifest.host_permissions?.includes("https://abrircrm.com/*")) {
  throw new Error("El paquete no declara el servidor autorizado.");
}

const expectedIcons = { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
if (JSON.stringify(manifest.icons) !== JSON.stringify(expectedIcons)) {
  throw new Error("El manifiesto no declara todos los iconos de la extensión.");
}
for (const [size, relativePath] of Object.entries(expectedIcons)) {
  const icon = await readFile(path.join(output, relativePath));
  if (
    icon.length < 24
    || icon.subarray(1, 4).toString("ascii") !== "PNG"
    || icon.readUInt32BE(16) !== Number(size)
    || icon.readUInt32BE(20) !== Number(size)
  ) {
    throw new Error(`El icono ${relativePath} no es un PNG de ${size}x${size}.`);
  }
}

for (const file of files.filter(file => file.endsWith(".js"))) {
  const code = await readFile(path.join(output, ...file.split("/")), "utf8");
  if (/sourceMappingURL|\beval\s*\(|\bnew\s+Function\s*\(|\bconsole\.(?:log|info|warn|error|debug|trace)\s*\(|\bdebugger\s*;/.test(code)) {
    throw new Error(`${file} contiene console, debugger, código dinámico o un mapa de fuentes.`);
  }
  if (code.trimEnd().includes("\n")) {
    throw new Error(`${file} no quedó minificado en una sola línea.`);
  }
}

console.log("PAQUETE_OK: distribución mínima, minificada y sin comentarios, console, debugger, mapas ni ejecución dinámica.");
