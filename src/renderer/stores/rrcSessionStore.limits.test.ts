import { describe, expect, it } from 'vitest';

import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

describe('rrcSessionStore limits', () => {
  it('stores and mirrors WELCOME hub limits on the focused hub', () => {
    const hub = 'aa'.repeat(16);
    useRrcSessionStore.getState().clearSession();
    useRrcSessionStore.getState().applyStatus('active', hub, 'Test Hub');
    useRrcSessionStore.getState().setLimits(
      {
        max_msg_body_bytes: 350,
        max_nick_bytes: 32,
        max_room_name_bytes: 64,
      },
      hub,
    );
    expect(useRrcSessionStore.getState().limits).toEqual({
      max_msg_body_bytes: 350,
      max_nick_bytes: 32,
      max_room_name_bytes: 64,
    });
    expect(useRrcSessionStore.getState().sessionsByHub.get(hub)?.limits.max_msg_body_bytes).toBe(
      350,
    );
  });
});
