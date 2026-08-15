import type { TFunction } from 'i18next';

import {
  MESHCORE_REPEATER_PING_SETTLE_MAX_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from '../timeConstants';
import type { DiagnosticTextI18n } from '../types';

export const MESHCORE_REPEATER_AUTH_HINT_KEY = 'meshcore.errors.repeaterAuthHint';

export const MESHCORE_ERR_NODE_NOT_FOUND = 'meshcore.errors.nodeNotFound';
export const MESHCORE_ERR_NOT_CONNECTED = 'meshcore.errors.notConnected';
export const MESHCORE_ERR_AUTH_FAILED = 'meshcore.errors.authenticationFailed';
export const MESHCORE_ERR_REQUEST_FAILED = 'meshcore.errors.requestFailed';
export const MESHCORE_ERR_RPC_IN_PROGRESS = 'meshcore.errors.repeaterRpcInProgress';

export interface MeshcorePrefixedHint {
  type: 'prefixed';
  message: MeshcoreUserMessage;
  hintKey: string;
}

export type MeshcoreUserMessage = string | DiagnosticTextI18n | MeshcorePrefixedHint;

const I18N_JSON_PREFIX = '\x1eMC_I18N:';

function isMeshcorePrefixedHint(msg: MeshcoreUserMessage): msg is MeshcorePrefixedHint {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  return typeof msg === 'object' && 'type' in msg && msg.type === 'prefixed';
}

export function isDiagnosticTextI18n(msg: MeshcoreUserMessage): msg is DiagnosticTextI18n {
  return typeof msg === 'object' && 'key' in msg && !('type' in msg);
}

export function isMeshcoreI18nKey(msg: string): boolean {
  return (
    msg.startsWith('meshcore.') ||
    msg.startsWith('connectionPanel.humanize.meshcore.') ||
    msg.startsWith('repeatersPanel.')
  );
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

/** Map admin RPC wait errors to the timeout budget shown in UI copy. */
export function meshcoreRepeaterAdminRpcErrorBudgetMs(
  errMsg: string,
  rpcTimeoutMs: number,
): number {
  const lower = errMsg.toLowerCase();
  if (lower.includes('timeout waiting for ping')) {
    return MESHCORE_REPEATER_PING_SETTLE_MAX_MS;
  }
  if (lower.includes('timeout waiting for trace')) {
    return MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS;
  }
  return rpcTimeoutMs;
}

export function meshcoreRepeaterAdminErrorMessage(t: TFunction, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return translateMeshcoreUserMessage(t, raw);
}

export function meshcoreRepeaterRpcErrorMessage(
  errMsg: string,
  timeoutMs: number,
): MeshcoreUserMessage {
  const deserialized = deserializeMeshcoreUserMessage(errMsg);
  if (isDiagnosticTextI18n(deserialized)) {
    return deserialized;
  }
  if (typeof deserialized === 'string' && isMeshcoreI18nKey(deserialized)) {
    return deserialized;
  }
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

/** Translate `[Error: <serialized i18n>]` CLI history lines; pass firmware text through. */
export function translateRepeaterCliHistoryText(
  t: TFunction,
  type: 'sent' | 'received',
  text: string,
): string {
  if (type !== 'received') return text;
  const match = /^\[Error: (.*)\]$/s.exec(text);
  if (!match) return text;
  return t('repeatersPanel.cliHistoryError', {
    detail: translateMeshcoreUserMessage(t, match[1]),
  });
}
