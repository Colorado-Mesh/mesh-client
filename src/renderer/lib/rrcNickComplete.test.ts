import { describe, expect, it } from 'vitest';

import {
  findRrcAtMentionAtCaret,
  insertRrcNickMention,
  listRrcNickCompleteCandidates,
  nextRrcNickCompleteIndex,
  rrcMemberNickLabels,
} from './rrcNickComplete';

describe('rrcMemberNickLabels', () => {
  it('prefers nicknames and dedupes case-insensitively', () => {
    expect(
      rrcMemberNickLabels([
        { identity_hash: 'aa'.repeat(16), nickname: 'Zeva' },
        { identity_hash: 'bb'.repeat(16), nickname: 'zeva' },
        { identity_hash: 'cc'.repeat(16), nickname: null },
        { identity_hash: 'dd'.repeat(16), nickname: 'nv0n' },
      ]),
    ).toEqual(['Zeva', 'nv0n']);
  });
});

describe('listRrcNickCompleteCandidates', () => {
  const nicks = ['Zeva', 'Zoe', 'nv0n', 'alice'];

  it('filters by case-insensitive prefix', () => {
    expect(listRrcNickCompleteCandidates(nicks, 'z')).toEqual(['Zeva', 'Zoe']);
    expect(listRrcNickCompleteCandidates(nicks, 'ze')).toEqual(['Zeva']);
    expect(listRrcNickCompleteCandidates(nicks, 'NV')).toEqual(['nv0n']);
  });

  it('returns capped list for empty query', () => {
    expect(listRrcNickCompleteCandidates(nicks, '', 2)).toEqual(['Zeva', 'Zoe']);
  });
});

describe('findRrcAtMentionAtCaret', () => {
  it('finds @query before caret', () => {
    expect(findRrcAtMentionAtCaret('hi @ze', 6)).toEqual({ start: 3, query: 'ze' });
    expect(findRrcAtMentionAtCaret('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('returns null when not in an @ token', () => {
    expect(findRrcAtMentionAtCaret('hi zeva', 7)).toBeNull();
    expect(findRrcAtMentionAtCaret('a@b', 3)).toBeNull();
  });
});

describe('insertRrcNickMention', () => {
  it('inserts plain IRC @nick with trailing space', () => {
    const r = insertRrcNickMention('hi @ze', 3, 2, 'Zeva');
    expect(r.text).toBe('hi @Zeva ');
    expect(r.caret).toBe('hi @Zeva '.length);
    expect(r.text).not.toContain('@[');
  });

  it('cycles without stacking spaces', () => {
    const first = insertRrcNickMention('@ze', 0, 2, 'Zeva');
    expect(first.text).toBe('@Zeva ');
    const second = insertRrcNickMention(first.text, 0, 'Zeva'.length, 'Zoe');
    expect(second.text).toBe('@Zoe ');
  });

  it('leaves mid-line text intact', () => {
    const r = insertRrcNickMention('hey @ze check', 4, 2, 'Zeva');
    expect(r.text).toBe('hey @Zeva check');
  });
});

describe('nextRrcNickCompleteIndex', () => {
  it('cycles forward and reverse', () => {
    expect(nextRrcNickCompleteIndex(['a', 'b', 'c'], -1, false)).toBe(0);
    expect(nextRrcNickCompleteIndex(['a', 'b', 'c'], 0, false)).toBe(1);
    expect(nextRrcNickCompleteIndex(['a', 'b', 'c'], 2, false)).toBe(0);
    expect(nextRrcNickCompleteIndex(['a', 'b', 'c'], -1, true)).toBe(2);
    expect(nextRrcNickCompleteIndex(['a', 'b', 'c'], 0, true)).toBe(2);
  });

  it('returns -1 for empty candidates', () => {
    expect(nextRrcNickCompleteIndex([], -1, false)).toBe(-1);
  });
});
