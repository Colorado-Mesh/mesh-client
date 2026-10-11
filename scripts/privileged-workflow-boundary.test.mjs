// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const loadWorkflow = (name) => yaml.load(read(`.github/workflows/${name}.yaml`));

const repositorySecretNames = [
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'CSC_KEY_PASSWORD',
  'CSC_LINK',
  'RELEASE_PUSH_TOKEN',
  'RELEASE_CUT_TOKEN',
];
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function migrationStep(name) {
  return loadWorkflow('migrate-release-secrets').jobs.migrate.steps.find(
    (step) => step.name === name,
  ).run;
}

function fakeGh(source) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-release-boundary-'));
  tempDirs.push(dir);
  const executable = path.join(dir, 'gh');
  writeFileSync(executable, `#!/usr/bin/env bash\nset -euo pipefail\n${source}\n`);
  chmodSync(executable, 0o700);
  return dir;
}

describe('privileged workflow boundaries', () => {
  it('keeps arbitrary-ref binary builds unconditionally unsigned', () => {
    const source = read('.github/workflows/build.yaml');
    expect(source).not.toMatch(/secrets\.(?:APPLE_|CSC_)/);
    expect(source).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(loadWorkflow('build').jobs.build.permissions).toEqual({ contents: 'read' });
  });

  it('runs official releases only for protected tags and protected jobs', () => {
    const workflow = loadWorkflow('release');
    const source = read('.github/workflows/release.yaml');
    expect(workflow.on.workflow_dispatch).toBeUndefined();
    expect(workflow.on.push.tags).toEqual(['v*']);
    expect(source).toContain('^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(source).toContain('RELEASE_REF_PROTECTED: ${{ github.ref_protected }}');
    expect(source).toContain('[ "${RELEASE_REF_PROTECTED}" != \'true\' ]');
    expect(source).not.toContain('RELEASE_PUSH_TOKEN');
    for (const job of [
      'prepare-github-release',
      'release',
      'finalize-github-release',
      'packaging-smoke',
    ]) {
      expect(workflow.jobs[job].environment, job).toBe('release');
    }
    for (const jobName of ['resolve-release-matrix', 'release', 'sidecars']) {
      const job = workflow.jobs[jobName];
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
      expect(needs, jobName).toEqual(
        expect.arrayContaining(['authorize-release', 'prepare-github-release']),
      );
      const condition = String(job.if);
      expect(condition, jobName).toContain("needs.authorize-release.result == 'success'");
      expect(condition, jobName).toContain("needs.prepare-github-release.result == 'success'");
      expect(condition, jobName).not.toContain('!cancelled()');
      expect(condition, jobName).not.toContain("!= 'failure'");
    }
  });

  it('binds release cutting to its trusted main environment', () => {
    const cut = loadWorkflow('cut-release');
    expect(cut.jobs.release.if).toBe("github.ref == 'refs/heads/main'");
    expect(cut.jobs.release.environment).toBe('release-cut');
    expect(read('.github/workflows/cut-release.yaml')).not.toContain('secrets.RELEASE_PUSH_TOKEN');
  });

  it('keeps license maintenance separate from release authority', () => {
    const licenses = loadWorkflow('third-party-licenses');
    const source = read('.github/workflows/third-party-licenses.yaml');
    expect(licenses.on.workflow_dispatch).toBeUndefined();
    expect(licenses.on.push.branches).toEqual(['main']);
    expect(licenses.jobs.update.environment).toBe('license-automation');
    expect(licenses.permissions).toEqual({ contents: 'read' });
    expect(licenses.jobs.update.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
    });
    const createPr = licenses.jobs.update.steps.find((step) => step.name === 'Create pull request');
    expect(createPr.with.token).toBe('${{ secrets.LICENSE_PR_TOKEN || github.token }}');
    expect(createPr.with['add-paths'].trim()).toBe('docs/third-party-licenses.md');
    expect(source).not.toMatch(
      /RELEASE_(?:PUSH|CUT)_TOKEN|environment: release|refs\/tags|pnpm run release|gh release/,
    );
  });

  it('makes release repair explicit, main-only, and protected', () => {
    const workflow = loadWorkflow('repair-published-release-tag');
    const source = read('.github/workflows/repair-published-release-tag.yaml');
    expect(workflow.on.release).toBeUndefined();
    expect(workflow.on.workflow_dispatch.inputs.release_tag.required).toBe(true);
    expect(workflow.jobs.repair.if).toBe("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.repair.environment).toBe('release-repair');
    expect(workflow.jobs.repair.steps[0].with).toMatchObject({
      ref: 'main',
      'persist-credentials': false,
    });
    expect(source).not.toContain('github.event.release');
    expect(source).not.toContain('RELEASE_PUSH_TOKEN');
  });

  it('protects only the privileged Flatpak publish phase', () => {
    const workflow = loadWorkflow('flatpak');
    expect(workflow.jobs.flatpak.environment).toBeUndefined();
    expect(workflow.jobs.publish.environment).toBe('release');
    expect(workflow.jobs.publish.if).toContain("github.event_name == 'push'");
    expect(read('.github/workflows/flatpak.yaml')).toContain(
      '^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$',
    );
    expect(read('.github/workflows/flatpak.yaml')).toContain(
      'RELEASE_REF_PROTECTED: ${{ github.ref_protected }}',
    );
  });

  it('migrates repository secrets once from trusted main, then removes itself', () => {
    const workflow = loadWorkflow('migrate-release-secrets');
    const source = read('.github/workflows/migrate-release-secrets.yaml');
    expect(workflow.on).toEqual({
      push: {
        branches: ['main'],
        paths: ['.github/workflows/migrate-release-secrets.yaml'],
      },
    });
    expect(workflow.jobs.migrate.environment).toBe('release-cut');
    expect(workflow.concurrency).toEqual({
      group: 'migrate-release-secrets',
      'cancel-in-progress': false,
    });
    for (const name of repositorySecretNames) {
      expect(source).toContain(`secrets.${name}`);
    }
    expect(source).toContain('secrets.RELEASE_PUSH_TOKEN || secrets.RELEASE_CUT_TOKEN');
    expect(source).toContain('require_environment release');
    expect(source).toContain('repos/${REPO}/rulesets/${ruleset_id}');
    expect(source).toContain('if grep -Fxq "${name}" <<<"${existing}"');
    expect(source).toContain(
      'reconcile_secret release-cut RELEASE_CUT_TOKEN "${RELEASE_PUSH_TOKEN:-${RELEASE_CUT_TOKEN:-}}"',
    );
    expect(source).not.toContain('LICENSE_AUTOMATION_TOKEN');
    expect(source).not.toContain('migration_token=');
    expect(source).toContain('for attempt in 1 2 3 4 5');
    expect(source).toContain('sleep "$((attempt * retry_delay_seconds))"');
    expect(source).toContain('repos/${REPO}/contents/${path}?ref=main');
    expect(source).not.toContain('git push');
  });

  it('resumes cleanup when only a subset of repository secrets remains', () => {
    const dir = fakeGh(`
if [ "$1" = secret ] && [ "$2" = list ]; then
  cat "$FAKE_SECRET_STATE"
elif [ "$1" = secret ] && [ "$2" = delete ]; then
  grep -Fxv "$3" "$FAKE_SECRET_STATE" >"$FAKE_SECRET_STATE.next" || true
  mv "$FAKE_SECRET_STATE.next" "$FAKE_SECRET_STATE"
else
  exit 97
fi`);
    const state = path.join(dir, 'secrets');
    writeFileSync(state, 'APPLE_ID\nCSC_LINK\nRELEASE_PUSH_TOKEN\nKEEP\n');
    const result = spawnSync(
      'bash',
      ['-c', migrationStep('Delete repository-wide credentials idempotently')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FAKE_SECRET_STATE: state,
          GH_TOKEN: 'test',
          REPO: 'Colorado-Mesh/mesh-client',
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(state, 'utf8')).toBe('KEEP\n');
  });

  it('retries self-removal against a fresh main SHA after races', () => {
    const dir = fakeGh(`
count=$(cat "$FAKE_DELETE_COUNT")
if [[ " $* " == *" --method DELETE "* ]]; then
  count=$((count + 1))
  printf '%s' "$count" >"$FAKE_DELETE_COUNT"
  [ "$count" -ge 3 ]
elif [ "$1" = api ]; then
  printf '{"sha":"sha-%s"}\\n' "$count"
else
  exit 98
fi`);
    const count = path.join(dir, 'count');
    writeFileSync(count, '0');
    const result = spawnSync(
      'bash',
      ['-c', migrationStep('Remove completed migration workflow with race retries')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FAKE_DELETE_COUNT: count,
          MIGRATION_RETRY_DELAY_SECONDS: '0',
          GH_TOKEN: 'test',
          REPO: 'Colorado-Mesh/mesh-client',
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(count, 'utf8')).toBe('3');
  });

  it('fails closed when migration workflow metadata cannot be read', () => {
    const dir = fakeGh(`
count=$(cat "$FAKE_METADATA_COUNT")
count=$((count + 1))
printf '%s' "$count" >"$FAKE_METADATA_COUNT"
echo 'gh: transient API failure' >&2
exit 1`);
    const count = path.join(dir, 'count');
    writeFileSync(count, '0');
    const result = spawnSync(
      'bash',
      ['-c', migrationStep('Remove completed migration workflow with race retries')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          FAKE_METADATA_COUNT: count,
          MIGRATION_RETRY_DELAY_SECONDS: '0',
          GH_TOKEN: 'test',
          REPO: 'Colorado-Mesh/mesh-client',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gh: transient API failure');
    expect(readFileSync(count, 'utf8')).toBe('5');
  });

  it('accepts only a confirmed 404 as already removed', () => {
    const dir = fakeGh(`
echo 'gh: Not Found (HTTP 404)' >&2
exit 1`);
    const result = spawnSync(
      'bash',
      ['-c', migrationStep('Remove completed migration workflow with race retries')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_TOKEN: 'test',
          REPO: 'Colorado-Mesh/mesh-client',
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('already absent from main');
  });

  it('records an active v* tag ruleset that blocks creation, updates, and deletion', () => {
    const ruleset = JSON.parse(read('.github/rulesets/release-tags.json'));
    expect(ruleset).toMatchObject({
      name: 'release tags',
      target: 'tag',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/tags/v*'] } },
    });
    expect(ruleset.rules.map(({ type }) => type).sort()).toEqual([
      'creation',
      'deletion',
      'update',
    ]);
    expect(ruleset.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ]);
  });

  it('requires the committed main merge queue ruleset before secret migration', () => {
    const ruleset = JSON.parse(read('.github/rulesets/main-merge-queue.json'));
    expect(ruleset).toMatchObject({
      name: 'main merge queue',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    });
    expect(ruleset.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ]);
    const source = read('.github/workflows/migrate-release-secrets.yaml');
    expect(source).toContain('main merge queue');
    expect(source).toContain('The active main merge queue ruleset is missing.');
    expect(source).toContain('.github/rulesets/main-merge-queue.json');
    expect(source).toContain('.conditions.ref_name.exclude');
    expect(source).toContain('RELEASE_CUT_TOKEN');
    expect(source).not.toMatch(/--method\s+(POST|PUT|PATCH)/);
  });
});
