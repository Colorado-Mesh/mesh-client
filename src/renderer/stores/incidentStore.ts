import { create } from 'zustand';

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
import {
  INCIDENT_STORAGE_VERSION,
  INCIDENT_STORE_KEY,
  parseIncidentSnapshot,
  parseLegacyIncidentStorage,
} from '@/shared/incidentStorage';
import type { IncidentSnapshot } from '@/shared/incidentTypes';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_HOUR, MS_PER_MINUTE } from '@/shared/timeConstants';

export type {
  EmergencyIncident,
  IncidentCoordsSource,
  IncidentEvent,
  IncidentEventKind,
  IncidentStatus,
} from '@/renderer/lib/mecp/incidentTypes';
export { INCIDENT_STORE_KEY } from '@/shared/incidentStorage';
export const MAX_INCIDENTS = 200;
export const MAX_MESSAGE_IDS_PER_INCIDENT = 50;
/** Bound the timeline per incident, preserving the original report and newest events. */
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
  /**
   * Alert-throttled sender: record the row but never raise the standing alert for it
   * (created already seen; escalation/reopen does not clear `seenAt`).
   */
  quiet?: boolean;
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
let legacyCacheRaw: string | null = null;
let legacyCacheReadable = true;

export const useIncidentStore = create<IncidentStoreState>()((set, get) => {
  const state: IncidentStoreState = {
    ...readLegacyIncidentCache(),

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
      const coordsSource = msgCoords ? 'message' : !isRelay && input.lastKnown ? 'lastKnown' : null;
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
          ...(input.fromSeed || input.localOrigin || input.quiet ? { seenAt: now } : {}),
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
        !input.quiet &&
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

    recordAck: (incidentId, peerId, at) => {
      set((s) => {
        const inc = s.incidents[incidentId];
        if (!inc || inc.status === 'resolved' || inc.senderId === peerId) return s;
        const next = withAck(inc, peerId, at ?? Date.now());
        return next === inc ? s : { incidents: { ...s.incidents, [incidentId]: next } };
      });
    },

    confirmBeacon: (incidentId) => {
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
      });
    },

    resolveIncident: (incidentId, at) => {
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
      });
    },

    markSeen: (incidentId, at) => {
      set((s) => {
        const inc = s.incidents[incidentId];
        if (!inc || inc.seenAt != null) return s;
        return {
          incidents: { ...s.incidents, [incidentId]: { ...inc, seenAt: at ?? Date.now() } },
        };
      });
    },

    markAllSeen: (at) => {
      set((s) => {
        const seenAt = at ?? Date.now();
        let next: Record<string, EmergencyIncident> | null = null;
        for (const inc of Object.values(s.incidents)) {
          if (inc.seenAt != null || !isUnresolved(inc)) continue;
          next ??= { ...s.incidents };
          next[inc.id] = { ...inc, seenAt };
        }
        return next ? { incidents: next } : s;
      });
    },

    clearAll: () => {
      set({ incidents: {} });
    },
  };
  return {
    ...state,
    upsertFromMecp: trackMutation(state.upsertFromMecp),
    recordAck: trackMutation(state.recordAck),
    confirmBeacon: trackMutation(state.confirmBeacon),
    resolveIncident: trackMutation(state.resolveIncident),
    markSeen: trackMutation(state.markSeen),
    markAllSeen: trackMutation(state.markAllSeen),
    clearAll: trackMutation(state.clearAll),
  };
});

let hydrated = false;
let hydration: Promise<void> | null = null;
let pendingMutations: (() => unknown)[] = [];
const INCIDENT_PENDING_KEY = 'mesh-client:incidentPending';
interface PendingIncidentWrite {
  baseline: IncidentSnapshot;
  value: IncidentSnapshot;
}
let baseline = incidentSnapshot();
let pendingWrite = readPendingIncidentWrite();
let recoveryAtLoad = pendingWrite;
let flushing: Promise<void> | undefined;
let mutationDepth = 0;
let replaying = false;

function readLegacyIncidentCache(): IncidentSnapshot {
  try {
    legacyCacheRaw = localStorage.getItem(INCIDENT_STORE_KEY);
    return parseLegacyIncidentStorage(legacyCacheRaw);
  } catch (error) {
    legacyCacheReadable = false;
    console.warn('[incidents] Could not read legacy incident cache:', error);
    return { incidents: {}, resolvedTombstones: {} };
  }
}

function incidentSnapshot(): IncidentSnapshot {
  const { incidents, resolvedTombstones } = useIncidentStore.getState();
  return { incidents, resolvedTombstones };
}

function writeLegacyIncidentCache(): void {
  if (!legacyCacheReadable && !hydrated) return;
  try {
    localStorage.setItem(
      INCIDENT_STORE_KEY,
      JSON.stringify({ state: incidentSnapshot(), version: INCIDENT_STORAGE_VERSION }),
    );
  } catch (error) {
    console.warn('[incidents] Could not update recovery cache:', error);
  }
}

function readPendingIncidentWrite(): PendingIncidentWrite | null {
  try {
    const raw = localStorage.getItem(INCIDENT_PENDING_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { baseline?: unknown; value?: unknown } | null;
    return {
      baseline: parseIncidentSnapshot(parsed?.baseline),
      value: parseIncidentSnapshot(parsed?.value),
    };
  } catch (error) {
    console.warn('[incidents] Could not read pending incident journal:', error);
    return null;
  }
}

function savePendingIncidentWrite(): void {
  try {
    if (pendingWrite) localStorage.setItem(INCIDENT_PENDING_KEY, JSON.stringify(pendingWrite));
    else localStorage.removeItem(INCIDENT_PENDING_KEY);
  } catch (error) {
    console.warn('[incidents] Could not update pending incident journal:', error);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Apply only local edits, preserving database-only incident fields and timeline entries. */
function replayIncidentChanges(
  pending: PendingIncidentWrite,
  durable: IncidentSnapshot,
): IncidentSnapshot {
  const incidents = new Map(Object.entries(durable.incidents));
  for (const id of new Set([
    ...Object.keys(pending.baseline.incidents),
    ...Object.keys(pending.value.incidents),
  ])) {
    const before = pending.baseline.incidents[id];
    const after = pending.value.incidents[id];
    if (sameValue(before, after)) continue;
    if (!after) {
      incidents.delete(id);
      continue;
    }
    const existing = incidents.get(id);
    // A stale pending edit must not resurrect a database-only tombstone after a crash.
    if (
      !existing &&
      Object.hasOwn(durable.resolvedTombstones, id) &&
      !after.events?.some(
        (event) =>
          event.kind === 'reopened' &&
          event.at > durable.resolvedTombstones[id] + INCIDENT_REOPEN_GRACE_MS,
      )
    )
      continue;
    if (!existing) {
      incidents.set(id, after);
      continue;
    }
    const merged = { ...existing } as unknown as Record<string, unknown>;
    const previous = before as unknown as Record<string, unknown> | undefined;
    const latest = after as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(previous ?? {}), ...Object.keys(latest)])) {
      if (sameValue(previous?.[key], latest[key])) continue;
      if (!Object.hasOwn(latest, key)) {
        Reflect.deleteProperty(merged, key);
        continue;
      }
      if (Array.isArray(latest[key]) && Array.isArray(merged[key])) {
        const removed = new Set(
          (Array.isArray(previous?.[key]) ? previous[key] : [])
            .filter(
              (item: unknown) =>
                !(latest[key] as unknown[]).some((other) => sameValue(item, other)),
            )
            .map((item: unknown) => JSON.stringify(item)),
        );
        const entries = new Map(
          (merged[key] as unknown[])
            .filter((item) => !removed.has(JSON.stringify(item)))
            .map((item) => [JSON.stringify(item), item]),
        );
        for (const item of latest[key] as unknown[]) entries.set(JSON.stringify(item), item);
        merged[key] = [...entries.values()];
      } else merged[key] = latest[key];
    }
    const incident = merged as unknown as EmergencyIncident;
    incident.ackCount = incident.ackPeerIds.length;
    incident.receivedAt = Math.min(existing.receivedAt, incident.receivedAt);
    incident.lastSeenAt = Math.max(existing.lastSeenAt, incident.lastSeenAt);
    incident.severity = Math.min(existing.severity, incident.severity) as Severity;
    incident.messageIds = incident.messageIds.slice(-MAX_MESSAGE_IDS_PER_INCIDENT);
    if (incident.events) {
      const ordered = [...incident.events].sort((a, b) => a.at - b.at);
      incident.events =
        ordered.length <= MAX_EVENTS_PER_INCIDENT
          ? ordered
          : [ordered[0], ...ordered.slice(-(MAX_EVENTS_PER_INCIDENT - 1))];
    }
    if (
      existing.status === 'resolved' &&
      after.status !== 'resolved' &&
      !after.events?.some(
        (event) =>
          event.kind === 'reopened' &&
          event.at > (existing.resolvedAt ?? existing.lastSeenAt) + INCIDENT_REOPEN_GRACE_MS,
      )
    ) {
      incident.status = existing.status;
      incident.resolvedAt = existing.resolvedAt;
      incident.seenAt = existing.seenAt;
    }
    incidents.set(id, incident);
  }
  const tombstones = new Map(Object.entries(durable.resolvedTombstones));
  for (const id of new Set([
    ...Object.keys(pending.baseline.resolvedTombstones),
    ...Object.keys(pending.value.resolvedTombstones),
  ])) {
    const before = pending.baseline.resolvedTombstones[id];
    const after = pending.value.resolvedTombstones[id];
    if (before === after) continue;
    if (after === undefined) {
      if (tombstones.get(id) === before) tombstones.delete(id);
    } else tombstones.set(id, Math.max(tombstones.get(id) ?? after, after));
  }
  return pruneIncidents(
    Object.fromEntries(incidents),
    pruneTombstones(Object.fromEntries(tombstones)),
  );
}

function queueIncidentWrite(): Promise<void> {
  if (flushing) return flushing;
  const save = typeof window === 'undefined' ? undefined : window.electronAPI?.db?.saveIncidents;
  if (!hydrated || !pendingWrite || !save) return Promise.resolve();
  let failed = false;
  flushing = (async () => {
    while (pendingWrite) {
      const write: PendingIncidentWrite = pendingWrite;
      try {
        await save(write.value);
      } catch (error) {
        failed = true;
        console.warn('[incidents] SQLite write failed; pending journal retained:', error);
        break;
      }
      baseline = write.value;
      pendingWrite = pendingWrite === write ? null : { baseline, value: pendingWrite.value };
      savePendingIncidentWrite();
    }
  })().finally(() => {
    flushing = undefined;
    if (pendingWrite && !failed) return queueIncidentWrite();
  });
  return flushing;
}

function trackMutation<T extends unknown[], R>(action: (...args: T) => R): (...args: T) => R {
  return (...args) => {
    // Replay operations, rather than overlaying stale rows, so DB tombstones win over history seed.
    if (!hydrated && !replaying && mutationDepth === 0) {
      pendingMutations.push(() => action(...args));
    }
    const previous = useIncidentStore.getState();
    let result: R;
    mutationDepth++;
    try {
      result = action(...args);
    } finally {
      mutationDepth--;
    }
    if (!replaying && mutationDepth === 0 && useIncidentStore.getState() !== previous) {
      pendingWrite = { baseline: pendingWrite?.baseline ?? baseline, value: incidentSnapshot() };
      savePendingIncidentWrite();
      writeLegacyIncidentCache();
      if (hydrated) void queueIncidentWrite();
      else void hydrateIncidentStore();
    }
    return result;
  };
}

/** Await before mounting alert watchers and startup track pruning. Safe to call repeatedly. */
export function hydrateIncidentStore(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  const seed = typeof window === 'undefined' ? undefined : window.electronAPI?.db?.seedIncidents;
  if (!seed) return Promise.resolve();
  hydration = (async () => {
    try {
      // Main's durable marker makes repeated imports harmless, including after clearAll.
      const snapshot = parseIncidentSnapshot(await seed(legacyCacheRaw));
      useIncidentStore.setState(
        recoveryAtLoad ? replayIncidentChanges(recoveryAtLoad, snapshot) : snapshot,
      );
      replaying = true;
      try {
        for (const replay of pendingMutations) replay();
      } finally {
        replaying = false;
      }
      pendingMutations = [];
      recoveryAtLoad = null;
      baseline = snapshot;
      const value = incidentSnapshot();
      pendingWrite = sameValue(snapshot, value) ? null : { baseline, value };
      savePendingIncidentWrite();
      hydrated = true;
      writeLegacyIncidentCache();
      await queueIncidentWrite();
    } catch (error) {
      // Leave in-memory/cache data and queued mutations intact. A later action retries hydration.
      console.warn('[incidents] SQLite hydration failed; using recovery cache:', error);
    } finally {
      hydration = null;
    }
  })();
  return hydration;
}

/** Flush/retry pending persistence; useful before explicit exports or orderly teardown. */
export async function flushIncidentPersistence(): Promise<void> {
  await hydrateIncidentStore();
  await queueIncidentWrite();
}

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
