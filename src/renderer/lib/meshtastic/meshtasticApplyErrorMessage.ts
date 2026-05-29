import { Mesh } from '@meshtastic/protobufs';
import type { TFunction } from 'i18next';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { errLikeToLogString } from '../errLikeToLogString';
import { peekRecentMeshtasticClientNotification } from './meshtasticClientNotification';
import { isMeshtasticTransportLostError } from './meshtasticTransportLossDetection';

const ROUTING_ERROR_CODE_RE = /"error"\s*:\s*(\d+)/;

export function parseMeshtasticRoutingErrorCode(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null) {
    const o = err as { error?: number };
    if (typeof o.error === 'number') return o.error;
  }
  if (err instanceof Error) {
    const match = ROUTING_ERROR_CODE_RE.exec(err.message);
    if (match) return Number(match[1]);
  }
  const flat = errLikeToLogString(err);
  const flatMatch = ROUTING_ERROR_CODE_RE.exec(flat);
  if (flatMatch) return Number(flatMatch[1]);
  return undefined;
}

export function meshtasticRoutingErrorName(code: number): string {
  const RoutingError = Mesh.Routing_Error as Record<string, number>;
  for (const [name, value] of Object.entries(RoutingError)) {
    if (value === code && !name.includes('UNRECOGNIZED')) return name;
  }
  return `error ${code}`;
}

function modulePanelErrorKeyForRoutingCode(code: number): string | null {
  const RoutingError = Mesh.Routing_Error as Record<string, number>;
  switch (code) {
    case RoutingError.BAD_REQUEST:
      return 'modulePanel.errors.badRequest';
    case RoutingError.NOT_AUTHORIZED:
      return 'modulePanel.errors.notAuthorized';
    case RoutingError.TIMEOUT:
    case RoutingError.NO_RESPONSE:
    case RoutingError.MAX_RETRANSMIT:
      return 'modulePanel.errors.timeout';
    case RoutingError.NO_CHANNEL:
      return 'modulePanel.errors.noChannel';
    default:
      return null;
  }
}

function appendClientNotificationDetail(base: string, code: number | undefined): string {
  const RoutingError = Mesh.Routing_Error as Record<string, number>;
  const shouldAppend =
    code === RoutingError.BAD_REQUEST || code == null || code === RoutingError.NO_RESPONSE;
  if (!shouldAppend) return base;
  const detail = peekRecentMeshtasticClientNotification();
  if (!detail) return base;
  return `${base} (${sanitizeLogMessage(detail)})`;
}

/** User-facing message for module/radio apply failures (local radio, not remote admin). */
export function formatMeshtasticModuleApplyError(err: unknown, t: TFunction): string {
  if (isMeshtasticTransportLostError(err)) {
    return t('modulePanel.errors.transportLost');
  }

  const code = parseMeshtasticRoutingErrorCode(err);
  if (code != null) {
    const key = modulePanelErrorKeyForRoutingCode(code);
    const base = key
      ? t(key)
      : t('modulePanel.errors.routingError', {
          code,
          name: meshtasticRoutingErrorName(code),
        });
    return appendClientNotificationDetail(base, code);
  }

  if (err instanceof Error && err.message.trim()) {
    return appendClientNotificationDetail(err.message, undefined);
  }

  return appendClientNotificationDetail(t('modulePanel.errors.generic'), undefined);
}
