// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const loadWorkflow = (name) => yaml.load(read(`.github/workflows/${name}.yaml`));

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

  it('publishes docs with masked basic auth scoped to the deploy step', () => {
    const source = read('.github/workflows/docs.yml');
    const workflow = yaml.load(source);
    const deployCheckout = workflow.jobs.deploy.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(deployCheckout.with['persist-credentials']).toBe(false);
    const publish = workflow.jobs.deploy.steps.find((step) => step.name === 'Publish docs');
    expect(publish.env).toEqual({ GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' });
    expect(publish.run).toContain(
      'header="AUTHORIZATION: basic $(printf \'x-access-token:%s\' "$GH_TOKEN" | base64 -w0)"',
    );
    expect(publish.run).toContain('echo "::add-mask::${header}"');
    expect(publish.run).toContain('export GIT_CONFIG_COUNT=1');
    expect(publish.run).toContain("export GIT_CONFIG_KEY_0='http.https://github.com/.extraheader'");
    expect(publish.run).toContain('export GIT_CONFIG_VALUE_0="$header"');
    expect(publish.run).toContain('mkdocs gh-deploy --force');
    expect(source).not.toContain('AUTHORIZATION: bearer');
    for (const job of [workflow.jobs.build, workflow.jobs.deploy]) {
      for (const step of job.steps) {
        if (step === publish) continue;
        expect(step.env ?? {}).not.toHaveProperty('GH_TOKEN');
        expect(JSON.stringify(step.env ?? {})).not.toContain('secrets.GITHUB_TOKEN');
      }
    }
  });

  it('pins docs Python to a version with wheels for the hash-locked requirements', () => {
    // pyyaml==6.0.3 (docs/requirements.txt, --only-binary=:all:) has no cp315
    // wheel; unpinned 3.x intermittently resolves to 3.15 and the pip install
    // fails with "No matching distribution found for pyyaml==6.0.3".
    const workflow = yaml.load(read('.github/workflows/docs.yml'));
    for (const job of [workflow.jobs.build, workflow.jobs.deploy]) {
      const setupPython = job.steps.find((step) => step.uses?.startsWith('actions/setup-python@'));
      expect(setupPython.with['python-version']).toBe('3.14');
    }
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
    const stepNames = licenses.jobs.update.steps.map((step) => step.name);
    expect(stepNames).toContain(
      'Clone Ratspeak stack (rsReticulum, rsLXMF, rsNomad, rsLXST, lrgp-rs)',
    );
    expect(stepNames).toContain('Refuse Rust-section stub');
    expect(source).toContain('dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8');
    const createPr = licenses.jobs.update.steps.find((step) => step.name === 'Create pull request');
    expect(createPr.with.token).toBe('${{ secrets.LICENSE_PR_TOKEN }}');
    expect(createPr.with['add-paths'].trim()).toBe('docs/third-party-licenses.md');
    expect(stepNames).toContain('Require LICENSE_PR_TOKEN for unattended merge');
    expect(stepNames).toContain('Admin-merge license documentation PR');
    expect(source).toContain('gh pr merge');
    expect(source).toContain('--admin');
    expect(source).toContain('--match-head-commit');
    expect(source).toContain('steps.cpr.outputs.pull-request-head-sha');
    // Merge queue rejects `gh pr merge --delete-branch`; delete the ref separately.
    expect(source).not.toMatch(/gh pr merge[\s\S]*--delete-branch/);
    expect(source).toContain('git/refs/heads/');
    expect(source).not.toMatch(
      /RELEASE_(?:PUSH|CUT)_TOKEN|environment: release|refs\/tags|pnpm run release|gh release/,
    );
    expect(source).not.toContain('github.token');
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

  it('labels PRs from the trusted base ref only', () => {
    const workflow = loadWorkflow('labeler');
    const source = read('.github/workflows/labeler.yaml');
    expect(workflow.on.pull_request_target.types).toEqual([
      'opened',
      'edited',
      'reopened',
      'synchronize',
      'ready_for_review',
    ]);
    expect(workflow.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
    const checkout = workflow.jobs.label.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout.with).toMatchObject({
      ref: '${{ github.event.pull_request.base.sha }}',
      'persist-credentials': false,
    });
    expect(source).not.toContain('github.event.pull_request.head');
    expect(source).not.toContain('pull_request.head.sha');
  });

  it('keeps the completed one-time secret migration removed', () => {
    expect(existsSync('.github/workflows/migrate-release-secrets.yaml')).toBe(false);
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

  it('records an active main merge queue ruleset with admin bypass', () => {
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
  });
});
