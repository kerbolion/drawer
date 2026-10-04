import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  plugins: [{
    name: "trim-generated-whitespace",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") output.code = output.code.replace(/[ \t]+$/gm, "");
      }
    }
  }],
  resolve: {
    alias: [
      {
        find: /^rc-util\/es\/Dom\/findDOMNode(?:\.js)?$/,
        replacement: resolve(import.meta.dirname, "compat/rc-find-dom-node.js")
      },
      {
        find: /^rc-util\/es\/Dom\/isVisible(?:\.js)?$/,
        replacement: resolve(import.meta.dirname, "compat/rc-is-visible.js")
      }
    ]
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "content.js"),
      name: "SheetsRowDrawer",
      formats: ["iife"],
      fileName: () => "content.js"
    }
  }
});
