#!/usr/bin/env node
/**
 * Contract check: every [TAG] prefix used in protocol-owned source trees must be
 * registered in src/shared/logProtocolScope.ts (LOG_TAG_SCOPE).
 *
 * Accept when any registry key is a prefix of the extracted tag (covers dynamic
 * tags such as [GATT:meshcore] and family prefixes such as [meshcoreRoom).
 *
 * To suppress a false positive (tag intentionally shared / omitted),
 * add // log-filter-ok <reason> on the same line as the console.* call.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const REGISTRY_PATH = path.join(ROOT, 'src', 'shared', 'logProtocolScope.ts');

const SUPPRESSED = /\/\/\s*log-filter-ok\b/;

/** Extract LOG_TAG_SCOPE keys from the shared registry source. */
export function extractRegistryKeys(registrySource) {
  const keys = [];
  // Keys may be full tags (`[Foo]`), session prefixes (`[GATT:`), or family
  // prefixes without a trailing colon (`[meshcoreRoom`).
  const re = /['"](\[[^'"]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(registrySource)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

/**
 * Extract [TAG] prefixes from console.* calls in a source file.
 * Handles static `[TAG]` and dynamic `[TAG:` template prefixes.
 */
export function extractTagsFromFile(filePath) {
  const tags = [];
  if (!fs.existsSync(filePath)) return tags;

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bconsole\.(debug|warn|error|info|log)\s*\(/.test(line)) continue;
    if (SUPPRESSED.test(line)) continue;

    const staticTagMatch = line.match(/console\.\w+\s*\(\s*[`'"]\[([A-Za-z][A-Za-z0-9 ]+)\]/);
    const dynamicTagMatch = line.match(/console\.\w+\s*\(\s*[`'"]\[([A-Za-z][A-Za-z0-9 ]+):/);
    const tagMatch = staticTagMatch ?? dynamicTagMatch;
    if (!tagMatch) continue;

    const tag = dynamicTagMatch ? `[${tagMatch[1]}:` : `[${tagMatch[1]}]`;
    tags.push({ tag, file: path.relative(ROOT, filePath), line: i + 1 });
  }

  return tags;
}

function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

function collectScanFiles() {
  const files = new Set();

  for (const rel of [
    'src/renderer/lib/meshtastic',
    'src/renderer/lib/meshcore',
    'src/renderer/lib/reticulum',
    'src/renderer/hooks/meshcore',
    'src/main/ipc',
  ]) {
    for (const f of walkTsFiles(path.join(ROOT, rel))) files.add(f);
  }

  for (const rel of [
    'src/renderer/runtime/useMeshtasticRuntime.ts',
    'src/renderer/runtime/useMeshcoreRuntime.ts',
    'src/renderer/runtime/useReticulumRuntime.ts',
    'src/main/gatt-sidecar-proxy.ts',
    'src/main/mqtt-manager.ts',
    'src/main/meshcore-mqtt-adapter.ts',
    'src/main/reticulum-sidecar-manager.ts',
    'src/main/reticulum-sidecar-path.ts',
    'src/renderer/components/ReticulumNetworkPanel.tsx',
    'src/renderer/lib/meshtastic/meshtasticRuntimeWireEffects.ts',
    'src/renderer/hooks/meshcore/meshcoreConnSideEffects.ts',
  ]) {
    files.add(path.join(ROOT, rel));
  }

  // Extra main-process protocol-named modules
  const mainDir = path.join(ROOT, 'src', 'main');
  if (fs.existsSync(mainDir)) {
    for (const name of fs.readdirSync(mainDir)) {
      if (
        /mqtt|meshcore|reticulum|meshtastic|gatt/i.test(name) &&
        /\.ts$/.test(name) &&
        !name.endsWith('.test.ts')
      ) {
        files.add(path.join(mainDir, name));
      }
    }
  }

  return [...files].filter((f) => fs.existsSync(f)).sort();
}

/** True when any registry key is a prefix of the tag (or equal). */
export function isTagCoveredByRegistry(tag, registryKeysSortedLongestFirst) {
  for (const key of registryKeysSortedLongestFirst) {
    if (tag === key || tag.startsWith(key) || key.startsWith(tag)) {
      // key.startsWith(tag): dynamic `[GATT:` covers registry `[GATT:meshtastic]`
      // tag.startsWith(key): `[meshcoreRoomSession]` covered by `[meshcoreRoom`
      return key;
    }
  }
  return null;
}

function main() {
  const registrySource = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const registryKeys = extractRegistryKeys(registrySource);
  if (registryKeys.length < 40) {
    console.error(
      `check-log-panel-filter: expected >40 LOG_TAG_SCOPE keys, found ${registryKeys.length}. Parser broken?`,
    );
    process.exit(1);
  }

  const keysLongestFirst = [...registryKeys].sort((a, b) => b.length - a.length);
  const violations = [];

  for (const filePath of collectScanFiles()) {
    for (const { tag, file, line } of extractTagsFromFile(filePath)) {
      const match = isTagCoveredByRegistry(tag, keysLongestFirst);
      if (!match) {
        violations.push({ tag, file, line });
      }
    }
  }

  if (violations.length === 0) {
    process.exit(0);
    return;
  }

  console.error(
    'check-log-panel-filter: unregistered [TAG] prefixes found in protocol source files.\n',
  );
  console.error('These tags appear in console.* calls but are missing from LOG_TAG_SCOPE in');
  console.error('src/shared/logProtocolScope.ts. Without registration, ownership is shared.\n');
  for (const { tag, file, line } of violations) {
    console.error(`  ${file}:${line}  tag=${tag}`);
  }
  console.error('\nAdd the tag (or a family prefix) to LOG_TAG_SCOPE in');
  console.error('src/shared/logProtocolScope.ts, then add coverage in logProtocolScope.test.ts.');
  console.error(
    'To suppress (tag intentionally shared), add // log-filter-ok <reason> to the call site.',
  );
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
