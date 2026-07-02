import type { TFunction } from 'i18next';

import type { DiagnosticTextI18n } from '../types';

export const MESHCORE_REPEATER_AUTH_HINT_KEY = 'meshcore.errors.repeaterAuthHint';

export const MESHCORE_ERR_NODE_NOT_FOUND = 'meshcore.errors.nodeNotFound';
export const MESHCORE_ERR_NOT_CONNECTED = 'meshcore.errors.notConnected';
export const MESHCORE_ERR_AUTH_FAILED = 'meshcore.errors.authenticationFailed';
export const MESHCORE_ERR_REQUEST_FAILED = 'meshcore.errors.requestFailed';

export interface MeshcorePrefixedHint {
  type: 'prefixed';
  message: MeshcoreUserMessage;
  hintKey: string;
}

export type MeshcoreUserMessage = string | DiagnosticTextI18n | MeshcorePrefixedHint;

const I18N_JSON_PREFIX = '\x1eMC_I18N:';

function isMeshcorePrefixedHint(msg: MeshcoreUserMessage): msg is MeshcorePrefixedHint {
  return typeof msg === 'object' && 'type' in msg && msg.type === 'prefixed';
}

export function isDiagnosticTextI18n(msg: MeshcoreUserMessage): msg is DiagnosticTextI18n {
  return typeof msg === 'object' && 'key' in msg && !('type' in msg);
}

export function isMeshcoreI18nKey(msg: string): boolean {
  return msg.startsWith('meshcore.') || msg.startsWith('connectionPanel.humanize.meshcore.');
}

export function meshcoreUserMessageKey(ref: MeshcoreUserMessage): string | null {
  if (typeof ref === 'string') {
    return isMeshcoreI18nKey(ref) ? ref : null;
  }
  if (isMeshcorePrefixedHint(ref)) {
    return ref.hintKey;
  }
  if (isDiagnosticTextI18n(ref)) {
    return ref.key;
  }
  return null;
}

export function serializeMeshcoreUserMessage(ref: MeshcoreUserMessage): string {
  if (typeof ref === 'string') {
    return ref;
  }
  return I18N_JSON_PREFIX + JSON.stringify(ref);
}

export function deserializeMeshcoreUserMessage(stored: string): MeshcoreUserMessage {
  if (stored.startsWith(I18N_JSON_PREFIX)) {
    try {
      return JSON.parse(stored.slice(I18N_JSON_PREFIX.length)) as MeshcoreUserMessage;
    } catch {
      // catch-no-log-ok corrupt stored i18n payload falls back to raw string
      return stored;
    }
  }
  return stored;
}

export function translateMeshcoreUserMessage(
  t: TFunction,
  ref: MeshcoreUserMessage | string,
): string {
  const msg = typeof ref === 'string' ? deserializeMeshcoreUserMessage(ref) : ref;
  if (typeof msg === 'string') {
    if (isMeshcoreI18nKey(msg)) return t(msg);
    return msg;
  }
  if (isMeshcorePrefixedHint(msg)) {
    const base = translateMeshcoreUserMessage(t, msg.message);
    return t('connectionPanel.humanize.prefixedHint', {
      message: base,
      hint: t(msg.hintKey),
    });
  }
  if (isDiagnosticTextI18n(msg)) {
    return t(msg.key, msg.params);
  }
  return msg;
}

function messageTextForAuthCheck(message: MeshcoreUserMessage): string {
  if (typeof message === 'string') return message;
  if (isMeshcorePrefixedHint(message)) {
    return messageTextForAuthCheck(message.message);
  }
  if (isDiagnosticTextI18n(message)) {
    return message.key;
  }
  return '';
}

export function meshcoreAppendRepeaterAuthHint(message: MeshcoreUserMessage): MeshcoreUserMessage {
  if (isMeshcorePrefixedHint(message)) {
    return message;
  }
  const m = typeof message === 'string' ? message.trim() : '';
  const lower = (m || messageTextForAuthCheck(message)).toLowerCase();
  const authish =
    lower.includes('authentication failed') ||
    lower.includes('auth failed') ||
    lower.includes('login failed') ||
    lower.includes('meshcore.errors.authenticationfailed') ||
    (lower.includes('auth') && lower.includes('fail'));
  if (!authish) return message;
  return {
    type: 'prefixed',
    message,
    hintKey: MESHCORE_REPEATER_AUTH_HINT_KEY,
  };
}

export function meshcoreStoredUserMessage(ref: MeshcoreUserMessage): string {
  return serializeMeshcoreUserMessage(meshcoreAppendRepeaterAuthHint(ref));
}

export function meshcoreRepeaterRpcErrorMessage(
  errMsg: string,
  timeoutMs: number,
): MeshcoreUserMessage {
  const lower = errMsg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      key: 'meshcore.errors.requestTimedOutApprox',
      params: { seconds: Math.round(timeoutMs / 1000) },
    };
  }
  if (lower.includes('auth') || lower.includes('login')) {
    return MESHCORE_ERR_AUTH_FAILED;
  }
  return { key: MESHCORE_ERR_REQUEST_FAILED, params: { detail: errMsg } };
}
