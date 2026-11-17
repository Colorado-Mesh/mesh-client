#!/usr/bin/env node
/**
 * Bump the release version in the working tree, for a hotfix branch that should release when it
 * merges into main. Promotions bump automatically through `pnpm run promotion:open`.
 *
 * Usage: pnpm run release:bump -- <patch|minor|major|X.Y.Z>
 *
 * Writes package.json and the Flatpak MetaInfo release list; commit the result as
 * `chore: release vX.Y.Z`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  METAINFO_PATH,
  PACKAGE_JSON_PATH,
  readPackageVersion,
  releaseBaseline,
  resolveNextVersion,
  setPackageVersion,
  upsertMetainfoRelease,
} from './releaseVersion.mjs';

const USAGE = 'Usage: pnpm run release:bump -- <patch|minor|major|X.Y.Z>';

/**
 * @param {string[]} argv
 * @returns {string | null} the bump argument, or null when the arguments are not usable
 */
export function parseBumpArgument(argv) {
  const args = argv.filter((arg) => arg !== '--');
  if (args.length !== 1) return null;
  const [bump] = args;
  return ['patch', 'minor', 'major'].includes(bump) || /^\d+\.\d+\.\d+$/.test(bump) ? bump : null;
}

const MAIN_REF = 'refs/remotes/origin/main';

/**
 * Count from the latest release tag, or from the version main carried where this branch left it
 * when that release still waits for its tag, so a hotfix never reuses or lowers it. Running
 * again on the same branch replaces the earlier bump instead of stacking a second one.
 * @param {{ cwd: string, bump: string, today: string }} options
 * @returns {{ version: string, latestVersion: string }}
 */
export function runReleaseBump({ cwd, bump, today }) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  try {
    git(['rev-parse', '--verify', '--quiet', MAIN_REF]);
  } catch {
    // catch-no-log-ok the missing ref is reported by the error below, which main() prints
    throw new Error(
      'release:bump counts from origin/main, which this checkout does not have; run git fetch origin main first.',
    );
  }
  const branchPoint = git(['merge-base', 'HEAD', MAIN_REF]);
  const latestTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD']);
  const { version: latestVersion } = releaseBaseline({
    tagVersion: latestTag.replace(/^v/, ''),
    mainVersion: readPackageVersion(git(['show', `${branchPoint}:${PACKAGE_JSON_PATH}`])),
  });
  const version = resolveNextVersion({ latestVersion, bump });

  const packagePath = path.join(root, PACKAGE_JSON_PATH);
  const metainfoPath = path.join(root, METAINFO_PATH);
  const packageText = setPackageVersion(readFileSync(packagePath, 'utf8'), version);
  const metainfoText = upsertMetainfoRelease(readFileSync(metainfoPath, 'utf8'), {
    version,
    date: today,
    latestVersion,
  });
  writeFileSync(packagePath, packageText);
  writeFileSync(metainfoPath, metainfoText);
  return { version, latestVersion };
}

function main() {
  const bump = parseBumpArgument(process.argv.slice(2));
  if (!bump) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const { version, latestVersion } = runReleaseBump({
      cwd: process.cwd(),
      bump,
      today: new Date().toISOString().slice(0, 10),
    });
    console.info(
      `Bumped ${latestVersion} -> ${version} in ${PACKAGE_JSON_PATH} and ${METAINFO_PATH}.`,
    );
    console.info(`Commit these two files as: chore: release v${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main();
}
