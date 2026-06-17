import { describe, expect, it } from 'vitest';

import {
  MESHCORE_CONTACT_HW_LABELS,
  meshcoreHwModelIsContactTypeLabel,
} from './meshcoreContactHwLabels';

describe('meshcoreContactHwLabels', () => {
  it('recognizes MeshCore contact type labels', () => {
    for (const label of MESHCORE_CONTACT_HW_LABELS) {
      expect(meshcoreHwModelIsContactTypeLabel(label)).toBe(true);
    }
    expect(meshcoreHwModelIsContactTypeLabel('RAK4631')).toBe(false);
    expect(meshcoreHwModelIsContactTypeLabel('None')).toBe(false);
  });
});
