import { afterEach, describe, expect, it } from 'vitest';

import {
  getMeshcomNetworkTime,
  noteMeshcomNetworkTimeFromText,
  resetMeshcomNetworkTimeForTests,
} from './meshcomNetworkTime';

describe('meshcomNetworkTime', () => {
  afterEach(() => {
    resetMeshcomNetworkTimeForTests();
  });

  it('records {CET} beacon text as network time', () => {
    expect(noteMeshcomNetworkTimeFromText('hello')).toBe(false);
    expect(getMeshcomNetworkTime()).toBeNull();
    expect(noteMeshcomNetworkTimeFromText('{CET}2026-11-21 20:15:00')).toBe(true);
    const snap = getMeshcomNetworkTime();
    expect(snap?.text).toBe('2026-11-21 20:15:00');
    expect(snap?.heardAtMs).toBeGreaterThan(0);
  });
});
