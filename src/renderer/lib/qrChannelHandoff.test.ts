/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  offerMeshcoreChannelQr,
  offerMeshtasticChannelQr,
  resetQrChannelHandoffForTests,
  takePendingMeshcoreChannelQr,
  takePendingMeshtasticChannelQr,
} from './qrChannelHandoff';

describe('qrChannelHandoff', () => {
  afterEach(() => {
    resetQrChannelHandoffForTests();
  });

  it('resolves accepted when a live MeshCore listener settles', async () => {
    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ settle?: (o: 'accepted' | 'rejected') => void }>).detail;
      detail.settle?.('accepted');
    };
    window.addEventListener('mesh-client:meshcoreChannelFromQr', onEvent);
    try {
      await expect(
        offerMeshcoreChannelQr({ name: 'Ops', secretHex: 'a'.repeat(32) }),
      ).resolves.toBe('accepted');
      expect(takePendingMeshcoreChannelQr()).toBeNull();
    } finally {
      window.removeEventListener('mesh-client:meshcoreChannelFromQr', onEvent);
    }
  });

  it('keeps a deferred MeshCore payload for Radio mount', async () => {
    const outcome = await offerMeshcoreChannelQr({
      name: 'Ops',
      secretHex: 'b'.repeat(32),
    });
    expect(outcome).toBe('deferred');
    const pending = takePendingMeshcoreChannelQr();
    expect(pending?.payload.name).toBe('Ops');
    expect(takePendingMeshcoreChannelQr()).toBeNull();
  });

  it('resolves accepted when a live Meshtastic listener settles', async () => {
    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ settle?: (o: 'accepted' | 'rejected') => void }>).detail;
      detail.settle?.('accepted');
    };
    window.addEventListener('mesh-client:meshtasticChannelUrl', onEvent);
    try {
      await expect(offerMeshtasticChannelQr('https://meshtastic.org/e/#abc')).resolves.toBe(
        'accepted',
      );
      expect(takePendingMeshtasticChannelQr()).toBeNull();
    } finally {
      window.removeEventListener('mesh-client:meshtasticChannelUrl', onEvent);
    }
  });

  it('keeps a deferred Meshtastic URL for Radio mount', async () => {
    const outcome = await offerMeshtasticChannelQr('https://meshtastic.org/e/#xyz');
    expect(outcome).toBe('deferred');
    const pending = takePendingMeshtasticChannelQr();
    expect(pending?.url).toBe('https://meshtastic.org/e/#xyz');
  });

  it('rejects an empty Meshtastic URL', async () => {
    await expect(offerMeshtasticChannelQr('   ')).resolves.toBe('rejected');
  });
});
