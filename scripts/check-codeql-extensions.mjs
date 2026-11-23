#!/usr/bin/env node
/**
 * Ensures embedded CodeQL model pack layout under .github/codeql/extensions so default
 * setup continues to load barrier models for log-service sanitizers.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { joinUnderRoot } from './lib/path-under-root.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXT_ROOT = joinUnderRoot(ROOT, '.github', 'codeql', 'extensions');

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
    .map((d) => joinUnderRoot(EXT_ROOT, d.name));

  if (packs.length === 0) {
    console.error('check-codeql-extensions: no packs under', EXT_ROOT);
    process.exit(1);
  }

  let foundBarriers = false;
  let foundPackMeta = false;
  for (const dir of packs) {
    const qlpack = joinUnderRoot(dir, 'qlpack.yml');
    const codeqlPack = joinUnderRoot(dir, 'codeql-pack.yml');
    const metaFiles = [qlpack, codeqlPack].filter((p) => fs.existsSync(p));
    if (metaFiles.length === 0) continue;

    for (const metaPath of metaFiles) {
      foundPackMeta = true;
      const yml = readText(metaPath);
      if (!yml.includes('library: true')) {
        console.error(`check-codeql-extensions: ${metaPath} must declare library: true`);
        process.exit(1);
      }
      if (!yml.includes('extensionTargets:') || !yml.includes('dataExtensions:')) {
        console.error(
          `check-codeql-extensions: ${metaPath} must declare extensionTargets and dataExtensions`,
        );
        process.exit(1);
      }
      if (/codeql\/javascript-all:\s*['"]?\*['"]?(\s|$)/m.test(yml)) {
        console.error(
          `check-codeql-extensions: ${metaPath} must not use '*' for codeql/javascript-all (pack may be skipped)`,
        );
        process.exit(1);
      }
    }

    const modelsDir = joinUnderRoot(dir, 'models');
    if (!fs.existsSync(modelsDir)) continue;
    for (const ent of fs.readdirSync(modelsDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.yml')) continue;
      const body = readText(joinUnderRoot(modelsDir, ent.name));
      if (body.includes('extensible: barrierModel')) {
        foundBarriers = true;
        if (
          !body.includes('sanitizeLogPayloadForDisk') ||
          !body.includes('sanitizeForLogSink') ||
          !body.includes('sanitizeLogMessage') ||
          !body.includes('sanitizeForConsoleEcho')
        ) {
          console.error(
            `check-codeql-extensions: ${ent.name} must model mesh-client log sanitizers as barriers`,
          );
          process.exit(1);
        }
        // MaD barrier kinds are validated like sink kinds; query ids are not valid.
        if (body.includes('http-to-file-access') || body.includes('js/http-to-file-access')) {
          console.error(
            `check-codeql-extensions: ${ent.name} must not use http-to-file-access / js/http-to-file-access as barrier kinds (invalid MaD kind). Use file-content-store for disk body sinks.`,
          );
          process.exit(1);
        }
        if (!body.includes('file-content-store')) {
          console.error(
            `check-codeql-extensions: ${ent.name} must declare file-content-store barriers for sanitizeLogPayloadForDisk`,
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

  if (!foundPackMeta) {
    console.error(
      'check-codeql-extensions: no qlpack.yml or codeql-pack.yml under extension packs',
    );
    process.exit(1);
  }

  process.exit(0);
}

main();
