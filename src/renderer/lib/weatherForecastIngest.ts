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
}

interface HeadPost {
  timestamp: number;
  /** Resolves to the store key and head message id once the head post is placed. */
  placed: Promise<{ key: string; messageId: string } | null>;
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
  return !a.channelKey || !b.channelKey || a.channelKey === b.channelKey;
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
 * Turns marked-sender channel posts into map forecasts. Each message is handled once; place
 * lookups are async, and multipart continuations wait for their head post.
 */
export class WeatherForecastIngestor {
  private readonly seen = new Set<string>();
  private readonly heads = new Map<string, HeadPost>();

  constructor(private readonly deps: WeatherForecastIngestDeps) {}

  /** Process unseen marked-sender posts; resolves when their placements finish. */
  scan(snapshots: readonly ForecastProtocolSnapshot[]): Promise<void> {
    const now = this.deps.now();
    const pending: Promise<unknown>[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.markedSenders.size === 0 || !snapshot.messages) continue;
      const candidates = Object.values(snapshot.messages)
        .filter(
          (m) =>
            snapshot.markedSenders.has(m.from) &&
            now - m.timestamp <= WEATHER_FORECAST_MAX_AGE_MS &&
            isGroupChannelRecord(m) &&
            !this.seen.has(`${snapshot.protocol}:${m.id}`),
        )
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const msg of candidates) {
        this.markSeen(`${snapshot.protocol}:${msg.id}`);
        const work = this.ingestMessage(snapshot, msg);
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

  private ingestMessage(
    snapshot: ForecastProtocolSnapshot,
    msg: MessageRecord,
  ): Promise<unknown> | null {
    const senderKey = `${snapshot.protocol}:${msg.from}`;
    const parsed = parseWeatherForecastPost(msg.payload);
    const { text, part } = stripBotPrefixes(msg.payload);
    const head = this.heads.get(senderKey);
    const isContinuation =
      part != null &&
      part.index >= 2 &&
      head != null &&
      msg.timestamp - head.timestamp <= WEATHER_CONTINUATION_WINDOW_MS &&
      !parsed?.place;
    if (isContinuation) {
      const lines = continuationLines(text);
      return head.placed.then((placed) => {
        if (placed) this.deps.appendSegments(placed.key, placed.messageId, lines);
      });
    }
    if (!parsed) return null;
    const placed = this.placeForecast(snapshot, msg, parsed).catch((err: unknown) => {
      console.warn('[weatherForecastIngest] place failed ' + errLikeToLogString(err));
      return null;
    });
    this.heads.set(senderKey, { timestamp: msg.timestamp, placed });
    return placed;
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
      hasAlerts: parsed.hasAlerts,
      receivedAt: msg.timestamp,
      protocol: snapshot.protocol,
      senderId: msg.from,
      senderName: nodeName(snapshot, msg),
      requesterName,
      messageId: msg.id,
    });
    return { key, messageId: msg.id };
  }
}
