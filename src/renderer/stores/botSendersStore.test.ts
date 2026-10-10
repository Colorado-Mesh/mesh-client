import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'mesh-client:botSenders';

describe('botSendersStore', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('marks and clears senders per protocol', async () => {
    const { useBotSendersStore } = await import('./botSendersStore');
    const { markBotSender, clearBotSender } = useBotSendersStore.getState();
    markBotSender('meshcore', 42);
    expect(useBotSendersStore.getState().senders.meshcore.has(42)).toBe(true);
    expect(useBotSendersStore.getState().senders.meshtastic.has(42)).toBe(false);
    clearBotSender('meshcore', 42);
    expect(useBotSendersStore.getState().senders.meshcore.has(42)).toBe(false);
  });

  it('ignores invalid ids and keeps state identity for repeat marks', async () => {
    const { useBotSendersStore } = await import('./botSendersStore');
    const { markBotSender } = useBotSendersStore.getState();
    markBotSender('meshcore', 0);
    expect(useBotSendersStore.getState().senders.meshcore.size).toBe(0);
    markBotSender('meshcore', 7);
    const before = useBotSendersStore.getState().senders;
    markBotSender('meshcore', 7);
    expect(useBotSendersStore.getState().senders).toBe(before);
  });

  it('evicts the oldest ids past the cap', async () => {
    const { useBotSendersStore, BOT_SENDERS_MAX_PER_PROTOCOL } = await import('./botSendersStore');
    const { markBotSender } = useBotSendersStore.getState();
    for (let id = 1; id <= BOT_SENDERS_MAX_PER_PROTOCOL + 2; id++) markBotSender('meshcore', id);
    const set = useBotSendersStore.getState().senders.meshcore;
    expect(set.size).toBe(BOT_SENDERS_MAX_PER_PROTOCOL);
    expect(set.has(1)).toBe(false);
    expect(set.has(2)).toBe(false);
    expect(set.has(BOT_SENDERS_MAX_PER_PROTOCOL + 2)).toBe(true);
  });

  it('round-trips through localStorage', async () => {
    const first = await import('./botSendersStore');
    first.useBotSendersStore.getState().markBotSender('meshcore', 99);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      state: { senders: Record<string, number[]> };
    };
    expect(raw.state.senders.meshcore).toEqual([99]);

    vi.resetModules();
    const second = await import('./botSendersStore');
    expect(second.useBotSendersStore.getState().senders.meshcore.has(99)).toBe(true);
  });

  it('falls back to defaults on corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { useBotSendersStore } = await import('./botSendersStore');
    expect(useBotSendersStore.getState().senders.meshcore.size).toBe(0);
  });
});
