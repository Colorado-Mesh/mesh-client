import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.spyOn(console, 'warn').mockImplementation(() => {});

vi.mock('@liamcottle/meshcore.js', () => ({
  CayenneLpp: { parse: vi.fn().mockReturnValue([]) },
  Connection: class {
    close = vi.fn().mockResolvedValue(undefined);
    on() {
      return undefined;
    }
    off() {
      return undefined;
    }
    once() {
      return undefined;
    }
    emit() {
      return undefined;
    }
  },
  SerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
  WebSerialConnection: class {
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

import { useMeshcoreRuntime } from '../runtime/useMeshcoreRuntime';

describe('useMeshcoreRuntime channel send transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
  });

  it('throws when neither radio nor MQTT is available for channel send', async () => {
    const { result } = renderHook(() => useMeshcoreRuntime());

    await expect(
      act(async () => {
        await result.current.sendMessage('hello channel', 0);
      }),
    ).rejects.toThrow('Not connected — connect radio or MQTT to send channel messages');
  });
});
