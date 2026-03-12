#!/usr/bin/env node
// Rebuilds native Node.js addons for the installed Electron version.
// Uses electron-builder install-app-deps (same as packaging) so we do not
// need a direct @electron/rebuild devDependency — avoids electron-builder warning.
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const electronVersion = require(path.join(projectRoot, "node_modules/electron/package.json")).version;

console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

// Drop stale better-sqlite3/build so a wrong-platform .node (e.g. Linux on macOS) cannot persist.
const betterSqlite3Build = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
);
if (fs.existsSync(betterSqlite3Build)) {
  fs.rmSync(betterSqlite3Build, { recursive: true, force: true });
}

// Invoke install-app-deps via node so we never need shell: true (Node DEP0190).
const installAppDepsJs = path.join(
  projectRoot,
  "node_modules",
  "electron-builder",
  "install-app-deps.js",
);
if (!fs.existsSync(installAppDepsJs)) {
  console.error("electron-builder install-app-deps not found; run npm install first.");
  process.exit(1);
}
const result = spawnSync(process.execPath, [installAppDepsJs], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Rebuild complete.");
