import { describe, expect, it } from 'vitest';

import { MESHTASTIC_ORPHAN_SENDING_WINDOW_MS } from './meshtasticOrphanSendingWindow';

describe('meshtasticOrphanSendingWindow', () => {
  it.each([['orphan sending window', MESHTASTIC_ORPHAN_SENDING_WINDOW_MS, 120_000]] as const)(
    'exposes the %s',
    (_label, actual, expected) => {
      expect(actual).toBe(expected);
    },
  );
});
