// @vitest-environment node
/**
 * Contract tests for the canonical main merge-queue ruleset JSON.
 * Live ruleset id 20821455 must be updated via gh api PUT after changing this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULESET_PATH = path.join(ROOT, '.github', 'rulesets', 'main-merge-queue.json');

const REQUIRED_CONTEXTS = [
  'Build & Test',
  'Coverage (renderer-ui)',
  'Coverage (renderer-logic)',
  'Coverage (main)',
  'Merge coverage',
];

/** GitHub Actions app id used to pin required checks. */
const GITHUB_ACTIONS_INTEGRATION_ID = 15368;

describe('main-merge-queue.json contract', () => {
  const ruleset = JSON.parse(fs.readFileSync(RULESET_PATH, 'utf8'));

  it('requires one approving review and re-approval after new pushes', () => {
    const pr = ruleset.rules.find((r) => r.type === 'pull_request');
    expect(pr?.parameters?.required_approving_review_count).toBe(1);
    expect(pr?.parameters?.dismiss_stale_reviews_on_push).toBe(true);
    expect(pr?.parameters?.require_last_push_approval).toBe(true);
  });

  it('pins all required checks to GitHub Actions integration_id 15368', () => {
    const status = ruleset.rules.find((r) => r.type === 'required_status_checks');
    const checks = status?.parameters?.required_status_checks ?? [];
    expect(checks.map((c) => c.context).sort()).toEqual([...REQUIRED_CONTEXTS].sort());
    for (const check of checks) {
      expect(check.integration_id).toBe(GITHUB_ACTIONS_INTEGRATION_ID);
    }
  });

  it('keeps admin-only bypass (no Actions integration bypass)', () => {
    expect(ruleset.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ]);
  });

  it('enables merge_queue with ALLGREEN', () => {
    const mq = ruleset.rules.find((r) => r.type === 'merge_queue');
    expect(mq?.parameters?.grouping_strategy).toBe('ALLGREEN');
    expect(ruleset.enforcement).toBe('active');
  });
});
