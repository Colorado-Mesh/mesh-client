/** Map sidecar `nomad.page_progress` events into Nomad viewer loading copy. */

export interface NomadPageProgressPayload {
  destination_hash?: string;
  path?: string;
  phase?: string;
  round?: number;
  iface?: string | null;
  via_prefix?: string | null;
  hops?: number;
  timeout_secs?: number;
}

export interface NomadPageLoadingProgress {
  messageKey: string;
  messageParams: Record<string, string | number>;
  /** Extra seconds to add to the loading countdown (failover Link budget). */
  addBudgetSecs?: number;
}

function cleanIface(iface: string | null | undefined): string | null {
  const trimmed = iface?.trim();
  return trimmed ? trimmed : null;
}

function cleanHops(hops: number | null | undefined): number | null {
  return typeof hops === 'number' && Number.isFinite(hops) && hops >= 0 ? hops : null;
}

/** Narrow unknown WS payloads into optional Nomad progress fields. */
export function asNomadPageProgressPayload(payload: unknown): NomadPageProgressPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload;
}

/**
 * Convert a sidecar progress payload into an i18n key + params.
 * Returns null for unknown/empty phases so the UI keeps the generic countdown.
 */
export function mapNomadPageProgress(
  payload: NomadPageProgressPayload | null | undefined,
): NomadPageLoadingProgress | null {
  if (!payload) return null;
  const phase = payload.phase?.trim().toLowerCase();
  if (!phase) return null;

  const iface = cleanIface(payload.iface ?? undefined);
  const hops = cleanHops(payload.hops);
  const timeoutSecs =
    typeof payload.timeout_secs === 'number' &&
    Number.isFinite(payload.timeout_secs) &&
    payload.timeout_secs > 0
      ? Math.floor(payload.timeout_secs)
      : undefined;

  switch (phase) {
    case 'link_attempt':
      if (iface && hops != null) {
        return {
          messageKey: 'nomadNetwork.pageProgressLinking',
          messageParams: { iface, hops },
        };
      }
      if (iface) {
        return {
          messageKey: 'nomadNetwork.pageProgressLinkingIface',
          messageParams: { iface },
        };
      }
      return {
        messageKey: 'nomadNetwork.pageProgressLinkingGeneric',
        messageParams: {},
      };
    case 'link_timeout':
      if (iface) {
        return {
          messageKey: 'nomadNetwork.pageProgressDeadRoute',
          messageParams: { iface },
        };
      }
      return {
        messageKey: 'nomadNetwork.pageProgressDeadRouteGeneric',
        messageParams: {},
      };
    case 'searching_route':
      return {
        messageKey: 'nomadNetwork.pageProgressSearchingRoute',
        messageParams: {},
      };
    case 'failover':
      if (iface && hops != null) {
        return {
          messageKey: 'nomadNetwork.pageProgressFailover',
          messageParams: { iface, hops },
          addBudgetSecs: timeoutSecs,
        };
      }
      if (iface) {
        return {
          messageKey: 'nomadNetwork.pageProgressFailoverIface',
          messageParams: { iface },
          addBudgetSecs: timeoutSecs,
        };
      }
      return {
        messageKey: 'nomadNetwork.pageProgressFailoverGeneric',
        messageParams: {},
        addBudgetSecs: timeoutSecs,
      };
    case 'no_alternate_route':
      return {
        messageKey: 'nomadNetwork.pageProgressNoAlternate',
        messageParams: {},
      };
    default:
      return null;
  }
}

/** True when the progress event belongs to the active Nomad page load. */
export function nomadPageProgressMatchesLoad(
  payload: NomadPageProgressPayload,
  selectedHash: string | null,
  pagePath: string | null,
): boolean {
  const dest = payload.destination_hash?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
  const selected = selectedHash?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
  if (!dest || !selected || dest !== selected) return false;
  const eventPath = payload.path?.trim();
  const loadPath = pagePath?.trim();
  if (eventPath && loadPath && eventPath !== loadPath) return false;
  return true;
}
