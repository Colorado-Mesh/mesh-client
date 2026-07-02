import { describe, expect, it } from 'vitest';

import {
  RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
  RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC,
  reticulumPropagationAutoSyncOptionKey,
} from './reticulumPropagationAutoSync';

describe('reticulumPropagationAutoSync', () => {
  it('defaults to one hour', () => {
    expect(RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC).toBe(3600);
    expect(RETICULUM_PROPAGATION_AUTO_SYNC_INTERVALS_SEC).toContain(3600);
  });

  it('maps interval seconds to i18n keys', () => {
    expect(reticulumPropagationAutoSyncOptionKey(0)).toBe(
      'reticulumPropagation.autoSyncOptionDisabled',
    );
    expect(reticulumPropagationAutoSyncOptionKey(3600)).toBe(
      'reticulumPropagation.autoSyncOption1h',
    );
  });
});
