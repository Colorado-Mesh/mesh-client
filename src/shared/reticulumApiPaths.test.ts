import { describe, expect, it } from 'vitest';

import { RETICULUM_LXMF_RECENT_API_PATH } from './reticulumApiPaths';

describe('reticulumApiPaths', () => {
  it('exposes the LXMF recent catch-up path', () => {
    expect(RETICULUM_LXMF_RECENT_API_PATH).toBe('/api/v1/lxmf/recent');
  });
});
