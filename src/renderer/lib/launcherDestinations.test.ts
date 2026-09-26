import { describe, expect, it } from 'vitest';

import { findLauncherDestinations, type LauncherContactItem } from './launcherDestinations';

function contact(name: string, id = name): LauncherContactItem {
  return { id, name, search: `${name} ${id}`.toLowerCase() };
}

describe('findLauncherDestinations', () => {
  it('returns nothing for an empty query', () => {
    expect(findLauncherDestinations([contact('Trail Dave')], '  ')).toEqual({
      matches: [],
      more: false,
    });
  });

  it('puts prefix matches before matches elsewhere in the text', () => {
    const items = [contact('Mesa HQ'), contact('Ridge Fox'), contact('Fox Hollow')];
    expect(findLauncherDestinations(items, 'fox').matches.map((c) => c.name)).toEqual([
      'Fox Hollow',
      'Ridge Fox',
    ]);
  });

  it('caps results and says when there are more', () => {
    const items = Array.from({ length: 20 }, (_, i) => contact(`Node ${String(i)}`));
    const result = findLauncherDestinations(items, 'node', 5);
    expect(result.matches).toHaveLength(5);
    expect(result.more).toBe(true);
    expect(findLauncherDestinations(items.slice(0, 3), 'node', 5).more).toBe(false);
  });

  it('stays fast on 100,000 contacts', () => {
    const items = Array.from({ length: 100_000 }, (_, i) =>
      contact(`Station ${String(i)}`, (0x10000000 + i).toString(16)),
    );
    const start = performance.now();
    for (const q of ['s', 'station 9', 'zzz-no-match', '1000abc']) {
      findLauncherDestinations(items, q);
    }
    // Four full keystrokes, including two full scans with no hits, well under a frame each.
    expect(performance.now() - start).toBeLessThan(250);
  });
});
