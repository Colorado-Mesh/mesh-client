// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { computeLabels } from './label-pr.mjs';

describe('computeLabels', () => {
  it('maps Conventional Commits prefixes to type labels', () => {
    expect(computeLabels({ title: 'feat: add thing' })).toEqual(['enhancement']);
    expect(computeLabels({ title: 'fix: repair thing' })).toEqual(['bug']);
    expect(computeLabels({ title: 'docs: update thing' })).toEqual(['documentation']);
    expect(computeLabels({ title: 'chore: tidy thing' })).toEqual(['chore']);
    expect(computeLabels({ title: 'refactor: move thing' })).toEqual(['chore']);
  });

  it('handles breaking-change and scoped titles', () => {
    expect(computeLabels({ title: 'feat!: drop thing' })).toEqual(['enhancement']);
    expect(computeLabels({ title: 'fix(meshtastic): repair thing' })).toEqual([
      'bug',
      'meshtastic',
    ]);
  });

  it('maps protocol and platform scopes', () => {
    expect(computeLabels({ title: 'feat(meshcore): add thing' })).toEqual([
      'enhancement',
      'meshcore',
    ]);
    expect(computeLabels({ title: 'fix(reticulum): repair thing' })).toEqual(['bug', 'reticulum']);
    expect(computeLabels({ title: 'fix(windows): repair installer' })).toEqual(['bug', 'windows']);
    expect(computeLabels({ title: 'fix(win): repair installer' })).toEqual(['bug', 'windows']);
    expect(computeLabels({ title: 'chore(flatpak): bump runtime' })).toEqual(['chore', 'flatpak']);
  });

  it('ignores unknown scopes', () => {
    expect(computeLabels({ title: 'feat(unknown): add thing' })).toEqual(['enhancement']);
  });

  it('returns nothing for non-conventional titles', () => {
    expect(computeLabels({ title: 'Joe/radio modules parity' })).toEqual([]);
    expect(computeLabels({})).toEqual([]);
  });

  it('maps high-confidence changed paths', () => {
    expect(
      computeLabels({ title: 'chore: x', changedFiles: ['reticulum-sidecar/src/main.rs'] }),
    ).toEqual(['chore', 'reticulum']);
    expect(
      computeLabels({ title: 'chore: x', changedFiles: ['src/renderer/lib/meshcore/foo.ts'] }),
    ).toEqual(['chore', 'meshcore']);
    expect(
      computeLabels({
        title: 'chore: x',
        changedFiles: ['src/main/ipc/reticulum-db-handlers.ts'],
      }),
    ).toEqual(['chore', 'reticulum']);
    expect(
      computeLabels({ title: 'chore: x', changedFiles: ['.github/workflows/flatpak.yaml'] }),
    ).toEqual(['chore', 'flatpak']);
  });

  it('de-duplicates labels across title and paths', () => {
    expect(
      computeLabels({
        title: 'fix(reticulum): repair thing',
        changedFiles: ['reticulum-sidecar/src/main.rs', 'src/renderer/lib/reticulum/a.ts'],
      }),
    ).toEqual(['bug', 'reticulum']);
  });

  it('ignores unrelated paths', () => {
    expect(
      computeLabels({ title: 'fix: x', changedFiles: ['README.md', 'src/main/index.ts'] }),
    ).toEqual(['bug']);
  });
});
