// @vitest-environment node
/**
 * Contract tests for the canonical branch rulesets in .github/rulesets/.
 *
 * staging-merge-queue.json: every feature pull request lands on staging through this squash
 * merge queue. main-promotions.json: main takes merge-commit promotions and hotfixes only
 * (live ruleset id 20821455). Changing a file here does not change GitHub: apply it with the
 * gh api commands in docs/ci-cd.md, or the live ruleset drifts until someone does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { DOCTOR_CHECK_NAME } from './promotion-doctor.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} relativePath */
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

/** GitHub Actions app id used to pin required checks. */
const GITHUB_ACTIONS_INTEGRATION_ID = 15368;

/** Checks every pull request must pass, whichever branch it targets. */
const PULL_REQUEST_CHECKS = [
  'Build & Test',
  'Coverage (renderer-ui)',
  'Coverage (renderer-logic)',
  'Coverage (main)',
  'Merge coverage',
];

const ADMIN_BYPASS = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];

const REVIEW_RULES = {
  required_approving_review_count: 1,
  dismiss_stale_reviews_on_push: true,
  require_code_owner_review: false,
  require_last_push_approval: true,
  required_review_thread_resolution: false,
};

/** @param {string[]} contexts */
function pinnedChecks(contexts) {
  return contexts.map((context) => ({ context, integration_id: GITHUB_ACTIONS_INTEGRATION_ID }));
}

/**
 * @param {{ rules: Array<{ type: string, parameters?: Record<string, any> }> }} ruleset
 * @param {string} type
 */
function ruleParameters(ruleset, type) {
  const rule = ruleset.rules.find((candidate) => candidate.type === type);
  if (!rule?.parameters) throw new Error(`ruleset has no ${type} rule with parameters`);
  return rule.parameters;
}

describe('staging-merge-queue.json', () => {
  const ruleset = readJson('.github/rulesets/staging-merge-queue.json');

  it('is the squash merge queue main had before staging, retargeted to staging', () => {
    expect(ruleset).toEqual({
      name: 'staging merge queue',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/staging'], exclude: [] } },
      bypass_actors: ADMIN_BYPASS,
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        {
          type: 'pull_request',
          parameters: { ...REVIEW_RULES, allowed_merge_methods: ['squash', 'rebase'] },
        },
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: true,
            do_not_enforce_on_create: false,
            required_status_checks: pinnedChecks(PULL_REQUEST_CHECKS),
          },
        },
        {
          type: 'merge_queue',
          parameters: {
            merge_method: 'SQUASH',
            max_entries_to_build: 5,
            min_entries_to_merge: 1,
            max_entries_to_merge: 5,
            min_entries_to_merge_wait_minutes: 0,
            check_response_timeout_minutes: 90,
            grouping_strategy: 'ALLGREEN',
          },
        },
      ],
    });
  });
});

describe('main-promotions.json', () => {
  const ruleset = readJson('.github/rulesets/main-promotions.json');

  it('is an active main ruleset with admin-only bypass', () => {
    expect(ruleset).toMatchObject({
      name: 'main promotions',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
    });
    expect(ruleset.bypass_actors).toEqual(ADMIN_BYPASS);
  });

  it('allows merge commits only, so a promotion keeps the staging history it carries', () => {
    expect(ruleParameters(ruleset, 'pull_request')).toEqual({
      ...REVIEW_RULES,
      allowed_merge_methods: ['merge'],
    });
  });

  it('requires the pull request checks plus Promotion Doctor, pinned to GitHub Actions', () => {
    expect(ruleParameters(ruleset, 'required_status_checks')).toEqual({
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: pinnedChecks([...PULL_REQUEST_CHECKS, 'Promotion Doctor']),
    });
  });

  it('blocks deletion and force pushes, and has no merge queue', () => {
    // Promotion Doctor runs on pull_request_target only, never on merge_group, so a merge
    // queue on main would wait for a required check that cannot report.
    expect(ruleset.rules.map(({ type }) => type)).toEqual([
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_status_checks',
    ]);
  });

  it('names the Promotion Doctor check exactly as its workflow job and script do', () => {
    const workflow = /** @type {{ jobs: Record<string, { name?: string }> }} */ (
      yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows/promotion-doctor.yaml'), 'utf8'))
    );
    const contexts = ruleParameters(ruleset, 'required_status_checks').required_status_checks.map(
      (/** @type {{ context: string }} */ check) => check.context,
    );
    expect(workflow.jobs.doctor.name).toBe(DOCTOR_CHECK_NAME);
    expect(contexts).toContain(DOCTOR_CHECK_NAME);
  });
});

// GitHub's default Actions event policy blocks pull_request_target in public repositories from
// 2026-12-02. This repository policy allows it again for the Promotion Doctor workflow alone.
describe('actions-policies/promotion-doctor.json', () => {
  const policy = readJson('.github/actions-policies/promotion-doctor.json');

  it('allows pull_request_target for the Promotion Doctor workflow and nothing else', () => {
    expect(policy).toEqual({
      name: 'Allow the Promotion Doctor trigger',
      enforcement: 'active',
      conditions: {
        workflow_path: { include: ['.github/workflows/promotion-doctor.yaml'], exclude: [] },
      },
      rules: [
        {
          type: 'restrict_action_events',
          parameters: { allowed_events: ['pull_request_target'] },
        },
      ],
    });
  });

  it('allows every event the Promotion Doctor workflow listens to', () => {
    // The event rule is an allowlist for the targeted workflow, so a trigger added to the
    // workflow without this policy would be blocked.
    const workflow = /** @type {{ on: Record<string, unknown> }} */ (
      yaml.load(
        fs.readFileSync(path.join(ROOT, policy.conditions.workflow_path.include[0]), 'utf8'),
      )
    );
    expect(Object.keys(workflow.on)).toEqual(policy.rules[0].parameters.allowed_events);
  });
});
