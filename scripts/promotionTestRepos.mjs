/**
 * Test-only fixtures for the promotion tooling: a bare remote released at v1.0.0 with `main`
 * and `staging`, a seed checkout that lands commits as merged pull requests would, and a user
 * clone where the commands under test run. Imported only by `scripts/*.test.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIXTURE_METAINFO = 'flatpak/org.coloradomesh.MeshClient.metainfo.xml';
const created = [];

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export function run(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** @param {string} repo */
function configure(repo) {
  run(repo, ['config', 'user.name', 'test']);
  run(repo, ['config', 'user.email', 'test@example.com']);
  run(repo, ['config', 'commit.gpgsign', 'false']);
  run(repo, ['config', 'tag.gpgsign', 'false']);
}

/**
 * @param {string} repo
 * @param {Record<string, string>} files
 */
export function writeFiles(repo, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
  }
}

/**
 * @param {{ withStaging?: boolean }} [options]
 * @returns {{ remote: string, seed: string, user: string }}
 */
export function released({ withStaging = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-promotion-fixture-'));
  created.push(root);
  const remote = path.join(root, 'remote.git');
  run(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const seed = path.join(root, 'seed');
  run(root, ['init', '-q', '-b', 'main', seed]);
  configure(seed);
  writeFiles(seed, {
    'package.json': '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n',
    [FIXTURE_METAINFO]:
      '<component>\n  <releases>\n    <release version="1.0.0" date="2026-01-01"/>\n  </releases>\n</component>\n',
    'src/main/db-schema-sync.ts': 'export const CURRENT_SCHEMA_VERSION = 7;\n',
    'README.md': 'base\n',
  });
  run(seed, ['add', '-A']);
  run(seed, ['commit', '-q', '-m', 'chore: release v1.0.0']);
  run(seed, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
  run(seed, ['remote', 'add', 'origin', remote]);
  run(seed, ['push', '-q', 'origin', 'main', '--tags']);
  if (withStaging) run(seed, ['push', '-q', 'origin', 'main:staging']);
  const user = path.join(root, 'user');
  run(root, ['clone', '-q', remote, user]);
  configure(user);
  return { remote, seed, user };
}

/**
 * Land a commit on a remote branch, as a merged pull request would.
 * @param {string} seed
 * @param {string} branch
 * @param {Record<string, string>} files
 * @param {string} message
 */
export function land(seed, branch, files, message) {
  run(seed, ['fetch', '-q', 'origin']);
  run(seed, ['checkout', '-q', '-B', branch, `origin/${branch}`]);
  writeFiles(seed, files);
  run(seed, ['add', '-A']);
  run(seed, ['commit', '-q', '-m', message]);
  run(seed, ['push', '-q', 'origin', `HEAD:${branch}`]);
}

/** Remove every fixture created since the last call. */
export function cleanupRepos() {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
