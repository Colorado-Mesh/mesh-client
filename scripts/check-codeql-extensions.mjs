#!/usr/bin/env node
/**
 * Ensures embedded CodeQL model pack layout under .github/codeql/extensions so default
 * setup continues to load barrier models for log-service sanitizers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_ROOT = path.join(ROOT, '.github', 'codeql', 'extensions');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function main() {
  if (!fs.existsSync(EXT_ROOT)) {
    console.error('check-codeql-extensions: missing', EXT_ROOT);
    process.exit(1);
  }

  const packs = fs
    .readdirSync(EXT_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(EXT_ROOT, d.name));

  if (packs.length === 0) {
    console.error('check-codeql-extensions: no packs under', EXT_ROOT);
    process.exit(1);
  }

  let foundBarriers = false;
  for (const dir of packs) {
    const qlpack = path.join(dir, 'qlpack.yml');
    if (!fs.existsSync(qlpack)) continue;
    const yml = readText(qlpack);
    if (!yml.includes('library: true')) {
      console.error(`check-codeql-extensions: ${qlpack} must declare library: true`);
      process.exit(1);
    }
    if (!yml.includes('extensionTargets:') || !yml.includes('dataExtensions:')) {
      console.error(
        `check-codeql-extensions: ${qlpack} must declare extensionTargets and dataExtensions`,
      );
      process.exit(1);
    }

    const modelsDir = path.join(dir, 'models');
    if (!fs.existsSync(modelsDir)) continue;
    for (const ent of fs.readdirSync(modelsDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.yml')) continue;
      const body = readText(path.join(modelsDir, ent.name));
      if (body.includes('extensible: barrierModel')) {
        foundBarriers = true;
        if (
          !body.includes('sanitizeLogPayloadForDisk') ||
          !body.includes('sanitizeForLogSink') ||
          !body.includes('sanitizeLogMessage')
        ) {
          console.error(
            `check-codeql-extensions: ${ent.name} must model mesh-client log sanitizers as barriers`,
          );
          process.exit(1);
        }
      }
    }
  }

  if (!foundBarriers) {
    console.error('check-codeql-extensions: no barrierModel extensions found under models/');
    process.exit(1);
  }

  process.exit(0);
}

main();
