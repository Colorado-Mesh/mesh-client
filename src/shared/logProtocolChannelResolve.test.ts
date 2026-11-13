import { describe, expect, it } from 'vitest';

import { resolveLogProtocolFromChannel } from './logProtocolChannelResolve';

describe('resolveLogProtocolFromChannel', () => {
  it('resolves encoded channel / session tokens without the tag registry', () => {
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[IPC] meshtastic:tcp-connect error: refused',
      }),
    ).toBe('meshtastic');
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[GATT:meshcore] connect_timeout',
      }),
    ).toBe('meshcore');
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[Connection] connected stack=reticulum path=tcp',
      }),
    ).toBe('reticulum');
  });

  it('does not consult the tag registry (main-bundle safe)', () => {
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[meshtasticTransportLoss] serial link lost',
      }),
    ).toBeUndefined();
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[ReticulumSidecar] ready',
      }),
    ).toBeUndefined();
  });

  it('maps sdk source to meshtastic', () => {
    expect(resolveLogProtocolFromChannel({ source: 'sdk', message: 'Packet timed out' })).toBe(
      'meshtastic',
    );
  });
});
