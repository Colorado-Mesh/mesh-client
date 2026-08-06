import { afterEach, describe, expect, it } from 'vitest';

import {
  getReticulumBleBondDesyncActive,
  setReticulumBleBondDesyncActive,
  subscribeReticulumBleBondDesync,
} from './reticulumBleBondDesync';

describe('reticulumBleBondDesync', () => {
  afterEach(() => {
    setReticulumBleBondDesyncActive(false);
  });

  it('notifies subscribers when the flag changes', () => {
    const seen: boolean[] = [];
    const unsub = subscribeReticulumBleBondDesync(() => {
      seen.push(getReticulumBleBondDesyncActive());
    });
    setReticulumBleBondDesyncActive(true);
    setReticulumBleBondDesyncActive(true);
    setReticulumBleBondDesyncActive(false);
    unsub();
    setReticulumBleBondDesyncActive(true);
    setReticulumBleBondDesyncActive(false);
    expect(seen).toEqual([true, false]);
  });
});
