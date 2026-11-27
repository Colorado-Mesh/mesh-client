#!/usr/bin/env node
/**
 * Guard: the mobile app must not change the desktop app (`pnpm -C mobile run check:desktop-untouched`).
 *
 * Compares the branch (commits, working tree and untracked files) with its merge-base on the
 * desktop trunk and fails when anything outside the allowlist changed:
 * - `mobile/**` (this package, including the native Android/iOS projects);
 * - `.github/workflows/mobile-*.yaml` (mobile CI);
 * - `pnpm-workspace.yaml`, only to register this package;
 * - the desktop files in `ALLOWED_DESKTOP_EDITS`, only by their `mobile/**` exclusion;
 * - `pnpm-lock.yaml`, only below `importers.mobile` and the package entries it adds — the root
 *   importer (the desktop app's dependency set) must be identical.
 * Base: `MOBILE_GUARD_BASE` or `git merge-base HEAD origin/main`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** True when a repo-relative path may change on a mobile branch (content checked separately). */
export function isAllowedPath(file) {
  return (
    file.startsWith('mobile/') ||
    /^\.github\/workflows\/mobile-[\w-]+\.ya?ml$/.test(file) ||
    file === 'pnpm-workspace.yaml' ||
    file === 'pnpm-lock.yaml' ||
    Object.hasOwn(ALLOWED_DESKTOP_EDITS, file)
  );
}

/** Workspace file may only gain the `packages:` entry for this package. */
export function workspaceProblems(before, after) {
  const a = load(before) ?? {};
  const b = load(after) ?? {};
  const problems = [];
  const { packages: pa = [], ...ra } = a;
  const { packages: pb = [], ...rb } = b;
  if (JSON.stringify(ra) !== JSON.stringify(rb)) {
    problems.push('pnpm-workspace.yaml: settings other than `packages` changed');
  }
  const added = pb.filter((p) => !pa.includes(p));
  if (pa.some((p) => !pb.includes(p)) || added.some((p) => p !== 'mobile')) {
    problems.push(
      `pnpm-workspace.yaml: packages changed beyond adding "mobile" (${added.join(', ')})`,
    );
  }
  return problems;
}

const dropMobileLines = (text) =>
  text
    .split('\n')
    .filter((line) => !/mobile/i.test(line))
    .join('\n');

/**
 * Desktop files a mobile branch may edit, each with the function that removes exactly the mobile
 * addition (an exclusion of `mobile/**`); what remains must equal the base.
 */
export const ALLOWED_DESKTOP_EDITS = {
  // Root fallow leaves mobile/** to the package's own config.
  '.fallowrc.jsonc': dropMobileLines,
  // The wasm scan for translation binaries skips the mobile build output.
  'src/main/translation/noBundledTranslations.test.ts': (text) =>
    dropMobileLines(text.replace(", 'mobile/**']", ']')),
};

/** An allowed desktop file changed only by its known mobile exclusion. */
export function desktopEditProblems(file, before, after) {
  const strip = ALLOWED_DESKTOP_EDITS[file];
  return strip(after) === before ? [] : [`${file}: changed beyond its allowed mobile exclusion`];
}

/** Lockfile: the desktop importer and settings must be identical. */
export function lockfileProblems(before, after) {
  const a = load(before) ?? {};
  const b = load(after) ?? {};
  const problems = [];
  if (JSON.stringify(a.importers?.['.']) !== JSON.stringify(b.importers?.['.'])) {
    problems.push("pnpm-lock.yaml: the desktop importer ('.') changed");
  }
  for (const key of ['lockfileVersion', 'settings', 'overrides', 'patchedDependencies']) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      problems.push(`pnpm-lock.yaml: ${key} changed`);
    }
  }
  return problems;
}

function main() {
  const base = process.env.MOBILE_GUARD_BASE || git('merge-base', 'HEAD', 'origin/main').trim();
  const changed = new Set(
    [
      ...git('diff', '--name-only', base).split('\n'),
      ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ].filter(Boolean),
  );
  const problems = [...changed]
    .filter((f) => !isAllowedPath(f))
    .map((f) => `${f}: desktop file changed on a mobile branch`);

  const show = (rev, file) => {
    try {
      return git('show', `${rev}:${file}`);
    } catch {
      return '';
    }
  };
  const working = (file) => readFileSync(path.join(REPO_ROOT, file), 'utf8');
  if (changed.has('pnpm-workspace.yaml')) {
    problems.push(
      ...workspaceProblems(show(base, 'pnpm-workspace.yaml'), working('pnpm-workspace.yaml')),
    );
  }
  for (const file of Object.keys(ALLOWED_DESKTOP_EDITS)) {
    if (changed.has(file)) {
      problems.push(...desktopEditProblems(file, show(base, file), working(file)));
    }
  }
  if (changed.has('pnpm-lock.yaml')) {
    problems.push(...lockfileProblems(show(base, 'pnpm-lock.yaml'), working('pnpm-lock.yaml')));
  }

  if (problems.length > 0) {
    console.error(`desktop-untouched: ${String(problems.length)} problem(s) against ${base}`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.info(`desktop-untouched: ok (${String(changed.size)} changed paths, base ${base})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
