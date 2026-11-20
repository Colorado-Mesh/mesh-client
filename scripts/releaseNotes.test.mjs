// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildReleaseBody,
  buildReleaseNotes,
  extractSection,
  isBookkeepingSubject,
  prNumberFromSubject,
  releaseTitle,
  riskCallouts,
  schemaSummary,
} from './releaseNotes.mjs';

const commit = (subject, body = '') => ({ subject, body });

describe('subjects', () => {
  it('reads the trailing pull request number of a squash subject', () => {
    expect(prNumberFromSubject('feat(rrc): reactions (#12)')).toBe(12);
    expect(prNumberFromSubject('chore: release v6.9.0 (#1500)')).toBe(1500);
    expect(prNumberFromSubject('fix: see #3 for details')).toBeNull();
    expect(prNumberFromSubject('chore: release v6.9.0')).toBeNull();
  });

  it('recognises release commits as bookkeeping, squashed or not', () => {
    expect(isBookkeepingSubject('chore: release v6.9.0')).toBe(true);
    expect(isBookkeepingSubject('chore: release v6.9.0 (#1500)')).toBe(true);
    expect(isBookkeepingSubject('chore: release notes tweak (#4)')).toBe(false);
    expect(isBookkeepingSubject('chore: release v6.9.0 and docs (#4)')).toBe(false);
    expect(isBookkeepingSubject('fix: crash (#13)')).toBe(false);
  });
});

describe('buildReleaseNotes', () => {
  it('groups commits into ordered sections and drops bookkeeping', () => {
    const notes = buildReleaseNotes([
      commit('feat(rrc): reactions (#12)'),
      commit('fix: crash (#13)'),
      commit('docs: guide (#14)'),
      commit('chore: release v6.9.0'),
      commit('chore: release v6.8.1 (#11)'),
      commit('feat!: drop v5 (#15)'),
    ]);
    expect(notes).toBe(
      [
        '### Breaking changes',
        '',
        '- feat!: drop v5 (#15)',
        '',
        '### Features',
        '',
        '- feat(rrc): reactions (#12)',
        '',
        '### Fixes',
        '',
        '- fix: crash (#13)',
        '',
        '### Other changes',
        '',
        '- docs: guide (#14)',
      ].join('\n'),
    );
  });

  it('treats a BREAKING CHANGE footer as breaking', () => {
    const notes = buildReleaseNotes([
      commit('fix: tighten parser (#20)', 'Details.\n\nBREAKING CHANGE: old configs fail'),
    ]);
    expect(notes).toBe('### Breaking changes\n\n- fix: tighten parser (#20)');
  });

  it('puts non-conventional subjects under other changes', () => {
    expect(buildReleaseNotes([commit('Update README (#30)')])).toBe(
      '### Other changes\n\n- Update README (#30)',
    );
  });

  it('says so when only bookkeeping commits remain', () => {
    expect(buildReleaseNotes([commit('chore: release v6.9.0')])).toBe('No user-facing changes.');
  });
});

describe('extractSection', () => {
  const body = [
    '## Release notes',
    '',
    '### Features',
    '',
    '- feat: maps (#1)',
    '',
    '## Version',
    '',
    '6.8.0 -> 6.9.0',
  ].join('\n');

  it('returns the text under a heading up to the next level-two heading', () => {
    expect(extractSection(body, '## Release notes')).toBe('### Features\n\n- feat: maps (#1)');
    expect(extractSection(body, '## Version')).toBe('6.8.0 -> 6.9.0');
  });

  it('returns null when the heading is absent', () => {
    expect(extractSection(body, '## Database schema')).toBeNull();
  });

  it('tolerates Windows line endings from edited bodies', () => {
    expect(extractSection(body.replaceAll('\n', '\r\n'), '## Version')).toBe('6.8.0 -> 6.9.0');
  });
});

describe('titles, schema and risks', () => {
  it('titles a release pull request with the commit subject it squashes into', () => {
    expect(releaseTitle('6.9.0')).toBe('chore: release v6.9.0');
    expect(isBookkeepingSubject(`${releaseTitle('6.9.0')} (#1500)`)).toBe(true);
  });

  it('describes schema upgrades as one-way', () => {
    const summary = schemaSummary(54, 55);
    expect(summary).toContain('54');
    expect(summary).toContain('55');
    expect(summary).toContain('one-way');
    expect(schemaSummary(54, 54)).toBe('Unchanged (schema 54).');
  });

  it('calls out risky paths once per category', () => {
    expect(
      riskCallouts([
        '.github/workflows/ci.yaml',
        '.github/workflows/tests.yaml',
        'pnpm-lock.yaml',
        'src/renderer/App.tsx',
      ]),
    ).toEqual([
      'GitHub Actions workflows or actions changed',
      'Dependencies changed (package.json, lockfile or patches)',
    ]);
    expect(riskCallouts(['docs/index.md'])).toEqual([]);
  });
});

describe('buildReleaseBody', () => {
  const base = {
    notes: '### Features\n\n- feat: maps (#1)',
    fromVersion: '6.8.0',
    toVersion: '6.9.0',
    bumpReason: 'minor, detected from commit titles',
    schemaFrom: 54,
    schemaTo: 55,
    risks: ['Dependencies changed (package.json, lockfile or patches)'],
    mainSha: '1111111111111111111111111111111111111111',
    since: 'v6.8.0',
  };

  it('lays out notes, version, schema, risks and how the pull request releases', () => {
    const body = buildReleaseBody(base);
    expect(extractSection(body, '## Release notes')).toBe(base.notes);
    expect(extractSection(body, '## Version')).toBe(
      '6.8.0 -> 6.9.0 (minor, detected from commit titles)',
    );
    expect(extractSection(body, '## Database schema')).toBe(schemaSummary(54, 55));
    expect(extractSection(body, '## Risk callouts')).toBe(
      '- Dependencies changed (package.json, lockfile or patches)',
    );
    const release = extractSection(body, '## Release');
    expect(release).toContain('`main` at `1111111`');
    expect(release).toContain('since `v6.8.0`');
    expect(release).toContain('pnpm run release:open');
    expect(release).toContain('Release gates');
  });

  it('says so when no risky path changed', () => {
    const body = buildReleaseBody({ ...base, risks: [] });
    expect(extractSection(body, '## Risk callouts')).toBe('None detected.');
  });
});
