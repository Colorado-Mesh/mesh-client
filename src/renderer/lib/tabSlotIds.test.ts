import { describe, expect, it } from 'vitest';

import { TAB_SLOT_IDS } from './tabSlotIds';

describe('tabSlotIds', () => {
  it('contains essential stable navigation slot identifiers', () => {
    expect(TAB_SLOT_IDS).toContain('Connection');
    expect(TAB_SLOT_IDS).toContain('Chat');
    expect(TAB_SLOT_IDS).toContain('Nodes');
    expect(TAB_SLOT_IDS).toContain('Map');
    expect(TAB_SLOT_IDS).toContain('Radio');
    expect(TAB_SLOT_IDS).toContain('Diagnostics');
    expect(TAB_SLOT_IDS).toContain('Topology');
  });

  it('contains no duplicate slot identifiers', () => {
    const uniqueIds = new Set(TAB_SLOT_IDS);
    expect(uniqueIds.size).toBe(TAB_SLOT_IDS.length);
  });
});
