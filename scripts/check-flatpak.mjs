#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const METAINFO = path.join(ROOT, 'flatpak', 'org.coloradomesh.MeshClient.metainfo.xml');
const MANIFEST = path.join(ROOT, 'org.coloradomesh.MeshClient.yml');
const PKG = path.join(ROOT, 'package.json');
const EXPECTED_APP_ID = 'org.coloradomesh.MeshClient';

function checkMetainfoVersionMatchesPackage() {
  const violations = [];
  if (!fs.existsSync(METAINFO) || !fs.existsSync(PKG)) return violations;

  const pkgVersion = JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
  const xml = fs.readFileSync(METAINFO, 'utf8');
  const rel = path.relative(ROOT, METAINFO);

  const m = xml.match(/<release\s+version="([^"]+)"/);
  if (!m) {
    violations.push({
      file: rel,
      message: '<releases> has no <release> entries — run release.sh or add one manually',
    });
    return violations;
  }

  if (m[1] !== pkgVersion) {
    violations.push({
      file: rel,
      message: `top <release version="${m[1]}"> does not match package.json version "${pkgVersion}" — re-run release.sh or update MetaInfo manually`,
    });
  }
  return violations;
}

function checkMetainfoAppId() {
  const violations = [];
  if (!fs.existsSync(METAINFO)) return violations;

  const xml = fs.readFileSync(METAINFO, 'utf8');
  const m = xml.match(/<id>([^<]+)<\/id>/);
  if (!m) {
    violations.push({ file: path.relative(ROOT, METAINFO), message: 'missing <id> element' });
    return violations;
  }
  if (m[1] !== EXPECTED_APP_ID) {
    violations.push({
      file: path.relative(ROOT, METAINFO),
      message: `<id> is "${m[1]}", expected "${EXPECTED_APP_ID}"`,
    });
  }
  return violations;
}

function checkManifestAppId() {
  const violations = [];
  if (!fs.existsSync(MANIFEST)) {
    violations.push({ file: 'org.coloradomesh.MeshClient.yml', message: 'manifest file missing' });
    return violations;
  }

  const yaml = fs.readFileSync(MANIFEST, 'utf8');
  const m = yaml.match(/^app-id:\s*(.+)$/m);
  if (!m) {
    violations.push({ file: 'org.coloradomesh.MeshClient.yml', message: 'missing app-id field' });
    return violations;
  }
  if (m[1].trim() !== EXPECTED_APP_ID) {
    violations.push({
      file: 'org.coloradomesh.MeshClient.yml',
      message: `app-id is "${m[1].trim()}", expected "${EXPECTED_APP_ID}"`,
    });
  }
  return violations;
}

function main() {
  const violations = [
    ...checkMetainfoVersionMatchesPackage(),
    ...checkMetainfoAppId(),
    ...checkManifestAppId(),
  ];

  if (violations.length === 0) {
    process.exit(0);
  }

  console.error('check-flatpak:\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.message}`);
    console.error('');
  }
  process.exit(1);
}

main();
