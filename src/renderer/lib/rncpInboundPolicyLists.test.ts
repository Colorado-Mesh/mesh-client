import { describe, expect, it } from 'vitest';

import { policiesToRncpLists } from './rncpInboundPolicyLists';

describe('policiesToRncpLists', () => {
  it('splits allow/block decisions and lowercases hashes', () => {
    const { allowed, blocked } = policiesToRncpLists([
      {
        identity_hash: 'AA'.repeat(16),
        decision: 'allow',
        label: null,
        auto_save_dir: null,
        created_at: 1,
        updated_at: 1,
      },
      {
        identity_hash: 'BB'.repeat(16),
        decision: 'block',
        label: null,
        auto_save_dir: null,
        created_at: 1,
        updated_at: 1,
      },
    ]);
    expect(allowed).toEqual(['aa'.repeat(16)]);
    expect(blocked).toEqual(['bb'.repeat(16)]);
  });

  it('accepts a Map of policies', () => {
    const map = new Map([
      [
        'cc'.repeat(16),
        {
          identity_hash: 'cc'.repeat(16),
          decision: 'allow' as const,
          label: null,
          auto_save_dir: null,
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    expect(policiesToRncpLists(map).allowed).toEqual(['cc'.repeat(16)]);
  });
});
