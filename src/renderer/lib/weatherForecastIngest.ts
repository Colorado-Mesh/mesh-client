import type { GeoResolvedPlace, GeoResolvePlaceRequest } from '@/shared/geoPlace';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { isGroupChannelRecord, type MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import {
  WEATHER_FORECAST_MAX_AGE_MS,
  type WeatherForecastEntry,
  type WeatherForecastPositionSource,
} from '../stores/weatherForecastStore';
import { resolveNodeMapPosition } from './coordUtils';
import { errLikeToLogString } from './errLikeToLogString';
import {
  completeTruncatedIssued,
  isWeatherRequestCommand,
  normalizePlaceKey,
  type ParsedWeatherForecast,
  parseWeatherForecastPost,
  stripBotPrefixes,
} from './weatherForecastParse';

/** A `wx` request this long before a requester-located reply is taken as its trigger. */
export const WEATHER_REQUEST_MATCH_WINDOW_MS = 2 * MS_PER_MINUTE;
/** Multipart continuations attach to the sender's head post when they arrive within this window. */
export const WEATHER_CONTINUATION_WINDOW_MS = 5 * MS_PER_MINUTE;
const MAX_SEEN_IDS = 5000;

export interface LatLon {
  lat: number;
  lon: number;
}

/** One protocol's message/node buckets plus the senders the user marked as weather bots. */
export interface ForecastProtocolSnapshot {
  protocol: MeshProtocol;
  messages: Readonly<Record<string, MessageRecord>> | undefined;
  nodes: Readonly<Record<number, NodeRecord>> | undefined;
  markedSenders: ReadonlySet<number>;
  selfNodeNum?: number;
  trackedPosition: (nodeId: number) => LatLon | null;
}

export interface WeatherForecastIngestDeps {
  now: () => number;
  allowOnline: () => boolean;
  resolvePlace: (request: GeoResolvePlaceRequest) => Promise<GeoResolvedPlace | null>;
  upsert: (entry: WeatherForecastEntry) => void;
  appendSegments: (key: string, messageId: string, segments: readonly string[]) => void;
  completeIssued: (key: string, messageId: string, issuedAt: string) => void;
}

interface HeadPost {
  timestamp: number;
  /** Local time the head was registered, for the continuation window. */
  storedAt: number;
  /** Set while the head's `Issued` line is cut off; holds the partial value (may be empty). */
  truncatedIssued?: { partial?: string };
  /** Resolves to the store key and head message id once the head post is placed. */
  placed: Promise<{ key: string; messageId: string } | null>;
}

interface HeldContinuation {
  id: string;
  timestamp: number;
  lines: string[];
  heldAt: number;
}

function messageKey(protocol: string, messageId: string): string {
  return `${protocol}:${messageId}`;
}

/** One in-flight multipart forecast per sender and `[n/N]` total. */
function headKey(protocol: string, senderId: number, total: number): string {
  return `${protocol}:${senderId}:${total}`;
}

function nodePosition(snapshot: ForecastProtocolSnapshot, nodeId: number): LatLon | null {
  const node = snapshot.nodes?.[nodeId];
  return resolveNodeMapPosition(node ?? {}, snapshot.trackedPosition(nodeId));
}

function nodeName(snapshot: ForecastProtocolSnapshot, msg: MessageRecord): string | undefined {
  const node = snapshot.nodes?.[msg.from];
  return node?.longName || msg.senderName || node?.shortName || undefined;
}

function sameChannel(a: MessageRecord, b: MessageRecord): boolean {
  if (a.channelIndex !== b.channelIndex) return false;
  const aKey = a.channelKey ?? null;
  const bKey = b.channelKey ?? null;
  if (aKey == null && bKey == null) return true;
  return aKey != null && aKey === bKey;
}

/** Latest `wx` / `weather` command on the same channel shortly before the bot reply. */
export function findWeatherRequest(
  snapshot: ForecastProtocolSnapshot,
  reply: MessageRecord,
): MessageRecord | null {
  let best: MessageRecord | null = null;
  for (const msg of Object.values(snapshot.messages ?? {})) {
    if (msg.from === reply.from || !isGroupChannelRecord(msg) || !sameChannel(msg, reply)) continue;
    const age = reply.timestamp - msg.timestamp;
    if (age < 0 || age > WEATHER_REQUEST_MATCH_WINDOW_MS) continue;
    if (!isWeatherRequestCommand(msg.payload)) continue;
    if (!best || msg.timestamp > best.timestamp) best = msg;
  }
  return best;
}

function requesterKey(parsed: ParsedWeatherForecast, pos: LatLon): string {
  return `req:${parsed.profileId}:${pos.lat.toFixed(2)}:${pos.lon.toFixed(2)}`;
}

function continuationLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Turns marked-sender channel posts into map forecasts. A message is marked seen only after a
 * successful placement (or when it is not a forecast). Place lookups are async, and a multipart
 * continuation stays unmarked until its part 1 arrives or the continuation window ends.
 */
export class WeatherForecastIngestor {
  private readonly seen = new Set<string>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** Recent part-1 posts, keyed by sender and part total. */
  private readonly heads = new Map<string, HeadPost[]>();
  /** Part 2+ posts waiting for their part 1. Not marked seen. */
  private readonly held = new Map<string, HeldContinuation[]>();

  constructor(private readonly deps: WeatherForecastIngestDeps) {}

  /** Process unseen marked-sender posts; resolves when their placements finish. */
  scan(snapshots: readonly ForecastProtocolSnapshot[]): Promise<void> {
    const now = this.deps.now();
    this.expireHeld(now);
    const pending: Promise<unknown>[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.markedSenders.size === 0 || !snapshot.messages) continue;
      const candidates = Object.values(snapshot.messages)
        .filter(
          (m) =>
            snapshot.markedSenders.has(m.from) &&
            now - m.timestamp <= WEATHER_FORECAST_MAX_AGE_MS &&
            isGroupChannelRecord(m) &&
            !this.seen.has(messageKey(snapshot.protocol, m.id)),
        )
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const msg of candidates) {
        const id = messageKey(snapshot.protocol, msg.id);
        const inflight = this.inflight.get(id);
        if (inflight) {
          pending.push(
            inflight.then(() => {
              if (this.seen.has(id)) return undefined;
              return this.ingestMessage(snapshot, msg, now) ?? undefined;
            }),
          );
          continue;
        }
        const work = this.ingestMessage(snapshot, msg, now);
        if (work) pending.push(work);
      }
    }
    return Promise.all(pending).then(() => undefined);
  }

  private markSeen(id: string): void {
    if (this.seen.size >= MAX_SEEN_IDS) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.add(id);
  }

  private track(id: string, run: Promise<void>): Promise<void> {
    const tracked = run.finally(() => {
      if (this.inflight.get(id) === tracked) this.inflight.delete(id);
    });
    this.inflight.set(id, tracked);
    return tracked;
  }

  private expireHeld(now: number): void {
    for (const [key, list] of this.held) {
      const keep: HeldContinuation[] = [];
      for (const cont of list) {
        if (now - cont.heldAt > WEATHER_CONTINUATION_WINDOW_MS) this.markSeen(cont.id);
        else keep.push(cont);
      }
      if (keep.length === 0) this.held.delete(key);
      else if (keep.length !== list.length) this.held.set(key, keep);
    }
  }

  private matchHead(heads: readonly HeadPost[], contTs: number, now: number): HeadPost | null {
    let best: HeadPost | null = null;
    for (const head of heads) {
      if (now - head.storedAt > WEATHER_CONTINUATION_WINDOW_MS) continue;
      const delta = contTs - head.timestamp;
      if (delta < 0 || delta > WEATHER_CONTINUATION_WINDOW_MS) continue;
      if (!best || head.timestamp >= best.timestamp) best = head;
    }
    return best;
  }

  private rememberHeld(key: string, cont: HeldContinuation): void {
    const list = this.held.get(key);
    if (list) {
      if (!list.some((c) => c.id === cont.id)) list.push(cont);
      return;
    }
    this.held.set(key, [cont]);
  }

  private removeHeld(key: string, id: string): void {
    const list = this.held.get(key);
    if (!list) return;
    const keep = list.filter((c) => c.id !== id);
    if (keep.length === 0) this.held.delete(key);
    else this.held.set(key, keep);
  }

  private applyContinuation(head: HeadPost, cont: HeldContinuation): Promise<void> {
    const issued =
      head.truncatedIssued && cont.lines.length > 0
        ? completeTruncatedIssued(head.truncatedIssued.partial, cont.lines[0])
        : null;
    return head.placed.then((placed) => {
      if (!placed) return;
      if (issued) {
        head.truncatedIssued = undefined;
        this.deps.completeIssued(placed.key, placed.messageId, issued);
      }
      this.deps.appendSegments(
        placed.key,
        placed.messageId,
        issued ? cont.lines.slice(1) : cont.lines,
      );
      this.markSeen(cont.id);
    });
  }

  private flushHeld(key: string, head: HeadPost, now: number): Promise<void>[] {
    const waiting = this.held.get(key);
    if (!waiting) return [];
    const keep: HeldContinuation[] = [];
    const runs: Promise<void>[] = [];
    for (const cont of waiting) {
      if (this.matchHead([head], cont.timestamp, now)) {
        runs.push(this.track(cont.id, this.applyContinuation(head, cont)));
      } else {
        keep.push(cont);
      }
    }
    if (keep.length === 0) this.held.delete(key);
    else this.held.set(key, keep);
    return runs;
  }

  private ingestContinuation(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
    id: string,
    text: string,
    total: number,
    now: number,
  ): Promise<void> | null {
    const key = headKey(snapshot.protocol, msg.from, total);
    const cont: HeldContinuation = {
      id,
      timestamp: msg.timestamp,
      lines: continuationLines(text),
      heldAt: now,
    };
    const head = this.matchHead(this.heads.get(key) ?? [], msg.timestamp, now);
    if (head) {
      this.removeHeld(key, id);
      return this.track(id, this.applyContinuation(head, cont));
    }
    this.rememberHeld(key, cont);
    return null;
  }

  private ingestForecast(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
    id: string,
    parsed: ParsedWeatherForecast,
    part: { index: number; total: number } | undefined,
    now: number,
  ): Promise<void> {
    const placed = this.placeForecast(snapshot, msg, parsed).catch((err: unknown) => {
      console.warn('[weatherForecastIngest] place failed ' + errLikeToLogString(err));
      return null;
    });
    const flushed =
      part?.index === 1 && part.total >= 2
        ? this.registerHead(snapshot, msg, part.total, placed, parsed, now)
        : [];
    return this.track(
      id,
      Promise.all([
        placed.then((result) => {
          if (result) this.markSeen(id);
        }),
        ...flushed,
      ]).then(() => undefined),
    );
  }

  private registerHead(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
    total: number,
    placed: Promise<{ key: string; messageId: string } | null>,
    parsed: ParsedWeatherForecast,
    now: number,
  ): Promise<void>[] {
    const key = headKey(snapshot.protocol, msg.from, total);
    const head: HeadPost = {
      timestamp: msg.timestamp,
      storedAt: now,
      placed,
      truncatedIssued: parsed.issuedTruncated ? { partial: parsed.issuedAt } : undefined,
    };
    const list = (this.heads.get(key) ?? []).filter(
      (h) => now - h.storedAt <= WEATHER_CONTINUATION_WINDOW_MS,
    );
    list.push(head);
    this.heads.set(key, list);
    return this.flushHeld(key, head, now);
  }

  private ingestMessage(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
    now: number,
  ): Promise<void> | null {
    const id = messageKey(snapshot.protocol, msg.id);
    const { text, part } = stripBotPrefixes(msg.payload);
    const parsed = parseWeatherForecastPost(msg.payload);
    if (part != null && part.index >= 2 && part.index <= part.total && !parsed?.place) {
      return this.ingestContinuation(snapshot, msg, id, text, part.total, now);
    }
    if (!parsed) {
      this.markSeen(id);
      return null;
    }
    return this.ingestForecast(snapshot, msg, id, parsed, part, now);
  }

  private async placeForecast(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
    parsed: ParsedWeatherForecast,
  ): Promise<{ key: string; messageId: string } | null> {
    const senderPos = nodePosition(snapshot, msg.from);
    let pos: LatLon | null;
    let positionSource: WeatherForecastPositionSource = 'senderApprox';
    let key: string;
    let population: number | undefined;
    let resolvedLabel: string | undefined;
    let requesterName: string | undefined;

    if (parsed.place) {
      key = `place:${normalizePlaceKey(parsed.place)}`;
      const near =
        senderPos ??
        (snapshot.selfNodeNum != null ? nodePosition(snapshot, snapshot.selfNodeNum) : null);
      const resolved = await this.deps.resolvePlace({
        name: parsed.place.name,
        qualifiers: parsed.place.qualifiers,
        nearLat: near?.lat,
        nearLon: near?.lon,
        allowOnline: this.deps.allowOnline(),
      });
      if (resolved) {
        pos = { lat: resolved.lat, lon: resolved.lon };
        positionSource = resolved.source;
        population = resolved.population;
        resolvedLabel = resolved.label;
      } else {
        pos = senderPos;
      }
    } else {
      const request = findWeatherRequest(snapshot, msg);
      const requesterPos = request ? nodePosition(snapshot, request.from) : null;
      if (request) requesterName = nodeName(snapshot, request);
      if (requesterPos) {
        pos = requesterPos;
        positionSource = 'requester';
      } else {
        pos = senderPos;
      }
      key = pos ? requesterKey(parsed, pos) : '';
    }

    if (!pos) return null;
    this.deps.upsert({
      key,
      placeLabel: parsed.place?.label,
      resolvedLabel,
      lat: pos.lat,
      lon: pos.lon,
      population,
      positionSource,
      profileId: parsed.profileId,
      period: parsed.period,
      tempValue: parsed.tempValue,
      tempUnit: parsed.tempUnit,
      highLow: parsed.highLow,
      summary: parsed.summary,
      segments: parsed.segments,
      issuedAt: parsed.issuedAt,
      issuedTruncated: parsed.issuedTruncated,
      hasAlerts: parsed.hasAlerts,
      receivedAt: this.deps.now(),
      protocol: snapshot.protocol,
      senderId: msg.from,
      senderName: nodeName(snapshot, msg),
      requesterName,
      messageId: msg.id,
    });
    return { key, messageId: msg.id };
  }
}
