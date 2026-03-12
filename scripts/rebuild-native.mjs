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

// install-app-deps can exit 0 without compiling better-sqlite3 (no native .node
// produced). If the addon is still missing, fall back to @electron/rebuild so
// Electron main does not crash at startup with "Could not locate the bindings file".
const betterSqlite3Node = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
if (!fs.existsSync(betterSqlite3Node)) {
  console.log(
    "better-sqlite3 native binary missing after install-app-deps; running @electron/rebuild…",
  );
  // Run rebuild via node + CLI path so postinstall works on Windows (spawnSync("npx")
  // fails with ENOENT: npx is npx.cmd and is not a direct executable). Do not use
  // require.resolve("@electron/rebuild/lib/cli.js") — package exports block that path.
  const rebuildCli = path.join(
    projectRoot,
    "node_modules",
    "@electron",
    "rebuild",
    "lib",
    "cli.js",
  );
  if (!fs.existsSync(rebuildCli)) {
    console.error(
      "@electron/rebuild not found; ensure npm install completed (electron-builder brings it in). " +
        "On Windows, do not rely on npx from spawn — run: npx --yes @electron/rebuild -f -w better-sqlite3",
    );
    process.exit(1);
  }
  const rebuildResult = spawnSync(
    process.execPath,
    [rebuildCli, "-f", "-w", "better-sqlite3"],
    { cwd: projectRoot, stdio: "inherit", env: { ...process.env } },
  );
  if (rebuildResult.error) {
    console.error(rebuildResult.error);
    process.exit(1);
  }
  if (rebuildResult.status !== 0) {
    process.exit(rebuildResult.status ?? 1);
  }
  if (!fs.existsSync(betterSqlite3Node)) {
    console.error(
      "better-sqlite3 still has no better_sqlite3.node after @electron/rebuild; check build tools (python, Xcode CLI).",
    );
    process.exit(1);
  }
}

console.log("Rebuild complete.");
