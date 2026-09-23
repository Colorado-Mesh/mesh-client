import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/chatNotifications', () => ({
  playMecpSiren: vi.fn(),
  playMecpEasAttention: vi.fn(),
  playMessageNotification: vi.fn(),
}));

import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import * as chatNotifications from '@/renderer/lib/chatNotifications';

import { resetMecpAlertDedupeForTests, triggerMecpAlert } from './mecpAlert';

const memoryStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
  clear: () => {
    memoryStore.clear();
  },
});

describe('triggerMecpAlert', () => {
  beforeEach(() => {
    resetMecpAlertDedupeForTests();
    memoryStore.clear();
    vi.mocked(chatNotifications.playMecpSiren).mockClear();
    vi.mocked(chatNotifications.playMecpEasAttention).mockClear();
    vi.mocked(chatNotifications.playMessageNotification).mockClear();
  });

  afterEach(() => {
    memoryStore.clear();
  });

  it('plays siren for severity 0 even when muted', () => {
    memoryStore.set(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    triggerMecpAlert({
      severity: 0,
      isDrill: false,
      senderLabel: 'Ada',
      viewKey: 'ch:0',
      mutedViews: new Set(['ch:0']),
    });
    expect(chatNotifications.playMecpSiren).toHaveBeenCalledOnce();
    expect(chatNotifications.playMecpEasAttention).not.toHaveBeenCalled();
    expect(chatNotifications.playMessageNotification).not.toHaveBeenCalled();
  });

  it('plays EAS attention tone for severity 1 even when muted', () => {
    memoryStore.set(CHAT_NOTIF_MUTED_STORAGE_KEY, '1');
    triggerMecpAlert({
      severity: 1,
      isDrill: false,
      senderLabel: 'Ada',
      viewKey: 'ch:0',
      mutedViews: new Set(['ch:0']),
    });
    expect(chatNotifications.playMecpEasAttention).toHaveBeenCalledOnce();
    expect(chatNotifications.playMecpSiren).not.toHaveBeenCalled();
  });

  it('plays noticeable mecp tone for severity 2–3 when unmuted', () => {
    triggerMecpAlert({
      severity: 3,
      isDrill: false,
      senderLabel: 'Bob',
      viewKey: 'ch:0',
      mutedViews: new Set(),
    });
    expect(chatNotifications.playMessageNotification).toHaveBeenCalledWith('mecp');
    expect(chatNotifications.playMecpSiren).not.toHaveBeenCalled();
    expect(chatNotifications.playMecpEasAttention).not.toHaveBeenCalled();
  });

  it('skips severity 2–3 when view muted', () => {
    triggerMecpAlert({
      severity: 2,
      isDrill: false,
      senderLabel: 'Bob',
      viewKey: 'ch:0',
      mutedViews: new Set(['ch:0']),
    });
    expect(chatNotifications.playMessageNotification).not.toHaveBeenCalled();
    expect(chatNotifications.playMecpSiren).not.toHaveBeenCalled();
    expect(chatNotifications.playMecpEasAttention).not.toHaveBeenCalled();
  });

  it('never alerts for drills', () => {
    triggerMecpAlert({
      severity: 0,
      isDrill: true,
      senderLabel: 'Ada',
      viewKey: 'ch:0',
      mutedViews: new Set(),
    });
    expect(chatNotifications.playMecpSiren).not.toHaveBeenCalled();
    expect(chatNotifications.playMecpEasAttention).not.toHaveBeenCalled();
  });

  it('dedupes by key so ChatPanel + watcher do not double-play', () => {
    const ctx = {
      severity: 1 as const,
      isDrill: false,
      senderLabel: 'Ada',
      viewKey: 'ch:0',
      mutedViews: new Set<string>(),
      dedupeKey: 'meshtastic:42',
    };
    triggerMecpAlert(ctx);
    triggerMecpAlert(ctx);
    expect(chatNotifications.playMecpEasAttention).toHaveBeenCalledOnce();
  });
});
