#!/usr/bin/env node
/** Run one CI Vitest shard without interpolating changed paths through a shell. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runVitestArgv } from './precommit-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS = new Set(['renderer-ui', 'renderer-logic', 'main']);

export function parseRelatedPaths(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('VITEST_PATHS_JSON must be a JSON array of strings');
  }
  return parsed;
}

export function buildCiVitestArgs({ mode, project, relatedPaths = [] }) {
  if (!PROJECTS.has(project)) throw new Error(`Unknown Vitest project: ${project}`);

  const reportArgs = [
    '--project',
    project,
    '--reporter=blob',
    `--outputFile.blob=.vitest-reports/blob-${project}.json`,
    '--passWithNoTests',
  ];
  if (mode === 'full') {
    return ['run', '--coverage', '--coverage.clean=false', ...reportArgs];
  }
  if (mode === 'related' && relatedPaths.length > 0) {
    return ['related', '--run', ...reportArgs, ...relatedPaths];
  }
  throw new Error(`Invalid Vitest CI selection: mode=${mode}, paths=${relatedPaths.length}`);
}

export function runCiVitest(selection, opts = {}) {
  const args = buildCiVitestArgs(selection);
  return (opts.runVitestArgvFn ?? runVitestArgv)(args, {
    cwd: opts.cwd ?? ROOT,
    env: opts.env ?? process.env,
    spawnSyncFn: opts.spawnSyncFn,
  });
}

function main() {
  const mode = process.env.VITEST_MODE ?? '';
  const project = process.env.VITEST_PROJECT ?? '';
  let relatedPaths = [];
  try {
    relatedPaths = parseRelatedPaths(process.env.VITEST_PATHS_JSON);
  } catch (error) {
    console.error(`ci-run-vitest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.error(`ci-run-vitest: ${mode} (${project}; ${relatedPaths.length} related path(s))`);
  process.exit(runCiVitest({ mode, project, relatedPaths }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
