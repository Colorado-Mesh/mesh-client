import { describe, expect, it, vi } from 'vitest';

import { registerChatOutboxDrainListener, requestChatOutboxDrain } from './chatOutboxDrain';

describe('chatOutboxDrain', () => {
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
