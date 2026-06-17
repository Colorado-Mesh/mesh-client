#!/usr/bin/env node
/**
 * Guardrail: discourage new `protocol === 'meshcore'` feature gates in renderer components.
 * Dual-protocol wiring (runtime selection, MQTT storage keys) may stay on the allowlist.
 *
 * To permit a file, add its path (relative to repo root) to ALLOWLIST below with a short reason.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COMPONENTS_DIR = path.join(ROOT, 'src', 'renderer', 'components');

const PATTERN = /protocol\s*===\s*['"]meshcore['"]/;

/** Files still allowed to compare protocol strings directly (migrate incrementally). */
const ALLOWLIST = new Set([
  'src/renderer/App.tsx',
  'src/renderer/components/AppPanel.tsx',
  'src/renderer/components/ChatComposer.tsx',
  'src/renderer/components/ChatPanel.tsx',
  'src/renderer/components/ConnectionPanel.tsx',
  'src/renderer/components/DiagnosticsPanel.tsx',
  'src/renderer/components/KeyBackupRestoreSection.tsx',
  'src/renderer/components/MapPanel.tsx',
  'src/renderer/components/NodeDetailModal.tsx',
  'src/renderer/components/NodeInfoBody.tsx',
  'src/renderer/components/SearchModal.tsx',
  'src/renderer/components/SecurityPanel.tsx',
  'src/renderer/components/LogPanel.tsx',
]);

function collectTsx(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectTsx(full));
    else if (ent.isFile() && ent.name.endsWith('.tsx') && !ent.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const violations = [];
  for (const filePath of collectTsx(COMPONENTS_DIR)) {
    const rel = path.relative(ROOT, filePath).replaceAll('\\', '/');
    if (ALLOWLIST.has(rel)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    if (!PATTERN.test(src)) continue;
    const lineNum = src.split('\n').findIndex((line) => PATTERN.test(line)) + 1;
    violations.push(`${rel}:${lineNum}`);
  }

  if (violations.length > 0) {
    console.error(
      'check-protocol-string-gates: use ProtocolCapabilities instead of protocol === "meshcore" in:\n',
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      '\nAdd to ALLOWLIST in scripts/check-protocol-string-gates.mjs only for wire/storage routing.',
    );
    process.exit(1);
  }
}

main();
