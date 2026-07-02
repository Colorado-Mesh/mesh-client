import { describe, expect, it, vi } from 'vitest';

import { registerChatOutboxDrainListener, requestChatOutboxDrain } from './chatOutboxDrain';

describe('chatOutboxDrain', () => {
  it('invokes registered listener on request', () => {
    const listener = vi.fn();
    const unregister = registerChatOutboxDrainListener('reticulum', listener);
    requestChatOutboxDrain('reticulum');
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    requestChatOutboxDrain('reticulum');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates listeners by protocol', () => {
    const meshtastic = vi.fn();
    const meshcore = vi.fn();
    registerChatOutboxDrainListener('meshtastic', meshtastic);
    registerChatOutboxDrainListener('meshcore', meshcore);
    requestChatOutboxDrain('meshcore');
    expect(meshcore).toHaveBeenCalledTimes(1);
    expect(meshtastic).not.toHaveBeenCalled();
  });
});
