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
