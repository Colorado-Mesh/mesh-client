// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportNobleIpc } from './transportNobleIpc';

describe('TransportNobleIpc', () => {
  let fromRadioHandler: ((payload: { sessionId: string; bytes: Uint8Array }) => void) | null;
  let unsub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromRadioHandler = null;
    unsub = vi.fn();
    vi.stubGlobal('electronAPI', {
      onNobleBleFromRadio: vi.fn((cb: typeof fromRadioHandler) => {
        fromRadioHandler = cb;
        return unsub;
      }),
      nobleBleToRadio: vi.fn().mockResolvedValue(undefined),
      disconnectNobleBle: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('subscribes to from-radio IPC and enqueues matching session packets', async () => {
    const transport = new TransportNobleIpc('meshtastic');
    const reader = transport.fromDevice.getReader();

    expect(window.electronAPI.onNobleBleFromRadio).toHaveBeenCalled();
    fromRadioHandler?.({ sessionId: 'meshcore', bytes: new Uint8Array([1]) });
    fromRadioHandler?.({ sessionId: 'meshtastic', bytes: new Uint8Array([9, 8]) });

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([9, 8]) });
    await reader.cancel();
  });

  it('forwards toDevice writes via nobleBleToRadio', async () => {
    const transport = new TransportNobleIpc('meshcore');
    const writer = transport.toDevice.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    expect(window.electronAPI.nobleBleToRadio).toHaveBeenCalledWith(
      'meshcore',
      new Uint8Array([1, 2, 3]),
    );
    await writer.close();
    expect(unsub).toHaveBeenCalled();
  });

  it('disconnect unsubscribes and disconnects the Noble session', async () => {
    const transport = new TransportNobleIpc('meshtastic');
    // Touch fromDevice so the subscription is installed.
    void transport.fromDevice.getReader();
    await transport.disconnect();
    expect(window.electronAPI.disconnectNobleBle).toHaveBeenCalledWith('meshtastic');
    expect(unsub).toHaveBeenCalled();
  });
});
