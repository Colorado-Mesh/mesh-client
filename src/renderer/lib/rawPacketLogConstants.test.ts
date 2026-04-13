import { describe, expect, it } from 'vitest';

import { MAX_RAW_PACKET_LOG_ENTRIES } from './rawPacketLogConstants';

describe('rawPacketLogConstants', () => {
  it('uses 2500 entry cap aligned with MeshCore and Meshtastic raw logs', () => {
    expect(MAX_RAW_PACKET_LOG_ENTRIES).toBe(2500);
  });
});
