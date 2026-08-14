// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  bodyHasBreakingChange,
  detectReleaseBump,
  isSupportedBreakingSubject,
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
    expect(parseConventionalSubject('Feat: Case')).toEqual({
      type: 'feat',
      breakingBang: false,
    });
    expect(parseConventionalSubject('not conventional')).toBeNull();
    expect(parseConventionalSubject('feat(unclosed: missing paren')).toBeNull();
    expect(parseConventionalSubject('feat!(scope): bang before scope')).toBeNull();
  });
});

describe('bodyHasBreakingChange', () => {
  it('matches line-anchored BREAKING CHANGE and BREAKING-CHANGE', () => {
    expect(bodyHasBreakingChange('BREAKING CHANGE: renamed\n')).toBe(true);
    expect(bodyHasBreakingChange('  BREAKING-CHANGE: renamed\n')).toBe(true);
    expect(bodyHasBreakingChange('subject\n\nBREAKING CHANGE: x')).toBe(true);
  });

  it('ignores unanchored substring mentions', () => {
    expect(
      bodyHasBreakingChange('See docs: never put BREAKING CHANGE: in examples casually\n'),
    ).toBe(false);
    expect(bodyHasBreakingChange('mentions BREAKING CHANGE: mid-sentence')).toBe(false);
  });
});

describe('isSupportedBreakingSubject', () => {
  it('accepts supported type!: / type(scope)!: including note bullets', () => {
    expect(isSupportedBreakingSubject('feat!: remove legacy')).toBe(true);
    expect(isSupportedBreakingSubject('* fix(api)!: drop field')).toBe(true);
  });

  it('rejects unsupported type!: subjects (not reported as breaking)', () => {
    expect(isSupportedBreakingSubject('revert!: undo deploy')).toBe(false);
    expect(isSupportedBreakingSubject('* wip!: unfinished')).toBe(false);
    expect(isSupportedBreakingSubject('feat: not breaking')).toBe(false);
  });
});

describe('detectReleaseBump', () => {
  it('does not treat unsupported type!: as major', () => {
    expect(detectReleaseBump(['revert!: undo', 'wip!: scratch'])).toBe('patch');
  });

  it('treats scoped feat(scope): as minor (squash-merge titles)', () => {
    expect(
      detectReleaseBump([
        'fix(ci): licenses PR flow (#850)',
        'feat(rrc): App toggle for all-room unread (#847)',
        'chore: bump deps',
      ]),
    ).toBe('minor');
  });

  it('treats unscoped feat: as minor', () => {
    expect(detectReleaseBump(['feat: add thing', 'fix: nudge'])).toBe('minor');
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

  it('detects BREAKING-CHANGE hyphen footer', () => {
    expect(detectReleaseBump(['chore: prep'], 'BREAKING-CHANGE: drop flag\n')).toBe('major');
  });

  it('does not major on unanchored BREAKING CHANGE mention', () => {
    expect(
      detectReleaseBump(
        ['docs: explain footers'],
        'Do not confuse with inline BREAKING CHANGE: examples in prose.\n',
      ),
    ).toBe('patch');
  });

  it('ignores body bullet lines that look like commits (subjects-only)', () => {
    expect(detectReleaseBump(['chore: release prep'])).toBe('patch');
  });

  it('defaults to patch when no conventional subjects', () => {
    expect(detectReleaseBump(['Merge branch main', 'WIP'])).toBe('patch');
  });

  it('defaults to patch for empty subject list', () => {
    expect(detectReleaseBump([])).toBe('patch');
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

  it('rejects invalid current / bump', () => {
    expect(() => previewNextVersion('nope', 'patch')).toThrow(/Invalid current version/);
    expect(() => previewNextVersion('1.2.3', 'weird')).toThrow(/Invalid bump/);
  });
});
