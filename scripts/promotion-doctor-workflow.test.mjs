// @vitest-environment node
/**
 * Contract for `.github/workflows/promotion-doctor.yaml`: the required check on main runs
 * trusted base-branch code with read-only access and never checks out or runs the pull
 * request's code.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, '.github/workflows/promotion-doctor.yaml'), 'utf8');
const workflow = yaml.load(SOURCE);
const job = workflow.jobs.doctor;
const doctorStep = job.steps.find((step) => step.name === 'Run Promotion Doctor');

describe('promotion-doctor.yaml', () => {
  it('runs for every pull request to main and for nothing else', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request_target']);
    expect(workflow.on.pull_request_target).toEqual({
      branches: ['main'],
      types: ['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review'],
    });
  });

  it('reports under the required check name with read-only access', () => {
    expect(job.name).toBe('Promotion Doctor');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      checks: 'read',
      statuses: 'read',
    });
  });

  it('checks out only the trusted base commit, without credentials', () => {
    const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with).toEqual({
      ref: '${{ github.event.pull_request.base.sha }}',
      'fetch-depth': 0,
      'persist-credentials': false,
    });
    expect(SOURCE).not.toMatch(/pull_request\.head\.(sha|ref)/);
    expect(SOURCE).not.toMatch(/secrets\.[A-Za-z_]/);
  });

  it('never interpolates event data into a shell script', () => {
    for (const step of job.steps.filter((entry) => entry.run)) {
      expect(step.run, step.name).not.toContain('${{');
    }
  });

  it('installs nothing and restores no cache', () => {
    const setupNode = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(setupNode.with['package-manager-cache']).toBe(false);
    expect(setupNode.with.cache).toBeUndefined();
    for (const step of job.steps.filter((entry) => entry.run)) {
      expect(step.run, step.name).not.toMatch(/\b(pnpm|npm|yarn)\b/);
    }
  });

  it('runs the green-check gate inside the job timeout', () => {
    expect(doctorStep.run).toContain('node scripts/promotion-doctor.mjs --pr "$PR_NUMBER"');
    expect(doctorStep.run).toContain('--require-green-checks');
    expect(doctorStep.run).toContain('--wait-for-checks');
    const doctorMinutes = Number(/--timeout-minutes (\d+)/.exec(doctorStep.run)[1]);
    expect(job['timeout-minutes']).toBeGreaterThan(doctorMinutes);
    expect(doctorStep.env).toEqual({
      GITHUB_TOKEN: '${{ github.token }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
    });
  });

  it('replaces a superseded run for the same pull request', () => {
    expect(workflow.concurrency).toEqual({
      group: 'promotion-doctor-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    });
  });
});
