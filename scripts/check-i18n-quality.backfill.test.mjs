// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  MODULE_PANEL_MUST_TRANSLATE_IDENTICAL_KEYS,
  RETICULUM_PEER_TABLE_MUST_TRANSLATE_LEAF_KEYS,
  reticulumRequiresTranslation,
} from './check-i18n-quality.mjs';

describe('translation backfill quality rules', () => {
  it('flags Reticulum peer table headers for translation', () => {
    expect(RETICULUM_PEER_TABLE_MUST_TRANSLATE_LEAF_KEYS.has('actions')).toBe(true);
    expect(
      reticulumRequiresTranslation('connectionPanel.reticulumPeers.hops', 'hops', 'Hops'),
    ).toBe(true);
    expect(
      reticulumRequiresTranslation('connectionPanel.reticulumInterfaces.host', 'host', 'Host'),
    ).toBe(true);
  });

  it('flags modulePanel remoteHardware label', () => {
    expect(
      MODULE_PANEL_MUST_TRANSLATE_IDENTICAL_KEYS.has('modulePanel.fields.remoteHardware'),
    ).toBe(true);
  });
});
