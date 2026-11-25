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
        message: '[GATT:meshcom] connect_timeout',
      }),
    ).toBe('meshcom');
    expect(
      resolveLogProtocolFromChannel({
        source: 'main',
        message: '[IPC] meshcom:udp-connect bound',
      }),
    ).toBe('meshcom');
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

  it('prefers IPC invoke channel tokens over protocol-named Vite chunk sources', () => {
    expect(
      resolveLogProtocolFromChannel({
        source: 'renderer:meshcom-runtime-DP4Ql4pn.js:5',
        message:
          "mcL0994 [IpcTcpConnection] connect/onConnected error Error: Error invoking remote method 'meshcore:tcp-connect': Error: meshcore:tcp-connect: connection timeout",
      }),
    ).toBe('meshcore');
    expect(
      resolveLogProtocolFromChannel({
        source: 'renderer:connection-runtime-abc.js:1',
        message: "Error invoking remote method 'meshtastic:tcp-connect': getaddrinfo ENOTFOUND",
      }),
    ).toBe('meshtastic');
  });
});
