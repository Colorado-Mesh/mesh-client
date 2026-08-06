import { beforeEach, describe, expect, it } from 'vitest';

import {
  cancelProtocolRfAutoConnect,
  isProtocolRfAutoConnectCancelled,
  resetProtocolRfAutoConnectCancel,
} from './protocolRfAutoConnectGate';

describe('protocolRfAutoConnectGate', () => {
  beforeEach(() => {
    resetProtocolRfAutoConnectCancel('meshcore');
    resetProtocolRfAutoConnectCancel('meshtastic');
  });

  it('tracks cancel per protocol', () => {
    expect(isProtocolRfAutoConnectCancelled('meshcore')).toBe(false);
    cancelProtocolRfAutoConnect('meshcore');
    expect(isProtocolRfAutoConnectCancelled('meshcore')).toBe(true);
    expect(isProtocolRfAutoConnectCancelled('meshtastic')).toBe(false);
    resetProtocolRfAutoConnectCancel('meshcore');
    expect(isProtocolRfAutoConnectCancelled('meshcore')).toBe(false);
  });
});
