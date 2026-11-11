import { describe, expect, it } from 'vitest';

import { RETICULUM_LXMF_RECENT_API_PATH } from './reticulumApiPaths';

describe('reticulumApiPaths', () => {
  it.each([
    ['LXMF recent catch-up', RETICULUM_LXMF_RECENT_API_PATH, '/api/v1/lxmf/recent'],
  ] as const)('exposes %s path', (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
