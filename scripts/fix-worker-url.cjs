#!/usr/bin/env node
/*
 * tsup keeps `new URL("../workers/poseWorker.ts", import.meta.url)` untouched.
 * That path is correct while developing with Vite from `src/`, but an npm
 * consumer imports the compiled files from `dist/`. The worker is built as
 * `dist/poseWorker.js`, so patch the published bundles after tsup runs.
 */

const fs = require("node:fs");
const path = require("node:path");

const distDir = path.resolve(__dirname, "..", "dist");
const files = ["index.js", "index.cjs"];
let patched = 0;

for (const file of files) {
  const fullPath = path.join(distDir, file);
  if (!fs.existsSync(fullPath)) continue;

  const before = fs.readFileSync(fullPath, "utf8");
  let after = before.replaceAll("../workers/poseWorker.ts", "./poseWorker.js");

  // esbuild's CommonJS output represents import.meta as an empty object.
  // Give it a best-effort file URL so `new URL(..., import_meta.url)` does
  // not immediately throw in Node-like CommonJS environments. Browser ESM
  // consumers still use the native import.meta.url path above.
  after = after.replace(
    "var import_meta = {};",
    'var import_meta = { url: typeof __filename !== "undefined" ? new URL(__filename, "file:").href : void 0 };'
  );

  if (after !== before) {
    fs.writeFileSync(fullPath, after);
    patched += 1;
  }
}

const workerPath = path.join(distDir, "poseWorker.js");
if (!fs.existsSync(workerPath)) {
  console.error("Expected worker bundle was not generated: dist/poseWorker.js");
  process.exit(1);
}

console.log(`Patched worker URL in ${patched} bundle file${patched === 1 ? "" : "s"}.`);
