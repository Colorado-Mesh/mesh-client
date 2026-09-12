import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { serializeMeshcoreUserMessage } from '@/renderer/lib/meshcore/meshcoreMessageI18n';

import {
  CHAT_OUTBOX_REMOVE_FAILED_KEY,
  CHAT_SEND_ERROR_BLE_KEY,
  CHAT_SEND_ERROR_ENCRYPTION_KEY,
  CHAT_SEND_ERROR_FALLBACK_KEY,
  CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  CHAT_SEND_ERROR_TIMEOUT_KEY,
  isEncryptionBlockedSendError,
  persistableChatSendError,
  resolveChatSendErrorKey,
  translateChatSendError,
} from './chatSendErrorI18n';

const EN: Record<string, string> = {
  [CHAT_SEND_ERROR_NOT_CONNECTED_KEY]: 'Not connected — connect the radio and try again.',
  [CHAT_SEND_ERROR_FALLBACK_KEY]: 'Send failed',
  'chatPanel.reticulumSendFailed': 'Failed to send',
  'meshcore.errors.requestTimedOutApprox': 'Request timed out (~{{seconds}}s)',
};

const t = ((key: string, opts?: Record<string, unknown>): string => {
  const raw = EN[key] ?? key;
  if (opts && typeof opts.seconds === 'number') {
    return raw.replace('{{seconds}}', String(opts.seconds));
  }
  return raw;
}) as TFunction;

describe('chatSendErrorI18n', () => {
  it.each([
    ['Not connected', CHAT_SEND_ERROR_NOT_CONNECTED_KEY],
    ['Not connected to radio', CHAT_SEND_ERROR_NOT_CONNECTED_KEY],
    ['Noble BLE scan failed', CHAT_SEND_ERROR_BLE_KEY],
    ['no encryption key', CHAT_SEND_ERROR_ENCRYPTION_KEY],
    ['radio busy', CHAT_SEND_ERROR_FALLBACK_KEY],
    ['sync boom', CHAT_SEND_ERROR_FALLBACK_KEY],
    ['timeout', CHAT_SEND_ERROR_TIMEOUT_KEY],
    ['chatPanel.reticulumSendTimeout', 'chatPanel.reticulumSendTimeout'],
    ['meshcore.errors.notConnected', 'meshcore.errors.notConnected'],
    [
      'Send timed out. The Reticulum stack may be starting or busy — try again.',
      'chatPanel.reticulumSendTimeout',
    ],
    ['Failed to send', 'chatPanel.reticulumSendFailed'],
    ['delivered; outbox remove failed: db locked', CHAT_OUTBOX_REMOVE_FAILED_KEY],
    ['User denied Geolocation', 'chatPanel.shareLocationUnavailable'],
  ])('maps %s to a locale key', (raw, key) => {
    expect(resolveChatSendErrorKey(raw)).toBe(key);
  });

  it('persists keys instead of raw Error.message', () => {
    expect(persistableChatSendError(new Error('Not connected'))).toBe(
      CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
    );
    expect(persistableChatSendError(new Error('radio busy'))).toBe(CHAT_SEND_ERROR_FALLBACK_KEY);
  });

  it('keeps MeshCore serialized i18n payloads for display interpolation', () => {
    const stored = serializeMeshcoreUserMessage({
      key: 'meshcore.errors.requestTimedOutApprox',
      params: { seconds: 12 },
    });
    expect(persistableChatSendError(new Error(stored))).toBe(stored);
    expect(translateChatSendError(t, stored)).toMatch(/12/);
  });

  it('translates known English and keys; never returns raw runtime English', () => {
    expect(translateChatSendError(t, new Error('Not connected'))).toBe(
      t(CHAT_SEND_ERROR_NOT_CONNECTED_KEY),
    );
    expect(translateChatSendError(t, new Error('radio busy'))).toBe(
      t(CHAT_SEND_ERROR_FALLBACK_KEY),
    );
    expect(translateChatSendError(t, new Error('radio busy'))).not.toBe('radio busy');
    expect(translateChatSendError(t, 'chatPanel.reticulumSendFailed')).toBe(
      t('chatPanel.reticulumSendFailed'),
    );
  });

  it('passthrough keeps already-translated RRC preflight text', () => {
    const rrc = 'Nickname is too long (limit 32 bytes).';
    expect(translateChatSendError(t, rrc, { passthroughUnknown: true })).toBe(rrc);
    expect(translateChatSendError(t, rrc)).toBe(t(CHAT_SEND_ERROR_FALLBACK_KEY));
  });

  it('treats encryption / missing-key throws as blocked', () => {
    expect(isEncryptionBlockedSendError('no encryption key')).toBe(true);
    expect(isEncryptionBlockedSendError(CHAT_SEND_ERROR_ENCRYPTION_KEY)).toBe(true);
    expect(isEncryptionBlockedSendError('radio busy')).toBe(false);
  });
});
