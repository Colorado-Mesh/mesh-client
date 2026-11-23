// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { planHooksPathFix, planRustSetup } from './setup-dev.mjs';

describe('planHooksPathFix', () => {
  it('skips when there is no git directory', () => {
    expect(planHooksPathFix({ gitDirExists: false, currentHooksPath: null })).toEqual({
      action: 'skip-no-git',
      target: '.githooks',
    });
  });

  it('is ok when hooksPath is exactly .githooks', () => {
    expect(planHooksPathFix({ gitDirExists: true, currentHooksPath: '.githooks' })).toEqual({
      action: 'ok',
      target: '.githooks',
    });
  });

  it('is ok when absolute hooksPath resolves to this checkout', () => {
    const repoHooks = '/Users/me/repos/mesh-client/.githooks';
    expect(
      planHooksPathFix({
        gitDirExists: true,
        currentHooksPath: repoHooks,
        repoHooksPathResolved: repoHooks,
      }),
    ).toEqual({ action: 'ok', target: '.githooks' });
  });

  it('sets hooksPath when another checkout ends in /.githooks', () => {
    expect(
      planHooksPathFix({
        gitDirExists: true,
        currentHooksPath: '/Users/me/other-repo/.githooks',
        repoHooksPathResolved: '/Users/me/repos/mesh-client/.githooks',
      }),
    ).toEqual({ action: 'set', target: '.githooks' });
  });

  it('sets hooksPath when missing or wrong', () => {
    expect(planHooksPathFix({ gitDirExists: true, currentHooksPath: null })).toEqual({
      action: 'set',
      target: '.githooks',
    });
    expect(planHooksPathFix({ gitDirExists: true, currentHooksPath: '.husky' })).toEqual({
      action: 'set',
      target: '.githooks',
    });
  });
});

describe('planRustSetup', () => {
  it('prints rustup when cargo is missing', () => {
    expect(planRustSetup({ cargoPresent: false, clippyOk: false, hasRustup: false })).toMatchObject(
      {
        action: 'print-rustup',
        rustupRecipe: expect.stringContaining('rustup.rs'),
      },
    );
  });

  it('adds clippy via rustup when cargo is present', () => {
    expect(planRustSetup({ cargoPresent: true, clippyOk: false, hasRustup: true })).toEqual({
      action: 'add-clippy',
      rustupRecipe: expect.any(String),
    });
  });

  it('is ok when cargo and clippy are ready', () => {
    expect(planRustSetup({ cargoPresent: true, clippyOk: true, hasRustup: true }).action).toBe(
      'ok',
    );
  });
});
