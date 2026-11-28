#!/usr/bin/env node
/**
 * Upstream drift audit for the mobile app (`pnpm -C mobile run audit`).
 *
 * The mobile package runs the desktop main process, preload and renderer unmodified. It depends on
 * desktop code in a few deliberate places; this audit fails when any of them changes upstream, so
 * the matching mobile code is reviewed instead of silently drifting:
 *
 * 1. Pinned files: every desktop module the mobile build wraps or replaces (renderer wrappers in
 *    `scripts/desktop-overrides.mjs`, host replacements in `scripts/build-host.mjs`) and the
 *    Reticulum sidecar entry the iOS library mirrors (`native/reticulum-lib/lib.rs`). Pinned by
 *    sha256 in `desktop-pins.json`.
 * 2. Invariants: exact desktop strings the mobile code relies on (media queries, persist keys).
 * 3. Electron API surface: every `electron` export and `<api>.<member>` the main process and
 *    preload use. A new member falls through to an inert shim, so it needs a mobile decision.
 * 4. The host worker bundle still builds (esbuild fails on unresolved imports and on named
 *    imports a shim does not export).
 * 5. With `--full`: the web bundle, the mobile Vitest projects and the browser harness specs.
 *
 * After reviewing a reported change (and updating the mobile side), refresh the pins with
 * `pnpm -C mobile run audit -- --update`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { buildMobileHost, MOBILE_MODULE_OVERRIDES } from './build-host.mjs';
import { RENDERER_OVERRIDES } from './desktop-overrides.mjs';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');
const PINS_FILE = path.join(MOBILE_ROOT, 'desktop-pins.json');

/** Desktop files whose every change needs a mobile review (repo-relative). */
export function pinnedFiles() {
  return [
    ...Object.keys(RENDERER_OVERRIDES),
    ...Object.keys(MOBILE_MODULE_OVERRIDES).map((rel) => `src/main/${rel}`),
    // Mirrored by native/reticulum-lib/lib.rs and staged by scripts/build-sidecar.mjs.
    'reticulum-sidecar/src/main.rs',
    'reticulum-sidecar/Cargo.toml',
  ].sort();
}

/** Exact desktop text the mobile code depends on: [file, substring, why]. */
export const INVARIANTS = [
  [
    'src/renderer/lib/bottomNav.ts',
    "export const SHELL_COMPACT_QUERY = '(max-width: 767px)';",
    'mobile/src/overrides/renderer/bottomNav.ts replaces this query with a sentinel',
  ],
  [
    'src/renderer/App.tsx',
    "const NODE_DETAIL_PANE_MEDIA_QUERY = '(min-width: 1280px)';",
    'mobile useMediaQuery answers this query from the navigation rail (NODE_DETAIL_PANE_QUERY)',
  ],
  [
    'src/renderer/stores/chatMacrosStore.ts',
    "export const CHAT_MACROS_STORAGE_KEY = 'mesh-client:chatMacros';",
    'mobile/src/main.tsx seeds this key (macro bar starts collapsed on phones)',
  ],
  [
    'src/renderer/stores/chatMacrosStore.ts',
    'name: CHAT_MACROS_STORAGE_KEY,\n      version: 1,',
    'the seeded value uses persist version 1',
  ],
  [
    'src/renderer/components/AppPanel.tsx',
    '<div data-setting-anchor="app.window.closeToTray"',
    'mobileShell.css hides this desktop-only row (no tray on phones)',
  ],
  [
    'src/renderer/components/AppPanel.tsx',
    '<div data-setting-anchor="app.updates.autoDownload"',
    'mobileShell.css hides the Updates section holding this anchor (app stores update the app)',
  ],
  [
    'src/renderer/components/AppPanel.tsx',
    '<div data-setting-anchor="app.gps.savedLocations">',
    'mobileShell.css sizes the saved location rows under this anchor',
  ],
];

const OVERRIDES_EN = path.join(MOBILE_ROOT, 'src/locales/desktop-overrides/en.json');
const DESKTOP_EN = path.join(REPO_ROOT, 'src/renderer/locales/en/translation.json');

function keyPaths(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

/**
 * English desktop text of each key the mobile apps write over (src/i18nMobile.ts,
 * src/locales/desktop-overrides). Pinned so a desktop copy change asks for the overrides in all
 * 16 languages to be reviewed.
 */
export function overriddenDesktopStrings() {
  const desktop = JSON.parse(fs.readFileSync(DESKTOP_EN, 'utf8'));
  const keys = keyPaths(JSON.parse(fs.readFileSync(OVERRIDES_EN, 'utf8'))).sort();
  return Object.fromEntries(
    keys.map((key) => [
      key,
      key
        .split('.')
        .reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), desktop) ?? null,
    ]),
  );
}

const sha256 = (file) =>
  createHash('sha256')
    .update(fs.readFileSync(path.join(REPO_ROOT, file)))
    .digest('hex');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * Electron exports and `<binding>.<member>` accesses used by the main process and preload.
 * Bindings are the local names of named / default / namespace imports from 'electron'.
 */
export function electronSurface(files) {
  const surface = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes("'electron'")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = new Map(); // local name → exported name
    for (const stmt of source.statements) {
      if (!ts.isImportDeclaration(stmt) || stmt.moduleSpecifier.text !== 'electron') continue;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) bindings.set(clause.name.text, 'default');
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, '*');
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          if (el.isTypeOnly) continue;
          const exported = (el.propertyName ?? el.name).text;
          bindings.set(el.name.text, exported);
          surface.add(exported);
        }
      }
    }
    if (bindings.size === 0) continue;
    const visit = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        bindings.has(node.expression.text)
      ) {
        const owner = bindings.get(node.expression.text);
        const base = owner === 'default' || owner === '*' ? 'electron' : owner;
        surface.add(`${base}.${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...surface].sort();
}

function diffLists(before, after) {
  const a = new Set(before);
  const b = new Set(after);
  return { added: after.filter((x) => !a.has(x)), removed: before.filter((x) => !b.has(x)) };
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: MOBILE_ROOT, stdio: 'inherit', ...opts });
  return r.status === 0;
}

async function main() {
  const update = process.argv.includes('--update');
  const full = process.argv.includes('--full');
  const problems = [];

  const files = Object.fromEntries(pinnedFiles().map((f) => [f, sha256(f)]));
  const mainFiles = [
    ...walk(path.join(REPO_ROOT, 'src/main')),
    ...walk(path.join(REPO_ROOT, 'src/preload')),
  ];
  const surface = electronSurface(mainFiles);
  const desktopStrings = overriddenDesktopStrings();

  if (update) {
    fs.writeFileSync(
      PINS_FILE,
      JSON.stringify({ files, electronSurface: surface, desktopStrings }, null, 2) + '\n',
    );
    console.info(
      `audit: pins updated (${String(Object.keys(files).length)} files, ` +
        `${String(surface.length)} Electron APIs)`,
    );
  }
  const pins = JSON.parse(fs.readFileSync(PINS_FILE, 'utf8'));

  for (const [file, digest] of Object.entries(files)) {
    if (pins.files[file] !== digest) {
      problems.push(
        `changed upstream: ${file} — review the mobile wrapper/replacement, then --update ` +
          `(git log -p -- ${file})`,
      );
    }
  }
  for (const file of Object.keys(pins.files)) {
    if (!(file in files)) problems.push(`pinned file no longer overridden: ${file} (--update)`);
  }
  const pinnedStrings = pins.desktopStrings ?? {};
  for (const [key, text] of Object.entries(desktopStrings)) {
    if (text === null) {
      problems.push(`desktop string gone: ${key} — remove it from src/locales/desktop-overrides`);
    } else if (pinnedStrings[key] !== text) {
      problems.push(
        `desktop copy changed: ${key} — review src/locales/desktop-overrides/*.json, then --update`,
      );
    }
  }
  for (const key of Object.keys(pinnedStrings)) {
    if (!(key in desktopStrings))
      problems.push(`desktop string no longer overridden: ${key} (--update)`);
  }
  for (const [file, text, why] of INVARIANTS) {
    if (!fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').includes(text)) {
      problems.push(`invariant missing in ${file}: ${JSON.stringify(text)} (${why})`);
    }
  }
  const { added, removed } = diffLists(pins.electronSurface, surface);
  for (const api of added) {
    problems.push(
      `new Electron API used by the main process: ${api} — implement it in ` +
        'src/host/shims/electron.ts (or confirm the inert fallback is right), then --update',
    );
  }
  for (const api of removed) problems.push(`Electron API no longer used: ${api} (--update)`);

  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-mobile-audit-'));
  try {
    await buildMobileHost({ outdir });
    console.info('audit: host worker bundle builds');
  } catch (e) {
    problems.push(
      `host worker bundle failed to build: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }

  try {
    const { stageSidecarCrate } = await import('./build-sidecar.mjs');
    if (typeof stageSidecarCrate === 'function') {
      await stageSidecarCrate();
      console.info('audit: Reticulum sidecar stages for mobile');
    }
  } catch (e) {
    problems.push(`sidecar staging failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (full) {
    if (!run('pnpm', ['run', 'build'])) problems.push('mobile web bundle build failed');
    else if (!run('pnpm', ['exec', 'vitest', 'run'])) problems.push('mobile Vitest failed');
    else if (!run('pnpm', ['exec', 'playwright', 'test'])) problems.push('browser harness failed');
  }

  if (problems.length > 0) {
    console.error(`mobile audit: ${String(problems.length)} item(s) need review`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.info(
    `audit: ok (${String(Object.keys(files).length)} pinned files, ` +
      `${String(INVARIANTS.length)} invariants, ${String(surface.length)} Electron APIs, ` +
      `${String(Object.keys(desktopStrings).length)} desktop strings worded for phones)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
