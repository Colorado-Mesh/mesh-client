import { describe, expect, it } from 'vitest';

import { routeScannedQr } from '@/renderer/lib/scanQrRoute';
import {
  buildLxmContactUri,
  buildLxmGameSessionUri,
  buildMeshcoreChannelAddUri,
  buildMeshcoreContactAddUri,
} from '@/shared/meshClientDeepLink';

const PUBKEY = 'c'.repeat(64);
const SECRET = 'd'.repeat(32);

describe('routeScannedQr', () => {
  it('routes MeshCore contact', () => {
    const text = buildMeshcoreContactAddUri({
      name: 'Dave',
      publicKeyHex: PUBKEY,
      type: 1,
    });
    expect(routeScannedQr(text)).toEqual({ kind: 'meshcoreContact', text });
  });

  it('routes MeshCore channel', () => {
    const text = buildMeshcoreChannelAddUri({ name: 'Local', secretHex: SECRET });
    expect(routeScannedQr(text)).toEqual({
      kind: 'meshcoreChannel',
      channel: { name: 'Local', secretHex: SECRET },
    });
  });

  it('routes Meshtastic channel URL', () => {
    const url = 'https://meshtastic.org/e/#xyz';
    expect(routeScannedQr(url)).toEqual({ kind: 'meshtasticChannel', url });
  });

  it('routes Reticulum contact URI', () => {
    const text = buildLxmContactUri('a'.repeat(32), 'Peer');
    expect(routeScannedQr(text)).toEqual({ kind: 'reticulum', text });
  });

  it('routes game-session QR to lxmGameSession (not reticulum)', () => {
    const sessionId = '0123456789abcdef';
    const text = buildLxmGameSessionUri(sessionId);
    expect(routeScannedQr(text)).toEqual({ kind: 'lxmGameSession', sessionId });
  });

  it('returns unknown for empty / garbage', () => {
    expect(routeScannedQr('')).toEqual({ kind: 'unknown' });
    expect(routeScannedQr('hello')).toEqual({ kind: 'unknown' });
  });
});
