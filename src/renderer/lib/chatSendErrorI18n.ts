import type { TFunction } from 'i18next';

import { CHAT_SEND_ERROR_LOCALE_TEXT_TO_KEY } from './chatSendErrorI18nLocaleValues';
import { isMeshcoreI18nKey, translateMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';

/** Persist / display keys for chat outbox + composer send failures. */
export const CHAT_SEND_ERROR_FALLBACK_KEY = 'chatPanel.sendFailed';
export const CHAT_SEND_ERROR_NOT_CONNECTED_KEY = 'chatPanel.sendErrors.notConnected';
export const CHAT_SEND_ERROR_ENCRYPTION_KEY = 'chatPanel.sendErrors.encryptionBlocked';
export const CHAT_SEND_ERROR_TIMEOUT_KEY = 'chatPanel.sendErrors.timeout';
export const CHAT_SEND_ERROR_EMPTY_KEY = 'chatPanel.sendErrors.emptyPayload';
export const CHAT_SEND_ERROR_DEST_KEY_KEY = 'chatPanel.sendErrors.missingDestinationKey';
export const CHAT_SEND_ERROR_INVALID_REACTION_KEY = 'chatPanel.sendErrors.invalidReaction';
export const CHAT_SEND_ERROR_REACTION_TARGET_KEY = 'chatPanel.sendErrors.reactionTargetMissing';
export const CHAT_SEND_ERROR_BLE_KEY = 'chatPanel.sendErrors.bleUnavailable';
export const CHAT_SEND_ERROR_ROOM_SESSION_KEY = 'chatPanel.sendErrors.roomSessionExpired';
export const CHAT_SEND_ERROR_NO_ROOM_CREDENTIAL_KEY = 'chatPanel.sendErrors.noSavedRoomCredential';
export const CHAT_OUTBOX_REMOVE_FAILED_KEY = 'chatPanel.outboxRemoveFailed';

const CHAT_SEND_I18N_PREFIXES = [
  'chatPanel.',
  'roomsPanel.',
  'rrc.',
  'meshcore.errors.',
  'connectionPanel.humanize.',
  'repeatersPanel.',
] as const;

/** Exact English runtime throws that reach outbox / composer / react banners. */
const EXACT_ENGLISH_TO_KEY: Record<string, string> = {
  'Not connected': CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'Not connected to radio': CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'Not connected to a device': CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'Not connected to device': 'meshcore.errors.notConnected',
  'Not connected — connect radio or MQTT to send channel messages':
    CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'MeshCore TCP live reopen produced no handle': CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'meshcore sendMessage: connection handle is required': CHAT_SEND_ERROR_NOT_CONNECTED_KEY,
  'BLE peripheral ID required': CHAT_SEND_ERROR_BLE_KEY,
  'BLE peripheral ID required on Mac/Windows': CHAT_SEND_ERROR_BLE_KEY,
  'Noble BLE scan failed': CHAT_SEND_ERROR_BLE_KEY,
  'No BLE device remembered for MeshCore auto-connect': CHAT_SEND_ERROR_BLE_KEY,
  'MeshCore messages must contain text.': CHAT_SEND_ERROR_EMPTY_KEY,
  'MeshCore direct messages require destinationPubKey to be provided in SendMessageOptions.':
    CHAT_SEND_ERROR_DEST_KEY_KEY,
  'Reply requires the message RF packet id (wait for send ack or refresh chat).':
    'chatPanel.replyRequiresPacketId',
  'Room session expired — log in again to post': CHAT_SEND_ERROR_ROOM_SESSION_KEY,
  'Room not found (no encryption key)': 'meshcore.errors.nodeNotFound',
  'Room has no RF encryption key — wait for contact sync or reconnect radio.':
    CHAT_SEND_ERROR_ENCRYPTION_KEY,
  'Invalid reaction emoji': CHAT_SEND_ERROR_INVALID_REACTION_KEY,
  'Reaction target message not found': CHAT_SEND_ERROR_REACTION_TARGET_KEY,
  'no encryption key': CHAT_SEND_ERROR_ENCRYPTION_KEY,
  'No saved room credential': CHAT_SEND_ERROR_NO_ROOM_CREDENTIAL_KEY,
};

/** Known no-key / no-encryption forms. Do not match bare "encryption" (retryable timeouts). */
const ENCRYPTION_BLOCKED_RES = [
  /\bno[-\s.]?encr/i,
  /\bno[-\s.]?key\b/i,
  /destinationPubKey/,
  /no RF encryption key/i,
];

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
}

export function isChatSendI18nKey(msg: string): boolean {
  return CHAT_SEND_I18N_PREFIXES.some((prefix) => msg.startsWith(prefix));
}

export function isEncryptionBlockedSendError(errMsg: string): boolean {
  if (
    errMsg === CHAT_SEND_ERROR_ENCRYPTION_KEY ||
    errMsg === CHAT_SEND_ERROR_DEST_KEY_KEY ||
    errMsg === 'meshcore.errors.nodeNotFound'
  ) {
    return true;
  }
  return ENCRYPTION_BLOCKED_RES.some((re) => re.test(errMsg));
}

function reverseLookupKnownTranslation(msg: string): string | null {
  return CHAT_SEND_ERROR_LOCALE_TEXT_TO_KEY[msg] ?? null;
}

/**
 * Resolve a persistable locale key (never a raw runtime Error.message).
 * MeshCore serialized payloads are kept so display can interpolate params.
 */
export function resolveChatSendErrorKey(
  raw: string,
  fallbackKey: string = CHAT_SEND_ERROR_FALLBACK_KEY,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallbackKey;
  if (trimmed.startsWith('delivered; outbox remove failed')) {
    return CHAT_OUTBOX_REMOVE_FAILED_KEY;
  }
  if (isChatSendI18nKey(trimmed) || isMeshcoreI18nKey(trimmed)) {
    return trimmed;
  }
  const exact = EXACT_ENGLISH_TO_KEY[trimmed];
  if (exact) return exact;
  const reversed = reverseLookupKnownTranslation(trimmed);
  if (reversed) return reversed;
  if (/not connected/i.test(trimmed)) {
    return CHAT_SEND_ERROR_NOT_CONNECTED_KEY;
  }
  if (/geolocation|user denied|location unavailable|gps/i.test(trimmed)) {
    return 'chatPanel.shareLocationUnavailable';
  }
  // Timeout before encryption: "timeout while initializing encryption" is retryable.
  if (/timeout|timed out/i.test(trimmed)) {
    return CHAT_SEND_ERROR_TIMEOUT_KEY;
  }
  if (isEncryptionBlockedSendError(trimmed)) {
    return CHAT_SEND_ERROR_ENCRYPTION_KEY;
  }
  return fallbackKey;
}

export function persistableChatSendError(err: unknown): string {
  const raw = errMessage(err);
  if (raw.startsWith('\x1eMC_I18N:')) return raw;
  return resolveChatSendErrorKey(raw);
}

export interface TranslateChatSendErrorOptions {
  fallbackKey?: string;
  /** Keep unknown already-translated UI (e.g. RRC preflight) instead of the generic fallback. */
  passthroughUnknown?: boolean;
}

/** User-visible send/outbox/react error — locale text, not raw Error.message. */
export function translateChatSendError(
  t: TFunction,
  err: unknown,
  options: TranslateChatSendErrorOptions = {},
): string {
  const fallbackKey = options.fallbackKey ?? CHAT_SEND_ERROR_FALLBACK_KEY;
  const raw = errMessage(err).trim();
  if (!raw) return t(fallbackKey);

  if (raw.startsWith('\x1eMC_I18N:') || isMeshcoreI18nKey(raw)) {
    return translateMeshcoreUserMessage(t, raw);
  }

  const key = resolveChatSendErrorKey(raw, fallbackKey);
  if (options.passthroughUnknown && key === fallbackKey && !isChatSendI18nKey(raw)) {
    const exact = EXACT_ENGLISH_TO_KEY[raw];
    if (!exact && !reverseLookupKnownTranslation(raw) && !isEncryptionBlockedSendError(raw)) {
      return raw;
    }
  }
  return t(key);
}
