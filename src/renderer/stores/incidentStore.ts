import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isBeacon, isBeaconAck, isBeaconCancel, type Severity } from '@/renderer/lib/mecp/engine';
import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { findOpenIncidentForAck, isGeneralAck } from '@/renderer/lib/mecp/mecpAck';
import {
  extractMecpCoords,
  incidentFingerprint,
  type MecpParsed,
  normalizeMecpFreetext,
} from '@/renderer/lib/mecp/mecpMessages';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

export type {
  EmergencyIncident,
  IncidentCoordsSource,
  IncidentStatus,
} from '@/renderer/lib/mecp/incidentTypes';

export const INCIDENT_STORE_KEY = 'mesh-client:incidents';
export const MAX_INCIDENTS = 200;
export const MAX_MESSAGE_IDS_PER_INCIDENT = 50;
/** Copies arriving shortly after Resolve (e.g. rebroadcast echoes) must not reopen the incident. */
export const INCIDENT_REOPEN_GRACE_MS = 5 * MS_PER_MINUTE;

export interface MecpIncidentInput {
  protocol: MeshProtocol;
  parsed: MecpParsed;
  senderId: string;
  senderName?: string;
  channel?: string | null;
  messageId?: string;
  receivedAt?: number;
  /** Sender's last known node position, used when the report carries no coordinates. */
  lastKnown?: { lat: number; lon: number } | null;
}

interface IncidentStoreState {
  incidents: Record<string, EmergencyIncident>;
  /**
   * Ingest an inbound MECP report. Returns the affected incident id, or null when no row
   * was created/updated. B02/B03/R01 never open rows: B02/R01 record an ACK on the matching
   * incident and B03 clears the sender's active beacon.
   */
  upsertFromMecp: (input: MecpIncidentInput) => string | null;
  recordAck: (incidentId: string, peerId: string) => void;
  /** Local operator acknowledged a B01 beacon (sent B02). */
  confirmBeacon: (incidentId: string) => void;
  resolveIncident: (incidentId: string, at?: number) => void;
  clearAll: () => void;
}

function isUnresolved(inc: EmergencyIncident): boolean {
  return inc.status !== 'resolved';
}

function sameCodeSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((c) => set.has(c));
}

/** Only runs when over the cap: drop oldest resolved first, then oldest by lastSeenAt. */
function pruneIncidents(
  incidents: Record<string, EmergencyIncident>,
): Record<string, EmergencyIncident> {
  const ids = Object.keys(incidents);
  if (ids.length <= MAX_INCIDENTS) return incidents;
  const ranked = ids
    .map((id) => incidents[id])
    .sort((a, b) => {
      const ar = a.status === 'resolved' ? 0 : 1;
      const br = b.status === 'resolved' ? 0 : 1;
      if (ar !== br) return ar - br;
      return (a.resolvedAt ?? a.lastSeenAt) - (b.resolvedAt ?? b.lastSeenAt);
    });
  const next: Record<string, EmergencyIncident> = {};
  for (const inc of ranked.slice(ids.length - MAX_INCIDENTS)) {
    next[inc.id] = inc;
  }
  return next;
}

function withAck(inc: EmergencyIncident, peerId: string): EmergencyIncident {
  if (inc.ackPeerIds.includes(peerId)) return inc;
  const ackPeerIds = [...inc.ackPeerIds, peerId];
  return {
    ...inc,
    ackPeerIds,
    ackCount: ackPeerIds.length,
    status: inc.status === 'open' ? 'acked' : inc.status,
  };
}

/**
 * Prefer selectors (`useIncidentStore((s) => s.incidents[id])`, `openIncidentCount`) over
 * bare `useIncidentStore()` so components re-render only on the slice they read.
 */
export const useIncidentStore = create<IncidentStoreState>()(
  persist(
    (set, get) => ({
      incidents: {},

      upsertFromMecp: (input) => {
        const { parsed, protocol, senderId } = input;
        if (parsed.severity === null) return null;
        const severity: Severity = parsed.severity;
        const now = input.receivedAt ?? Date.now();
        const all = get().incidents;

        if (isBeaconCancel(parsed.codes)) {
          const beacons = Object.values(all).filter(
            (inc) => isUnresolved(inc) && inc.beaconActive && inc.senderId === senderId,
          );
          if (beacons.length === 0) return null;
          set((s) => {
            const next = { ...s.incidents };
            for (const inc of beacons) {
              next[inc.id] = { ...inc, beaconActive: false, lastSeenAt: now };
            }
            return { incidents: next };
          });
          return beacons[0].id;
        }

        if (isBeaconAck(parsed.codes) || isGeneralAck(parsed.codes)) {
          const target = findOpenIncidentForAck(Object.values(all), {
            severity,
            codes: parsed.codes,
            senderId,
          });
          if (!target) return null;
          get().recordAck(target.id, senderId);
          return target.id;
        }

        const freetext = parsed.freetext ?? '';
        const id = incidentFingerprint({ severity, codes: parsed.codes, freetext, senderId });
        const normalizedText = normalizeMecpFreetext(freetext);
        const existing =
          all[id] ??
          Object.values(all).find(
            (inc) =>
              isUnresolved(inc) &&
              inc.senderId === senderId &&
              sameCodeSet(inc.codes, parsed.codes) &&
              normalizeMecpFreetext(inc.freetext) === normalizedText,
          );

        const msgCoords = extractMecpCoords(freetext);
        const coords = msgCoords ?? input.lastKnown ?? null;
        const coordsSource = msgCoords ? 'message' : input.lastKnown ? 'lastKnown' : null;
        const beacon = isBeacon(parsed.codes);

        if (!existing) {
          const created: EmergencyIncident = {
            id,
            protocol,
            protocolsSeen: [protocol],
            severity,
            codes: [...parsed.codes],
            freetext,
            senderId,
            senderName: input.senderName ?? senderId,
            channel: input.channel ?? null,
            receivedAt: now,
            lastSeenAt: now,
            ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
            coordsSource,
            messageIds: input.messageId ? [input.messageId] : [],
            ackCount: 0,
            ackPeerIds: [],
            beaconActive: beacon,
            beaconAcked: false,
            isDrill: parsed.isDrill,
            status: 'open',
          };
          set((s) => ({ incidents: pruneIncidents({ ...s.incidents, [id]: created }) }));
          return id;
        }

        const reopen =
          existing.status === 'resolved' &&
          now - (existing.resolvedAt ?? 0) > INCIDENT_REOPEN_GRACE_MS;
        const messageIds =
          input.messageId && !existing.messageIds.includes(input.messageId)
            ? [...existing.messageIds, input.messageId].slice(-MAX_MESSAGE_IDS_PER_INCIDENT)
            : existing.messageIds;
        // Message coordinates always win over lastKnown; never downgrade message → lastKnown.
        const keepCoords = existing.coordsSource === 'message' && !msgCoords;
        const merged: EmergencyIncident = {
          ...existing,
          protocol,
          protocolsSeen: existing.protocolsSeen.includes(protocol)
            ? existing.protocolsSeen
            : [...existing.protocolsSeen, protocol],
          severity: Math.min(existing.severity, severity) as Severity,
          lastSeenAt: Math.max(existing.lastSeenAt, now),
          senderName: input.senderName ?? existing.senderName,
          channel: input.channel ?? existing.channel,
          messageIds,
          ...(keepCoords || !coords
            ? {}
            : { lat: coords.lat, lon: coords.lon, coordsSource: coordsSource }),
          beaconActive: existing.beaconActive || beacon,
          ...(reopen ? { status: 'open' as const, resolvedAt: undefined } : {}),
        };
        set((s) => ({ incidents: { ...s.incidents, [existing.id]: merged } }));
        return existing.id;
      },

      recordAck: (incidentId, peerId) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.status === 'resolved' || inc.senderId === peerId) return s;
          const next = withAck(inc, peerId);
          return next === inc ? s : { incidents: { ...s.incidents, [incidentId]: next } };
        }),

      confirmBeacon: (incidentId) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.beaconAcked) return s;
          return {
            incidents: {
              ...s.incidents,
              [incidentId]: {
                ...inc,
                beaconAcked: true,
                status: inc.status === 'open' ? 'acked' : inc.status,
              },
            },
          };
        }),

      resolveIncident: (incidentId, at) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.status === 'resolved') return s;
          return {
            incidents: {
              ...s.incidents,
              [incidentId]: {
                ...inc,
                status: 'resolved',
                resolvedAt: at ?? Date.now(),
                beaconActive: false,
              },
            },
          };
        }),

      clearAll: () => set({ incidents: {} }),
    }),
    {
      name: INCIDENT_STORE_KEY,
      version: 1,
      partialize: (state) => ({ incidents: state.incidents }),
    },
  ),
);

/** Unresolved non-drill incidents. */
export function openIncidentCount(state: Pick<IncidentStoreState, 'incidents'>): number {
  let n = 0;
  for (const inc of Object.values(state.incidents)) {
    if (isUnresolved(inc) && !inc.isDrill) n++;
  }
  return n;
}

/** Unresolved non-drill MAYDAY (0) / URGENT (1) incidents. */
export function openMaydayUrgentCount(state: Pick<IncidentStoreState, 'incidents'>): number {
  let n = 0;
  for (const inc of Object.values(state.incidents)) {
    if (isUnresolved(inc) && !inc.isDrill && inc.severity <= 1) n++;
  }
  return n;
}

/** Unresolved incidents, most severe first, then most recent. Returns a new array; memoize callers. */
export function selectOpenIncidentsSorted(
  state: Pick<IncidentStoreState, 'incidents'>,
): EmergencyIncident[] {
  return Object.values(state.incidents)
    .filter(isUnresolved)
    .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt);
}
