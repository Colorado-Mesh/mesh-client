import dns from 'node:dns/promises';
import https from 'node:https';
import type { LookupFunction } from 'node:net';

import WebSocket from 'ws';

import {
  BEACON_STATUS_CONNECTION_INTERRUPTED,
  BEACON_STATUS_FEED_OPEN_FAILED,
  BEACON_STATUS_REFRESHING,
  type BeaconConnectRequest,
  type BeaconFeedUpdate,
  type BeaconJsonObject,
  type RegionalFeedProvider,
} from '../shared/beacon';
import { isGlobalIpLiteral, isValidIpLiteral } from '../shared/ipLiteral';
import { MS_PER_SECOND } from '../shared/timeConstants';
import {
  coreScopeObserverRegions,
  coreScopePacket,
  readCoreScopeSnapshot,
} from './corescope-feed-adapter';
import {
  boundedRegionalRecord as boundedRecord,
  isRegionalObject as isObject,
  regionalDirectoryItems as directoryItems,
} from './regional-feed-data';

const FETCH_TIMEOUT_MS = 15 * MS_PER_SECOND;
const DNS_TIMEOUT_MS = 3 * MS_PER_SECOND;
const PING_INTERVAL_MS = 30 * MS_PER_SECOND;
const RECONNECT_MAX_MS = 30 * MS_PER_SECOND;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PACKET_BYTES = 256 * 1024;
const MAX_NODES = 5_000;
const PAGE_SIZE = 200;
const MAX_OBSERVERS = 1_000;
const MAX_PACKETS_PER_SECOND = 100;
const MAX_PARSE_FRAMES_PER_SECOND = 256;
const MAX_PARSE_BYTES_PER_SECOND = 2 * 1024 * 1024;
const CONTROL_PARSE_RESERVE = 8;
const MAX_CONTROL_BYTES = 1024;

interface BeaconAddress {
  address: string;
  family: 4 | 6;
}

export interface BeaconFeedDependencies {
  resolve: (hostname: string) => Promise<BeaconAddress>;
  getJson: (url: URL, address: BeaconAddress, signal: AbortSignal) => Promise<unknown>;
  openSocket: (url: URL, address: BeaconAddress) => WebSocket;
}

/** No credentials are accepted: Beacon's map feed is its public, read-only interface. */
export function parseBeaconConnectRequest(value: unknown): BeaconConnectRequest {
  if (!isObject(value) || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2_048) {
    throw new Error('Enter a public HTTPS regional map URL.');
  }
  let url: URL;
  try {
    url = new URL(value.baseUrl.trim());
  } catch {
    // catch-no-log-ok Return a fixed validation message without echoing URL credentials.
    throw new Error('Enter a valid HTTPS regional map URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.port && url.port !== '443')
  ) {
    throw new Error(
      'Use the HTTPS regional map origin without a path, port, query, or credentials.',
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    !host.includes('.') ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isValidIpLiteral(host)
  ) {
    throw new Error('Regional maps require a public internet hostname.');
  }
  const region = value.region;
  if (region !== undefined && (typeof region !== 'string' || !/^[a-z\d_-]{1,100}$/i.test(region))) {
    throw new Error('Select a valid region.');
  }
  const provider = value.provider;
  if (provider !== undefined && provider !== 'beacon' && provider !== 'corescope') {
    throw new Error('Select a supported regional map provider.');
  }
  return {
    baseUrl: url.origin,
    ...(region === undefined ? {} : { region }),
    ...(provider === undefined ? {} : { provider }),
  };
}

async function resolvePublicAddress(hostname: string): Promise<BeaconAddress> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      dns.lookup(hostname, { order: 'verbatim' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Regional map DNS lookup timed out.'));
        }, DNS_TIMEOUT_MS);
      }),
    ]);
    const global = isGlobalIpLiteral(result.address) === true;
    if (!global || (result.family !== 4 && result.family !== 6)) {
      throw new Error('Regional maps require a public internet address.');
    }
    return { address: result.address, family: result.family };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pinnedLookup(address: BeaconAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}

/** HTTPS and WS both connect to the validated DNS result, preventing DNS rebinding. */
function getJson(url: URL, address: BeaconAddress, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: pinnedLookup(address),
        signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
        headers: { Accept: 'application/json' },
      },
      (response) => {
        // Do not follow redirects into another origin or an intranet address.
        if (response.statusCode !== 200) {
          response.destroy();
          reject(new Error(`Regional map returned HTTP ${response.statusCode ?? 'error'}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('Regional map directory exceeded the size limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          } catch {
            // catch-no-log-ok Fixed error propagated to connection UI, no remote body logging.
            reject(new Error('Regional map returned invalid JSON.'));
          }
        });
      },
    );
    request.on('error', reject);
  });
}

const defaultDependencies: BeaconFeedDependencies = {
  resolve: resolvePublicAddress,
  getJson,
  openSocket: (url, address) =>
    new WebSocket(url, {
      lookup: pinnedLookup(address),
      maxPayload: MAX_PACKET_BYTES,
      handshakeTimeout: FETCH_TIMEOUT_MS,
      followRedirects: false,
      perMessageDeflate: false,
    }),
};

/** One opt-in read-only feed; callers dispose it when the map is no longer visible. */
export class BeaconFeedClient {
  private generation = 0;
  private abort: AbortController | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribeTimer: ReturnType<typeof setTimeout> | null = null;
  private request: BeaconConnectRequest | null = null;
  private provider: RegionalFeedProvider = 'beacon';
  private observerRegions: ReadonlyMap<string, string> = new Map();
  private retry = 0;
  private packetWindow = -Infinity;
  private packetCount = 0;
  private parseFrames = 0;
  private parseBytes = 0;
  private controlFrames = 0;

  constructor(
    private readonly onUpdate: (update: BeaconFeedUpdate) => void,
    private readonly dependencies: BeaconFeedDependencies = defaultDependencies,
  ) {}

  private emit(update: BeaconFeedUpdate): void {
    this.onUpdate({ ...update, provider: this.provider });
  }

  private emitTraffic(update: Extract<BeaconFeedUpdate, { type: 'packet' | 'message' }>): void {
    if (this.packetCount >= MAX_PACKETS_PER_SECOND) return;
    this.packetCount++;
    this.emit(update);
  }

  async connect(raw: BeaconConnectRequest): Promise<void> {
    const request = parseBeaconConnectRequest(raw);
    this.disconnect(false);
    this.request = request;
    this.provider = request.provider ?? 'beacon';
    this.abort = new AbortController();
    const generation = this.generation;
    this.emit({ type: 'status', status: 'connecting' });
    try {
      const address = await this.dependencies.resolve(new URL(request.baseUrl).hostname);
      if (generation !== this.generation) return;
      const snapshot = await this.readSnapshot(request, address, this.abort.signal);
      if (generation !== this.generation) return;
      this.observerRegions = coreScopeObserverRegions(snapshot.observers);
      this.emit(snapshot);
      this.openSocket(address, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.disconnect(false);
      this.emit({
        type: 'status',
        status: 'error',
        message: BEACON_STATUS_FEED_OPEN_FAILED,
      });
      throw error;
    }
  }

  private async readSnapshot(
    request: BeaconConnectRequest,
    address: BeaconAddress,
    signal: AbortSignal,
  ): Promise<Extract<BeaconFeedUpdate, { type: 'snapshot' }>> {
    const snapshot = new AbortController();
    const snapshotSignal = AbortSignal.any([signal, snapshot.signal]);
    try {
      snapshotSignal.throwIfAborted();
      return await this.readSnapshotResources(request, address, snapshotSignal);
    } finally {
      // Promise.all can reject before sibling crawls settle. Stop this attempt's I/O before retrying.
      snapshot.abort();
    }
  }

  private async readSnapshotJson(
    url: URL,
    address: BeaconAddress,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const value = await this.dependencies.getJson(url, address, signal);
    signal.throwIfAborted();
    return value;
  }

  private async readSnapshotResources(
    request: BeaconConnectRequest,
    address: BeaconAddress,
    signal: AbortSignal,
  ): Promise<Extract<BeaconFeedUpdate, { type: 'snapshot' }>> {
    if (request.provider === 'corescope') {
      return readCoreScopeSnapshot(request, (path) =>
        this.readSnapshotJson(new URL(path, request.baseUrl), address, signal),
      );
    }
    const regionUrl = new URL('/api/v1/regions', request.baseUrl);
    const messageUrl = new URL('/api/v1/messages?limit=100', request.baseUrl);
    if (request.region) messageUrl.searchParams.set('region', request.region);
    const [nodePage, observerPage, regionRows, messageRows] = await Promise.all([
      this.readPages(request, address, signal, 'nodes', MAX_NODES),
      this.readPages(request, address, signal, 'observers', MAX_OBSERVERS),
      this.readSnapshotJson(regionUrl, address, signal),
      this.readSnapshotJson(messageUrl, address, signal).catch(() => {
        // catch-no-log-ok Public messages are optional on older Beacon versions.
        return [];
      }),
    ]);
    const regions = directoryItems(regionRows, 100);
    if (request.region && !regions.some((region) => region.slug === request.region)) {
      throw new Error('The selected region is unavailable on this Beacon map.');
    }
    return {
      type: 'snapshot',
      nodes: nodePage.rows,
      observers: observerPage.rows,
      regions,
      messages: directoryItems(messageRows, 100),
      ...(nodePage.limited || observerPage.limited ? { directoryLimited: true } : {}),
    };
  }

  private async readPages(
    request: BeaconConnectRequest,
    address: BeaconAddress,
    signal: AbortSignal,
    resource: 'nodes' | 'observers',
    max: number,
  ): Promise<{ rows: BeaconJsonObject[]; limited: boolean }> {
    const rows: BeaconJsonObject[] = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < max / PAGE_SIZE; pageIndex++) {
      signal.throwIfAborted();
      const url = new URL(`/api/v1/${resource}`, request.baseUrl);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (request.region) url.searchParams.set('region', request.region);
      if (cursor) url.searchParams.set('cursor', cursor);
      const result = await this.readSnapshotJson(url, address, signal);
      const page = directoryItems(result, PAGE_SIZE);
      rows.push(...page);
      const next = isObject(result) ? result.nextCursor : null;
      if (
        !isObject(result) ||
        result.hasMore !== true ||
        (typeof next !== 'number' && typeof next !== 'string') ||
        String(next) === cursor ||
        String(next).length > 100
      )
        return { rows, limited: isObject(result) && result.hasMore === true };
      cursor = String(next);
    }
    return { rows, limited: true };
  }

  private openSocket(address: BeaconAddress, generation: number): void {
    const request = this.request;
    if (!request || generation !== this.generation) return;
    const coreScope = request.provider === 'corescope';
    const url = new URL(coreScope ? '/' : '/ws', request.baseUrl);
    url.protocol = 'wss:';
    const socket = this.dependencies.openSocket(url, address);
    this.socket = socket;
    let alive = true;
    socket.on('open', () => {
      if (generation !== this.generation || socket !== this.socket) return;
      if (coreScope) {
        // CoreScope broadcasts immediately; it has no subscription request or acknowledgement.
        this.emit({ type: 'status', status: 'live' });
      } else {
        socket.send(
          JSON.stringify({
            v: 1,
            type: 'configure',
            id: 'map-config',
            resolvePath: true,
            includeObserverKey: true,
            includeRepeats: true,
          }),
        );
        socket.send(
          JSON.stringify({
            v: 1,
            type: 'subscribe',
            id: 'map-feed',
            scope: {
              events: ['packetObservation', 'channelMessage'],
              ...(request.region ? { regionSlugs: [request.region] } : {}),
            },
          }),
        );
        this.subscribeTimer = setTimeout(() => {
          socket.terminate();
        }, FETCH_TIMEOUT_MS);
      }
      this.pingTimer = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        if (coreScope) socket.ping();
        // Beacon's idle deadline tracks application messages, not WebSocket control pings.
        else socket.send(JSON.stringify({ v: 1, type: 'ping', id: 'map-ping' }));
      }, PING_INTERVAL_MS);
    });
    socket.on('pong', () => {
      if (generation !== this.generation || socket !== this.socket) return;
      alive = true;
      if (coreScope) this.retry = 0;
    });
    socket.on('message', (data, isBinary) => {
      if (generation !== this.generation || socket !== this.socket || isBinary) return;
      alive = true;
      // Wall-clock corrections must neither stall a full budget nor grant another burst.
      const now = performance.now();
      if (now - this.packetWindow >= MS_PER_SECOND) {
        this.packetWindow = now;
        this.packetCount = 0;
        this.parseFrames = 0;
        this.parseBytes = 0;
        this.controlFrames = 0;
      }
      const byteLength = Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength;
      const controlOnly =
        this.parseFrames >= MAX_PARSE_FRAMES_PER_SECOND ||
        this.parseBytes + byteLength > MAX_PARSE_BYTES_PER_SECOND;
      if (controlOnly) {
        // A small independent reserve lets lagged/subscription notices through during bursts.
        if (byteLength > MAX_CONTROL_BYTES || this.controlFrames >= CONTROL_PARSE_RESERVE) return;
        this.controlFrames++;
      } else {
        this.parseFrames++;
        this.parseBytes += byteLength;
      }
      let message: unknown;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        message = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        // catch-no-log-ok Malformed public messages are ignored without reconnect/log floods.
        return;
      }
      if (!isObject(message)) return;
      if (message.type === 'lagged' || (message.type === 'event' && message.event === 'lagged')) {
        this.emit({
          type: 'status',
          status: 'reconnecting',
          message: BEACON_STATUS_REFRESHING,
        });
        socket.terminate();
        return;
      }
      if (!coreScope && message.type === 'subscribed' && message.id === 'map-feed') {
        if (this.subscribeTimer) clearTimeout(this.subscribeTimer);
        this.subscribeTimer = null;
        this.retry = 0;
        this.emit({ type: 'status', status: 'live' });
        return;
      }
      if (controlOnly) return;
      if (coreScope) {
        const packet = coreScopePacket(message, request.region, this.observerRegions);
        if (packet) {
          // An upgrade alone is not healthy: preserve backoff across open/close loops.
          this.retry = 0;
          this.emitTraffic({ type: 'packet', packet });
        }
        return;
      }
      if (message.type === 'event' && message.event === 'channelMessage') {
        const record = boundedRecord(message.data);
        if (record) this.emitTraffic({ type: 'message', message: record });
        return;
      }
      if (message.type !== 'event' || message.event !== 'packetObservation') return;
      const packet = boundedRecord(message.data);
      if (packet && isObject(packet.observation) && isObject(packet.packet)) {
        this.emitTraffic({ type: 'packet', packet });
      }
    });
    socket.on('error', () => {
      // The close event owns reconnect. Never log remote host/body/credential data.
      if (generation === this.generation) {
        this.emit({
          type: 'status',
          status: 'reconnecting',
          message: BEACON_STATUS_CONNECTION_INTERRUPTED,
        });
      }
    });
    socket.on('close', () => {
      if (generation !== this.generation || socket !== this.socket) return;
      this.clearPing();
      this.socket = null;
      this.scheduleReconnect(generation);
    });
  }

  private scheduleReconnect(generation: number): void {
    if (!this.request || generation !== this.generation) return;
    this.emit({ type: 'status', status: 'reconnecting' });
    const delay = Math.min(RECONNECT_MAX_MS, MS_PER_SECOND * 2 ** Math.min(this.retry++, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const request = this.request;
      if (!request || generation !== this.generation) return;
      const signal = this.abort?.signal;
      if (!signal) return;
      void this.dependencies
        .resolve(new URL(request.baseUrl).hostname)
        .then(async (address) => {
          if (generation !== this.generation) return;
          const snapshot = await this.readSnapshot(request, address, signal);
          if (generation !== this.generation) return;
          this.observerRegions = coreScopeObserverRegions(snapshot.observers);
          this.emit(snapshot);
          this.openSocket(address, generation);
        })
        .catch(() => {
          // Failure is visible via reconnecting status; retry with a bounded delay.
          this.scheduleReconnect(generation);
        });
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.subscribeTimer) clearTimeout(this.subscribeTimer);
    this.subscribeTimer = null;
  }

  disconnect(notify = true): void {
    this.generation++;
    this.packetWindow = -Infinity;
    this.packetCount = 0;
    this.parseFrames = 0;
    this.parseBytes = 0;
    this.controlFrames = 0;
    this.observerRegions = new Map();
    this.abort?.abort();
    this.abort = null;
    this.request = null;
    this.retry = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearPing();
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    if (notify) this.emit({ type: 'status', status: 'disconnected' });
  }
}
