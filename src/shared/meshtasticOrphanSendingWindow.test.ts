import { describe, expect, it } from 'vitest';

import { MESHTASTIC_ORPHAN_SENDING_WINDOW_MS } from './meshtasticOrphanSendingWindow';

describe('meshtasticOrphanSendingWindow', () => {
  it('exposes the orphan sending window', () => {
    expect(MESHTASTIC_ORPHAN_SENDING_WINDOW_MS).toBe(120_000);
  });
});
