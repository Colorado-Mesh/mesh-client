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

export function normalizeRelatedPathForVitest(filePath) {
  return filePath.startsWith('-') ? `./${filePath}` : filePath;
}

export function buildCiVitestArgs({ mode, project, relatedPaths = [], shard = '' }) {
  if (!PROJECTS.has(project)) throw new Error(`Unknown Vitest project: ${project}`);
  if (shard) {
    const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[1]) > Number(match[2])) {
      throw new Error(`Invalid Vitest shard: ${shard}`);
    }
  }

  const reportSuffix = shard ? `-${shard.replace('/', '-')}` : '';
  const shardArgs = [
    '--project',
    project,
    '--passWithNoTests',
    ...(shard ? [`--shard=${shard}`] : []),
  ];
  if (mode === 'full') {
    return [
      'run',
      '--coverage',
      '--coverage.clean=false',
      ...shardArgs,
      '--reporter=blob',
      `--outputFile.blob=.vitest-reports/blob-${project}${reportSuffix}.json`,
    ];
  }
  if (mode === 'related' && relatedPaths.length > 0) {
    return [
      'related',
      '--run',
      ...shardArgs,
      '--reporter=default',
      '--reporter=junit',
      `--outputFile.junit=test-results/junit-${project}${reportSuffix}.xml`,
      ...relatedPaths.map(normalizeRelatedPathForVitest),
    ];
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
  const shard = process.env.VITEST_SHARD ?? '';
  let relatedPaths = [];
  try {
    relatedPaths = parseRelatedPaths(process.env.VITEST_PATHS_JSON);
  } catch (error) {
    console.error(`ci-run-vitest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.error(`ci-run-vitest: ${mode} (${project}; ${relatedPaths.length} related path(s))`);
  process.exit(runCiVitest({ mode, project, relatedPaths, shard }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
