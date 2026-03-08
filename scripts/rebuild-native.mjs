#!/usr/bin/env node
// Rebuilds native Node.js addons for the installed Electron version.
// Used by the postinstall and rebuild npm scripts.
import { rebuild } from "@electron/rebuild";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const electronVersion = require(path.join(projectRoot, "node_modules/electron/package.json")).version;

console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

await rebuild({
  buildPath: projectRoot,
  electronVersion,
  onlyModules: ["better-sqlite3"],
  force: true,
});

console.log("Rebuild complete.");
