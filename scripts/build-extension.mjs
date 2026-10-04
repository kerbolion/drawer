import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";
import { minify } from "terser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-extension");
const protectionOptions = {
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

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: true,
  rotateStringArray: true,
  seed: 743921,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

function optionsForSource(source) {
  if (source !== "dist/content.js") return obfuscatorOptions;
  return {
    ...obfuscatorOptions,
    controlFlowFlattening: false,
    renameGlobals: false,
    simplify: false,
    splitStrings: false,
    stringArrayCallsTransform: false,
    stringArrayIndexShift: false,
    stringArrayThreshold: 0.65,
    transformObjectKeys: false
  };
}

const packagingOptions = {
  ecma: 2020,
  compress: false,
  mangle: { toplevel: true },
  format: { comments: false }
};

async function runTerserPass(code, source, pass, options) {
  const result = await minify(code, options);
  if (!result.code) {
    throw new Error(`Terser no produjo contenido para ${source} en la pasada ${pass}`);
  }
  return result.code;
}

async function minifyFile(source, destination) {
  const code = await readFile(path.join(root, source), "utf8");
  const protectedCode = await runTerserPass(code, source, 1, protectionOptions);
  const obfuscatedCode = JavaScriptObfuscator
    .obfuscate(protectedCode, optionsForSource(source))
    .getObfuscatedCode();
  if (!obfuscatedCode) {
    throw new Error(`El ofuscador no produjo contenido para ${source}`);
  }
  const isolatedCode = `(() => {${obfuscatedCode}\n})();`;
  const packagedCode = await runTerserPass(isolatedCode, source, 2, packagingOptions);
  const target = path.join(output, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${packagedCode}\n`, "utf8");
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
