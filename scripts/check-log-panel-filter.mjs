#!/usr/bin/env node
/**
 * Contract check: every [TAG] prefix used in a Meshtastic or MeshCore device
 * source file must be registered in isDeviceEntry() in LogPanel.tsx.
 *
 * This prevents the "new prefix added to noble-ble-manager / mqtt-manager /
 * meshcore-mqtt-adapter, but never added to the log filter" regression.
 *
 * Files checked:
 *   Meshtastic: src/main/noble-ble-manager.ts, src/main/mqtt-manager.ts
 *   MeshCore:   src/main/meshcore-mqtt-adapter.ts
 *
 * Filter source: src/renderer/components/LogPanel.tsx
 *
 * To suppress a false positive (tag intentionally omitted from filter),
 * add // log-filter-ok <reason> on the same line as the console.* call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const LOG_PANEL = path.join(ROOT, 'src', 'renderer', 'components', 'LogPanel.tsx');

/**
 * Source files whose [TAG] prefixes must be registered in the Meshtastic
 * or MeshCore branch of isDeviceEntry().
 */
const DEVICE_FILES = {
  meshtastic: [
    path.join(ROOT, 'src', 'main', 'noble-ble-manager.ts'),
    path.join(ROOT, 'src', 'main', 'mqtt-manager.ts'),
  ],
  meshcore: [path.join(ROOT, 'src', 'main', 'meshcore-mqtt-adapter.ts')],
};

const SUPPRESSED = /\/\/\s*log-filter-ok\b/;

/**
 * Extract [TAG] prefixes from console.* calls in a source file.
 * Handles:
 *   console.warn('[TAG] message')         → '[TAG]'
 *   console.error(`[TAG] message`)        → '[TAG]'
 *   console.warn(`[TAG:${var}] message`)  → '[TAG:' (static prefix before template expr)
 */
function extractTagsFromFile(filePath) {
  const tags = [];
  if (!fs.existsSync(filePath)) return tags;

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bconsole\.(debug|warn|error|info|log)\s*\(/.test(line)) continue;
    if (SUPPRESSED.test(line)) continue;

    // Match the opening quote/backtick of the first string argument, then [TAG
    const match = line.match(/console\.\w+\s*\(\s*[`'"]\[([A-Za-z][A-Za-z0-9]*(?::[^`'"$\]]*)?)/);
    if (!match) continue;

    const inner = match[1];
    // Dynamic prefix like [BLE:${sessionId}] → extract '[BLE:' (static portion)
    const tag = inner.endsWith(':') ? `[${inner}` : `[${inner}]`;
    tags.push({ tag, file: path.relative(ROOT, filePath), line: i + 1 });
  }

  return tags;
}

/**
 * Extract all includes('[TAG]') / includes('[TAG:') calls from
 * the given protocol branch of isDeviceEntry in LogPanel.tsx.
 */
function extractFilteredTagsForProtocol(logPanelSource, protocol) {
  const branchStart = logPanelSource.indexOf(`if (protocol === '${protocol}')`);
  if (branchStart === -1) return new Set();

  // Find the closing brace of the if block by walking bracket depth
  let depth = 0;
  let i = branchStart;
  let inBlock = false;
  let blockEnd = -1;
  for (; i < logPanelSource.length; i++) {
    if (logPanelSource[i] === '{') {
      depth++;
      inBlock = true;
    } else if (logPanelSource[i] === '}') {
      depth--;
      if (inBlock && depth === 0) {
        blockEnd = i;
        break;
      }
    }
  }
  if (blockEnd === -1) return new Set();

  const block = logPanelSource.slice(branchStart, blockEnd + 1);
  const tags = new Set();
  const re = /\.includes\(['"](\[[^\]'"]+(?:\])?)['"]\)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    tags.add(m[1]);
  }
  return tags;
}

function main() {
  const logPanelSource = fs.readFileSync(LOG_PANEL, 'utf8');

  const violations = [];

  for (const [protocol, files] of Object.entries(DEVICE_FILES)) {
    const filteredTags = extractFilteredTagsForProtocol(logPanelSource, protocol);

    for (const filePath of files) {
      const entries = extractTagsFromFile(filePath);
      for (const { tag, file, line } of entries) {
        if (!filteredTags.has(tag)) {
          violations.push({ protocol, tag, file, line });
        }
      }
    }
  }

  if (violations.length === 0) {
    process.exit(0);
    return;
  }

  console.error(
    'check-log-panel-filter: unregistered [TAG] prefixes found in device source files.\n',
  );
  console.error('These tags appear in console.* calls but are missing from isDeviceEntry() in');
  console.error('LogPanel.tsx. Without registration, these logs leak into the App log panel.\n');
  for (const { protocol, tag, file, line } of violations) {
    console.error(`  ${file}:${line}  tag=${tag}  (missing from '${protocol}' branch)`);
  }
  console.error('\nAdd the tag to isDeviceEntry() in src/renderer/components/LogPanel.tsx,');
  console.error('then add a test for it in LogPanel.filtering.test.ts.');
  console.error(
    'To suppress (tag intentionally omitted), add // log-filter-ok <reason> to the call site.',
  );
  process.exit(1);
}

main();
