import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDevice, useDeviceStore } from '../stores/deviceStore';
import { useMeshcoreChannelsDeviceSync } from './useMeshcoreChannelsDeviceSync';

beforeEach(() => {
  useDeviceStore.setState({ devices: {} });
});

describe('useMeshcoreChannelsDeviceSync', () => {
  it('writes runtime channel names into deviceStore', () => {
    const secret = new Uint8Array([1, 2, 3]);
    renderHook(() => {
      useMeshcoreChannelsDeviceSync({
        identityId: 'mc-1',
        channels: [{ index: 0, name: 'Public', secret }],
      });
    });
    expect(getDevice('mc-1').meshcoreChannels).toEqual([{ index: 0, name: 'Public', key: secret }]);
  });

  it('clears the previous identity when the identity id changes', () => {
    const secret = new Uint8Array(16);
    const { rerender } = renderHook(
      (props: { id: string | null }) => {
        useMeshcoreChannelsDeviceSync({
          identityId: props.id,
          channels: [{ index: 1, name: 'Alpha', secret }],
        });
      },
      { initialProps: { id: 'mc-a' } },
    );
    expect(getDevice('mc-a').meshcoreChannels?.[0]?.name).toBe('Alpha');
    rerender({ id: 'mc-b' });
    expect(getDevice('mc-a').meshcoreChannels).toEqual([]);
    expect(getDevice('mc-b').meshcoreChannels?.[0]?.name).toBe('Alpha');
  });

  it('writes an empty list when channels are cleared', () => {
    const secret = new Uint8Array(16);
    const { rerender } = renderHook(
      (props: { channels: { index: number; name: string; secret: Uint8Array }[] }) => {
        useMeshcoreChannelsDeviceSync({
          identityId: 'mc-1',
          channels: props.channels,
        });
      },
      { initialProps: { channels: [{ index: 0, name: 'Public', secret }] } },
    );
    rerender({ channels: [] });
    expect(getDevice('mc-1').meshcoreChannels).toEqual([]);
  });
});
