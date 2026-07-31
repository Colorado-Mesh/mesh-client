#!/usr/bin/env node
/**
 * CLI for release.sh: prepend a validated <release> to Flatpak MetaInfo.
 * Usage: node scripts/prepend-metainfo-release.mjs <version> <YYYY-MM-DD> [metainfo-path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prependMetainfoRelease } from './metainfoRelease.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_METAINFO = path.join(ROOT, 'flatpak', 'org.coloradomesh.MeshClient.metainfo.xml');

const [version, date, metainfoArg] = process.argv.slice(2);
if (!version || !date) {
  console.error(
    'Usage: node scripts/prepend-metainfo-release.mjs <version> <YYYY-MM-DD> [metainfo-path]',
  );
  process.exit(1);
}

const metainfoPath = metainfoArg ? path.resolve(metainfoArg) : DEFAULT_METAINFO;

const xml = fs.readFileSync(metainfoPath, 'utf8');
const next = prependMetainfoRelease(xml, version, date);
if (next !== xml) {
  fs.writeFileSync(metainfoPath, next, 'utf8');
}
console.log(
  `MetaInfo release ${version} (${date}) ensured in ${path.relative(ROOT, metainfoPath)}`,
);
