import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkerCommand } from '../lib/transport/types';

describe('message encoder origin validation', () => {
  const postMessage = vi.fn();
  const worker = {
    onmessage: null as ((event: MessageEvent<WorkerCommand>) => void) | null,
    postMessage,
    location: { origin: 'mesh-client://renderer' },
  };
  const command: WorkerCommand = {
    type: 'ENCODE_MESSAGE',
    id: 1,
    text: 'Hello mesh',
    channel: 0,
    from: 123,
    dest: 456,
  };

  beforeEach(async () => {
    vi.resetModules();
    postMessage.mockClear();
    worker.onmessage = null;
    worker.location.origin = 'mesh-client://renderer';
    vi.stubGlobal('self', worker);
    await import('./messageEncoder.worker');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['mesh-client://renderer', 'file://', 'null', 'http://localhost:5173'])(
    'encodes messages from %s',
    (origin) => {
      worker.onmessage?.(new MessageEvent('message', { origin, data: command }));
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'ENCODED', id: 1, buffer: expect.any(ArrayBuffer) },
        [expect.any(ArrayBuffer)],
      );
    },
  );

  it('accepts real dedicated-worker messages with an empty event origin only on a trusted worker origin', () => {
    worker.onmessage?.(new MessageEvent('message', { origin: '', data: command }));
    expect(postMessage).toHaveBeenCalledOnce();
    postMessage.mockClear();
    worker.location.origin = 'https://evil.example';
    worker.onmessage?.(new MessageEvent('message', { origin: '', data: command }));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each([
    'mesh-client://evil',
    'mesh-client://renderer.evil',
    'mesh-client://renderer:123',
    'https://evil.example',
    'https://renderer',
  ])('ignores messages from %s', (origin) => {
    worker.onmessage?.(new MessageEvent('message', { origin, data: command }));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
