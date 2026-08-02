/** Map sidecar `nomad.page_progress` events into Nomad viewer loading copy. */

export interface NomadPageProgressPayload {
  destination_hash?: string;
  path?: string;
  phase?: string;
  /** Client correlation id from the page fetch (`request_id` query param). */
  request_id?: string;
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

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

/**
 * Narrow unknown WS payloads into Nomad progress fields.
 * Requires `destination_hash` and `phase` strings; other fields must match types when present.
 */
export function asNomadPageProgressPayload(payload: unknown): NomadPageProgressPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.destination_hash !== 'string' || typeof o.phase !== 'string') return null;
  if (o.path !== undefined && typeof o.path !== 'string') return null;
  if (o.request_id !== undefined && typeof o.request_id !== 'string') return null;
  if (o.round !== undefined && (typeof o.round !== 'number' || !Number.isFinite(o.round))) {
    return null;
  }
  if (o.iface !== undefined && o.iface !== null && typeof o.iface !== 'string') return null;
  if (o.via_prefix !== undefined && o.via_prefix !== null && typeof o.via_prefix !== 'string') {
    return null;
  }
  if (o.hops !== undefined && (typeof o.hops !== 'number' || !Number.isFinite(o.hops))) {
    return null;
  }
  if (
    o.timeout_secs !== undefined &&
    (typeof o.timeout_secs !== 'number' || !Number.isFinite(o.timeout_secs))
  ) {
    return null;
  }
  return {
    destination_hash: o.destination_hash,
    phase: o.phase,
    path: typeof o.path === 'string' ? o.path : undefined,
    request_id: typeof o.request_id === 'string' ? o.request_id : undefined,
    round: optionalFiniteNumber(o.round),
    iface: optionalNullableString(o.iface),
    via_prefix: optionalNullableString(o.via_prefix),
    hops: optionalFiniteNumber(o.hops),
    timeout_secs: optionalFiniteNumber(o.timeout_secs),
  };
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
  requestId?: string | null,
): boolean {
  if (requestId != null && requestId !== '') {
    if ((payload.request_id ?? '') !== requestId) return false;
  }
  const dest = payload.destination_hash?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
  const selected = selectedHash?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
  if (!dest || !selected || dest !== selected) return false;
  const eventPath = payload.path?.trim();
  const loadPath = pagePath?.trim();
  if (eventPath && loadPath && eventPath !== loadPath) return false;
  return true;
}
