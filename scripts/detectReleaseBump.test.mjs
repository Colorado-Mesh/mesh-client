// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  detectReleaseBump,
  parseConventionalSubject,
  previewNextVersion,
} from './detectReleaseBump.mjs';

describe('parseConventionalSubject', () => {
  it('parses scoped and breaking subjects without regex', () => {
    expect(parseConventionalSubject('feat(rrc): toggle')).toEqual({
      type: 'feat',
      breakingBang: false,
    });
    expect(parseConventionalSubject('fix(reticulum)!: drop ipc')).toEqual({
      type: 'fix',
      breakingBang: true,
    });
    expect(parseConventionalSubject('not conventional')).toBeNull();
  });
});

describe('detectReleaseBump', () => {
  it('treats scoped feat(scope): as minor (squash-merge titles)', () => {
    expect(
      detectReleaseBump([
        'fix(ci): licenses PR flow (#850)',
        'feat(rrc): App toggle for all-room unread (#847)',
        'chore: bump deps',
      ]),
    ).toBe('minor');
  });

  it('does not miss feat when only scoped feats exist (historical bash bug)', () => {
    // Old bash regex ^feat[[:space:]]*: matched zero of these → wrongly patch.
    expect(
      detectReleaseBump([
        'feat(reticulum): real Ratspeak .rsi backup (#843)',
        'fix(logs): drop DEBUG spam (#844)',
        'docs: Reticulum ownership layers (#842)',
      ]),
    ).toBe('minor');
  });

  it('returns patch for fix/chore/docs only', () => {
    expect(
      detectReleaseBump([
        'fix(ci): keep NSIS stub (#840)',
        'chore(ci): merge queue support (#849)',
        'docs: generate third-party licenses (#846)',
      ]),
    ).toBe('patch');
  });

  it('detects breaking via type!: and type(scope)!:', () => {
    expect(detectReleaseBump(['feat!: remove legacy API'])).toBe('major');
    expect(detectReleaseBump(['fix(reticulum)!: drop old IPC'])).toBe('major');
  });

  it('detects BREAKING CHANGE footer in bodies', () => {
    expect(
      detectReleaseBump(['feat(app): new thing'], 'BREAKING CHANGE: config keys renamed\n'),
    ).toBe('major');
  });

  it('ignores body bullet lines that look like commits (subjects-only)', () => {
    expect(detectReleaseBump(['chore: release prep'])).toBe('patch');
  });

  it('defaults to patch when no conventional subjects', () => {
    expect(detectReleaseBump(['Merge branch main', 'WIP'])).toBe('patch');
  });
});

describe('previewNextVersion', () => {
  it('bumps patch/minor/major', () => {
    expect(previewNextVersion('5.27.1', 'patch')).toBe('5.27.2');
    expect(previewNextVersion('5.27.1', 'minor')).toBe('5.28.0');
    expect(previewNextVersion('5.27.1', 'major')).toBe('6.0.0');
  });

  it('accepts exact versions', () => {
    expect(previewNextVersion('5.27.1', '5.30.0')).toBe('5.30.0');
  });
});
