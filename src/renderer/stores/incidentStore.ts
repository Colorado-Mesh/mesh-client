import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isBeacon, isBeaconAck, isBeaconCancel, type Severity } from '@/renderer/lib/mecp/engine';
import type { EmergencyIncident, IncidentEvent } from '@/renderer/lib/mecp/incidentTypes';
import { findOpenIncidentForAck, isGeneralAck } from '@/renderer/lib/mecp/mecpAck';
import {
  extractMecpCoords,
  incidentFingerprint,
  incidentPayloadMatchKey,
  type MecpParsed,
  normalizeMecpFreetext,
  normalizeMecpFreetextForMatch,
} from '@/renderer/lib/mecp/mecpMessages';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_HOUR, MS_PER_MINUTE } from '@/shared/timeConstants';

export type {
  EmergencyIncident,
  IncidentCoordsSource,
  IncidentEvent,
  IncidentEventKind,
  IncidentStatus,
} from '@/renderer/lib/mecp/incidentTypes';

export const INCIDENT_STORE_KEY = 'mesh-client:incidents';
export const MAX_INCIDENTS = 200;
export const MAX_MESSAGE_IDS_PER_INCIDENT = 50;
/** Only distinct ACK peers grow a timeline without bound; ~80 B per event in localStorage. */
export const MAX_EVENTS_PER_INCIDENT = 500;
/** Copies arriving shortly after Resolve (e.g. rebroadcast echoes) must not reopen the incident. */
export const INCIDENT_REOPEN_GRACE_MS = 5 * MS_PER_MINUTE;
/** Bridged copies from a different sender id merge when payload matches within this window. */
export const CROSS_PROTOCOL_MERGE_WINDOW_MS = 10 * MS_PER_MINUTE;
/** Hydration seed ignores MECP older than this (avoids resurrecting ancient MAYDAYs). */
export const INCIDENT_SEED_MAX_AGE_MS = 24 * MS_PER_HOUR;
/** Cap tombstone map size (oldest resolvedAt pruned first). */
export const MAX_RESOLVED_TOMBSTONES = 500;

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
  /**
   * When true (hydration seed), skip own/history/old messages and honor resolved tombstones.
   * Live path leaves this unset.
   */
  fromSeed?: boolean;
  /** Set when the message is this station's own distress beacon (or its B03). */
  localOrigin?: boolean;
  /** Unicast `to` of an originated beacon; omitted for channel broadcasts. */
  beaconCancelToNode?: number | null;
}

interface IncidentStoreState {
  incidents: Record<string, EmergencyIncident>;
  /**
   * Fingerprints (or ids) of resolved/pruned incidents so hydration cannot reopen them.
   * Survives `clearAll` of live rows.
   */
  resolvedTombstones: Record<string, number>;
  /**
   * Ingest an inbound MECP report. Returns the affected incident id, or null when no row
   * was created/updated. B02/B03/R01 never open rows: B02/R01 record an ACK on the matching
   * incident and B03 clears the sender's active beacon.
   */
  upsertFromMecp: (input: MecpIncidentInput) => string | null;
  /** `at` is when the ACK was heard (message time); defaults to now for local sends. */
  recordAck: (incidentId: string, peerId: string, at?: number) => void;
  /** Local operator acknowledged a B01 beacon (sent B02). */
  confirmBeacon: (incidentId: string) => void;
  /**
   * Close the row locally. Does not transmit — an originated beacon cancel is
   * `resolveIncidentWithBeaconCancel` in `beaconCancel.ts`.
   */
  resolveIncident: (incidentId: string, at?: number) => void;
  /** Local operator has looked at the incident. Never transmits. */
  markSeen: (incidentId: string, at?: number) => void;
  /** Mark every unresolved incident seen (operator opened the Incident tab). */
  markAllSeen: (at?: number) => void;
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

function isOpenCritical(inc: EmergencyIncident): boolean {
  return isUnresolved(inc) && !inc.isDrill && inc.severity <= 1;
}

/**
 * Evict when over the cap: resolved first, then drills, then higher severity number (ROUTINE
 * before SAFETY), then oldest. Never evict open MAYDAY/URGENT — allow temporary over-cap.
 */
function pruneIncidents(
  incidents: Record<string, EmergencyIncident>,
  tombstones: Record<string, number>,
): { incidents: Record<string, EmergencyIncident>; resolvedTombstones: Record<string, number> } {
  const ids = Object.keys(incidents);
  if (ids.length <= MAX_INCIDENTS) return { incidents, resolvedTombstones: tombstones };
  const ranked = ids
    .map((id) => incidents[id])
    .sort((a, b) => {
      const aCrit = isOpenCritical(a) ? 1 : 0;
      const bCrit = isOpenCritical(b) ? 1 : 0;
      if (aCrit !== bCrit) return aCrit - bCrit; // non-critical first (evictable)
      const ar = a.status === 'resolved' ? 0 : a.isDrill ? 1 : 2;
      const br = b.status === 'resolved' ? 0 : b.isDrill ? 1 : 2;
      if (ar !== br) return ar - br;
      if (a.severity !== b.severity) return b.severity - a.severity; // higher sev number first
      return (a.resolvedAt ?? a.lastSeenAt) - (b.resolvedAt ?? b.lastSeenAt);
    });
  const next: Record<string, EmergencyIncident> = {};
  const nextTombs = { ...tombstones };
  const keepFrom = Math.max(0, ranked.length - MAX_INCIDENTS);
  for (let i = 0; i < ranked.length; i++) {
    const inc = ranked[i];
    if (i < keepFrom && isOpenCritical(inc)) {
      // Never drop open sev 0/1 — keep even if over cap.
      next[inc.id] = inc;
      continue;
    }
    if (i < keepFrom) {
      if (inc.status === 'resolved' || isUnresolved(inc)) {
        const at = inc.resolvedAt ?? inc.lastSeenAt;
        nextTombs[inc.id] = at;
        const payloadKey = payloadTombstoneKeyIfDistinct(inc.severity, inc.codes, inc.freetext);
        if (payloadKey != null) nextTombs[payloadKey] = at;
      }
      continue;
    }
    next[inc.id] = inc;
  }
  return {
    incidents: next,
    resolvedTombstones: pruneTombstones(nextTombs),
  };
}

function pruneTombstones(tombs: Record<string, number>): Record<string, number> {
  const ids = Object.keys(tombs);
  if (ids.length <= MAX_RESOLVED_TOMBSTONES) return tombs;
  const ranked = ids.sort((a, b) => tombs[a] - tombs[b]);
  const next: Record<string, number> = {};
  for (const id of ranked.slice(ids.length - MAX_RESOLVED_TOMBSTONES)) {
    next[id] = tombs[id];
  }
  return next;
}

function appendEvent(
  events: readonly IncidentEvent[] | undefined,
  event: IncidentEvent,
): IncidentEvent[] {
  const next = [...(events ?? []), event];
  if (next.length <= MAX_EVENTS_PER_INCIDENT) return next;
  // Keep the original report; drop the oldest events after it.
  const first = next[0];
  return first.kind === 'received'
    ? [first, ...next.slice(-(MAX_EVENTS_PER_INCIDENT - 1))]
    : next.slice(-MAX_EVENTS_PER_INCIDENT);
}

function withAck(inc: EmergencyIncident, peerId: string, at: number): EmergencyIncident {
  if (inc.ackPeerIds.includes(peerId)) return inc;
  const ackPeerIds = [...inc.ackPeerIds, peerId];
  const event: IncidentEvent =
    peerId === 'local' ? { at, kind: 'ackSent' } : { at, kind: 'ackHeard', peerId };
  return {
    ...inc,
    ackPeerIds,
    ackCount: ackPeerIds.length,
    status: inc.status === 'open' ? 'acked' : inc.status,
    events: appendEvent(inc.events, event),
  };
}

function findExistingIncident(
  all: Record<string, EmergencyIncident>,
  opts: {
    id: string;
    senderId: string;
    protocol: MeshProtocol;
    severity: Severity;
    codes: string[];
    freetext: string;
    now: number;
  },
): EmergencyIncident | undefined {
  const byId = all[opts.id];
  if (byId) return byId;

  const matchText = normalizeMecpFreetextForMatch(opts.freetext);
  const matchFull = normalizeMecpFreetext(opts.freetext);

  let sameSender: EmergencyIncident | undefined;
  let crossProtocol: EmergencyIncident | undefined;
  for (const inc of Object.values(all)) {
    if (!isUnresolved(inc)) continue;
    if (!sameCodeSet(inc.codes, opts.codes)) continue;
    // Same sender: GPS-stripped text match so a position update does not fork a row.
    if (inc.senderId === opts.senderId) {
      if (normalizeMecpFreetextForMatch(inc.freetext) !== matchText) continue;
      sameSender = inc;
      break;
    }
    // Bridged relay: only a *new* protocol, non-empty stripped text, and identical payload
    // including coords. Empty stripped text (GPS-only one-tap MAYDAY) must not merge two
    // victims on the same or different protocols.
    if (inc.protocolsSeen.includes(opts.protocol)) continue;
    if (matchText.length === 0) continue;
    if (normalizeMecpFreetext(inc.freetext) !== matchFull) continue;
    if (opts.now - inc.receivedAt <= CROSS_PROTOCOL_MERGE_WINDOW_MS && !crossProtocol) {
      crossProtocol = inc;
    }
  }
  return sameSender ?? crossProtocol;
}

/** Tombstone key for payload identity (survives relay / escalated fingerprint variants). */
function payloadTombstoneKey(
  severity: Severity,
  codes: readonly string[],
  freetext: string,
): string {
  return `payload:${incidentPayloadMatchKey({ severity, codes: [...codes], freetext })}`;
}

/**
 * Payload tombs omit sender, so GPS-only MAYDAYs (empty stripped text) would collide across
 * victims. Only tombstone by payload when stripped freetext is non-empty.
 */
function payloadTombstoneKeyIfDistinct(
  severity: Severity,
  codes: readonly string[],
  freetext: string,
): string | null {
  if (normalizeMecpFreetextForMatch(freetext).length === 0) return null;
  return payloadTombstoneKey(severity, codes, freetext);
}

/**
 * Prefer selectors (`useIncidentStore((s) => s.incidents[id])`, `openIncidentCount`) over
 * bare `useIncidentStore()` so components re-render only on the slice they read.
 */
export const useIncidentStore = create<IncidentStoreState>()(
  persist(
    (set, get) => ({
      incidents: {},
      resolvedTombstones: {},

      upsertFromMecp: (input) => {
        const { parsed, protocol, senderId } = input;
        if (parsed.severity === null) return null;
        const severity: Severity = parsed.severity;
        const now = input.receivedAt ?? Date.now();
        const all = get().incidents;
        const tombs = get().resolvedTombstones;

        if (isBeaconCancel(parsed.codes)) {
          // A hydrated B03 must not clear a beacon heard after it (DB load can land after live RX).
          const beacons = Object.values(all).filter(
            (inc) =>
              isUnresolved(inc) &&
              inc.beaconActive &&
              inc.senderId === senderId &&
              (!input.fromSeed || inc.lastSeenAt <= now),
          );
          if (beacons.length === 0) return null;
          set((s) => {
            const next = { ...s.incidents };
            for (const inc of beacons) {
              next[inc.id] = {
                ...inc,
                beaconActive: false,
                lastSeenAt: now,
                events: appendEvent(inc.events, {
                  at: now,
                  kind: 'beaconCancelled',
                  peerId: senderId,
                  protocol,
                }),
              };
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
          get().recordAck(target.id, senderId, now);
          return target.id;
        }

        const freetext = parsed.freetext ?? '';
        const id = incidentFingerprint({ severity, codes: parsed.codes, freetext, senderId });
        const payloadTomb = payloadTombstoneKeyIfDistinct(severity, parsed.codes, freetext);

        if (input.fromSeed) {
          if (tombs[id] != null || (payloadTomb != null && tombs[payloadTomb] != null)) return null;
          if (now > 0 && Date.now() - now > INCIDENT_SEED_MAX_AGE_MS) return null;
        }

        const existing = findExistingIncident(all, {
          id,
          senderId,
          protocol,
          severity,
          codes: parsed.codes,
          freetext,
          now,
        });

        if (input.fromSeed && existing) {
          const existingPayloadTomb = payloadTombstoneKeyIfDistinct(
            existing.severity,
            existing.codes,
            existing.freetext,
          );
          if (
            tombs[existing.id] != null ||
            (existingPayloadTomb != null && tombs[existingPayloadTomb] != null) ||
            existing.status === 'resolved'
          ) {
            return null;
          }
        }

        const isRelay = existing != null && existing.senderId !== senderId;
        const msgCoords = extractMecpCoords(freetext);
        // Relays must not overwrite the victim's pin with the bridge node's lastKnown.
        const coords = msgCoords ?? (isRelay ? null : input.lastKnown) ?? null;
        const coordsSource = msgCoords
          ? 'message'
          : !isRelay && input.lastKnown
            ? 'lastKnown'
            : null;
        const beacon = isBeacon(parsed.codes);

        if (!existing) {
          if (
            input.fromSeed &&
            (tombs[id] != null || (payloadTomb != null && tombs[payloadTomb] != null))
          )
            return null;
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
            ...(input.localOrigin && beacon ? { localOrigin: true } : {}),
            ...(beacon && typeof input.beaconCancelToNode === 'number'
              ? { beaconCancelToNode: input.beaconCancelToNode }
              : {}),
            isDrill: parsed.isDrill,
            status: 'open',
            ...(input.fromSeed || input.localOrigin ? { seenAt: now } : {}),
            events: [{ at: now, kind: 'received', peerId: senderId, protocol }],
          };
          set((s) => {
            const pruned = pruneIncidents({ ...s.incidents, [id]: created }, s.resolvedTombstones);
            return pruned;
          });
          return id;
        }

        const reopen =
          existing.status === 'resolved' &&
          now - (existing.resolvedAt ?? 0) > INCIDENT_REOPEN_GRACE_MS;
        if (existing.status === 'resolved' && !reopen) return null;

        const messageIds =
          input.messageId && !existing.messageIds.includes(input.messageId)
            ? [...existing.messageIds, input.messageId].slice(-MAX_MESSAGE_IDS_PER_INCIDENT)
            : existing.messageIds;
        // Message coordinates always win over lastKnown; never apply coords from a relay copy.
        const keepCoords = isRelay || (existing.coordsSource === 'message' && !msgCoords);
        const relaySenderIds = isRelay
          ? [...new Set([...(existing.relaySenderIds ?? []), senderId])].slice(-20)
          : existing.relaySenderIds;
        const markLocalOrigin =
          existing.localOrigin === true || (!isRelay && input.localOrigin === true);
        const beaconCancelToNode =
          existing.beaconCancelToNode ??
          (!isRelay && beacon && typeof input.beaconCancelToNode === 'number'
            ? input.beaconCancelToNode
            : undefined);
        const mergedSeverity = Math.min(existing.severity, severity) as Severity;
        // A live reopen or escalation into MAYDAY/URGENT needs the operator's attention again.
        const needsAttention =
          !input.fromSeed &&
          !input.localOrigin &&
          mergedSeverity <= 1 &&
          (reopen || mergedSeverity < existing.severity);
        let events = existing.events;
        if (reopen) {
          events = appendEvent(events, { at: now, kind: 'reopened', peerId: senderId, protocol });
        }
        if (isRelay || !existing.protocolsSeen.includes(protocol)) {
          events = appendEvent(events, { at: now, kind: 'relayHeard', peerId: senderId, protocol });
        }
        const merged: EmergencyIncident = {
          ...existing,
          protocol,
          protocolsSeen: existing.protocolsSeen.includes(protocol)
            ? existing.protocolsSeen
            : [...existing.protocolsSeen, protocol],
          severity: mergedSeverity,
          lastSeenAt: Math.max(existing.lastSeenAt, now),
          // Keep original victim identity; relays are recorded separately.
          senderName: isRelay ? existing.senderName : (input.senderName ?? existing.senderName),
          channel: isRelay ? existing.channel : (input.channel ?? existing.channel),
          messageIds,
          ...(relaySenderIds ? { relaySenderIds } : {}),
          ...(keepCoords || !coords
            ? {}
            : { lat: coords.lat, lon: coords.lon, coordsSource: coordsSource }),
          freetext: isRelay ? existing.freetext : msgCoords ? freetext : existing.freetext,
          beaconActive: existing.beaconActive || beacon,
          ...(markLocalOrigin ? { localOrigin: true } : {}),
          ...(beaconCancelToNode != null ? { beaconCancelToNode } : {}),
          ...(reopen ? { status: 'open' as const, resolvedAt: undefined } : {}),
          ...(needsAttention ? { seenAt: undefined } : {}),
          ...(events ? { events } : {}),
        };
        set((s) => {
          let nextTombs = s.resolvedTombstones;
          if (reopen) {
            const payloadKey = payloadTombstoneKeyIfDistinct(
              existing.severity,
              existing.codes,
              existing.freetext,
            );
            nextTombs = Object.fromEntries(
              Object.entries(s.resolvedTombstones).filter(
                ([key]) => key !== existing.id && key !== payloadKey,
              ),
            );
          }
          return {
            incidents: { ...s.incidents, [existing.id]: merged },
            resolvedTombstones: nextTombs,
          };
        });
        return existing.id;
      },

      recordAck: (incidentId, peerId, at) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.status === 'resolved' || inc.senderId === peerId) return s;
          const next = withAck(inc, peerId, at ?? Date.now());
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
                seenAt: inc.seenAt ?? Date.now(),
                events: appendEvent(inc.events, { at: Date.now(), kind: 'beaconConfirmed' }),
              },
            },
          };
        }),

      resolveIncident: (incidentId, at) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.status === 'resolved') return s;
          const resolvedAt = at ?? Date.now();
          const nextTombs: Record<string, number> = {
            ...s.resolvedTombstones,
            [incidentId]: resolvedAt,
          };
          const payloadKey = payloadTombstoneKeyIfDistinct(inc.severity, inc.codes, inc.freetext);
          if (payloadKey != null) nextTombs[payloadKey] = resolvedAt;
          return {
            incidents: {
              ...s.incidents,
              [incidentId]: {
                ...inc,
                status: 'resolved',
                resolvedAt,
                beaconActive: false,
                seenAt: inc.seenAt ?? resolvedAt,
                events: appendEvent(inc.events, { at: resolvedAt, kind: 'resolved' }),
              },
            },
            resolvedTombstones: pruneTombstones(nextTombs),
          };
        }),

      markSeen: (incidentId, at) =>
        set((s) => {
          const inc = s.incidents[incidentId];
          if (!inc || inc.seenAt != null) return s;
          return {
            incidents: { ...s.incidents, [incidentId]: { ...inc, seenAt: at ?? Date.now() } },
          };
        }),

      markAllSeen: (at) =>
        set((s) => {
          const seenAt = at ?? Date.now();
          let next: Record<string, EmergencyIncident> | null = null;
          for (const inc of Object.values(s.incidents)) {
            if (inc.seenAt != null || !isUnresolved(inc)) continue;
            next ??= { ...s.incidents };
            next[inc.id] = { ...inc, seenAt };
          }
          return next ? { incidents: next } : s;
        }),

      clearAll: () => set({ incidents: {} }),
    }),
    {
      name: INCIDENT_STORE_KEY,
      version: 3,
      partialize: (state) => ({
        incidents: state.incidents,
        resolvedTombstones: state.resolvedTombstones,
      }),
      migrate: (persisted, version) => {
        const p = persisted as Partial<IncidentStoreState> | undefined;
        const incidents = p?.incidents ?? {};
        // Rows stored before seenAt existed predate the standing alert; never surface them.
        if (version < 3) {
          for (const inc of Object.values(incidents)) {
            inc.seenAt ??= inc.lastSeenAt;
          }
        }
        return {
          incidents,
          resolvedTombstones: p?.resolvedTombstones ?? {},
        };
      },
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

/**
 * Incident tab badge: unresolved MAYDAY (0) / URGENT (1), drills included so a drill exercises
 * the same response path. Quit confirmation keeps `openMaydayUrgentCount` (real emergencies).
 */
export function incidentTabBadgeCount(state: Pick<IncidentStoreState, 'incidents'>): number {
  let n = 0;
  for (const inc of Object.values(state.incidents)) {
    if (isUnresolved(inc) && inc.severity <= 1) n++;
  }
  return n;
}

/**
 * Live, unresolved, non-drill MAYDAY/URGENT incidents the operator has not looked at yet,
 * most severe first then most recent. Returns a new array; use with `useShallow`.
 */
export function selectUnseenCriticalIncidents(
  state: Pick<IncidentStoreState, 'incidents'>,
): EmergencyIncident[] {
  return Object.values(state.incidents)
    .filter((inc) => isOpenCritical(inc) && inc.seenAt == null)
    .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt);
}

/** Unresolved incidents, most severe first, then most recent. Returns a new array; memoize callers. */
export function selectOpenIncidentsSorted(
  state: Pick<IncidentStoreState, 'incidents'>,
): EmergencyIncident[] {
  return Object.values(state.incidents)
    .filter(isUnresolved)
    .sort((a, b) => a.severity - b.severity || b.lastSeenAt - a.lastSeenAt);
}
