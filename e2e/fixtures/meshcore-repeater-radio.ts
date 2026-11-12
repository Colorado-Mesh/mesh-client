import { createServer, type Socket } from 'node:net';

/**
 * Companion radio plus one zero-hop repeater, for repeater admin tests. No RF.
 *
 * The repeater follows MeshCore firmware `examples/simple_repeater/MyMesh.cpp`
 * (commit 98d1f762):
 * - A request is decoded only for a client in the access list (`searchPeersByHash`).
 * - A request or login whose timestamp is not newer than the client's last one is dropped.
 * - A reply to a direct request goes out on the client's stored return path; a flood
 *   request gets a flood path-return, which also repairs the path both ways.
 * - A flood login clears the stored return path.
 * The companion floods when the contact path length is -1 (OUT_PATH_UNKNOWN) and sends
 * direct otherwise, including length 0.
 */

export type RepeaterReturnPath = 'unknown' | 'good' | 'stale';

export interface RepeaterClient {
  admin: boolean;
  returnPath: RepeaterReturnPath;
  lastTimestamp: number;
}

export interface RepeaterRadioEvent {
  atMs: number;
  kind:
    | 'login'
    | 'status'
    | 'telemetry'
    | 'binary'
    | 'trace'
    | 'resetPath'
    | 'drop'
    | 'lost'
    | 'reply'
    | 'pathLearned';
  route?: 'flood' | 'direct';
  detail?: string;
}

export const REPEATER_ADMIN_PASSWORD = 'e2e-admin';
const REPEATER_NAME = 'Hilltop Repeater';
const OUT_PATH_UNKNOWN = -1;
const FLOOD_EST_TIMEOUT_MS = 4000;
const DIRECT_EST_TIMEOUT_MS = 1200;
const REPEATER_REPLY_DELAY_MS = 300;

export interface RepeaterRadioOptions {
  /** Companion path hash mode: 0, 1 or 2 for 1-, 2- or 3-byte path hashes. */
  pathHashMode?: 0 | 1 | 2;
  /**
   * Add a second repeater that is out of the companion's range: it is reached through
   * `relays` relay repeaters in a chain, and the radio already holds that route as the
   * contact's out_path with `hashSizeBytes` per relay.
   */
  farRepeater?: {
    relays: 1 | 2;
    hashSizeBytes: 1 | 2 | 3;
    /** Bytes an older route left after the relays in the path buffer (default two). */
    staleTail?: number[];
  };
}

export const FAR_REPEATER_NAME = 'Far Ridge Repeater';
/** Bytes an older, longer route left in the far contact's path buffer after the current one. */
const FAR_ROUTE_STALE_TAIL = [0xee, 0xdd];

/** A 32-byte key whose first three bytes are given, so 1-, 2- and 3-byte hashes differ. */
function keyWithLead(lead: [number, number, number]): Buffer {
  const key = Buffer.alloc(32, 0x5a);
  Buffer.from(lead).copy(key, 0);
  return key;
}

export async function startMeshcoreRepeaterRadio(selfId = 171, options: RepeaterRadioOptions = {}) {
  const sockets = new Set<Socket>();
  const events: RepeaterRadioEvent[] = [];
  const startedAt = Date.now();
  let contactPathLen = 0;
  /**
   * The repeater contact's 64-byte out_path. Firmware replaces a route with `copyPath` and
   * never clears the bytes after it, and CMD_RESET_PATH only changes the length, so a contact
   * once reached through relays keeps their hashes here after it is heard direct.
   */
  const repeaterOutPath = Buffer.alloc(64);
  let client: RepeaterClient | null = null;
  let pingMode: 'answer' | 'silent' | 'reject' = 'answer';
  let lastCompanionTimestamp = 0;

  const log = (event: Omit<RepeaterRadioEvent, 'atMs'>) => {
    events.push({ atMs: Date.now() - startedAt, ...event });
  };
  const text = (value: string, length: number) => {
    const bytes = Buffer.alloc(length);
    bytes.write(value, 0, length - 1);
    return bytes;
  };
  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value >>> 0);
    return bytes;
  };
  const selfKey = Buffer.alloc(32);
  selfKey.writeUInt32LE(selfId);
  const repeaterKey = Buffer.from(Array.from({ length: 32 }, (_, i) => (0xc3 + i * 7) & 0xff));
  const far = options.farRepeater;
  const farKey = keyWithLead([0x07, 0xc3, 0x13]);
  const relayKeys = [keyWithLead([0x57, 0xa1, 0x11]), keyWithLead([0x21, 0xb2, 0x12])].slice(
    0,
    far?.relays ?? 0,
  );
  /** Nodes a trace must visit to reach the far repeater and come back to the companion. */
  const farRoundTrip = [...relayKeys, farKey, ...relayKeys.slice().reverse()];
  /** The zero-hop repeater also hears the far repeater, so a trace may turn through it. */
  const farRoundTripViaRepeater = [repeaterKey, farKey, repeaterKey];
  /**
   * False: the radio has no route to the far repeater (out_path_len 0xFF). As after
   * CMD_RESET_PATH, the path buffer still holds the route it had.
   */
  let farRouteKnown = true;
  /** Firmware packs a contact route as hop count (low 6 bits) and hash size code (high 2). */
  const farContactPathLen = far ? relayKeys.length | ((far.hashSizeBytes - 1) << 6) : 0;
  const farContactOutPath = () => {
    const outPath = Buffer.alloc(64);
    const size = far?.hashSizeBytes ?? 1;
    relayKeys.forEach((key, i) => key.copy(outPath, i * size, 0, size));
    Buffer.from(far?.staleTail ?? FAR_ROUTE_STALE_TAIL).copy(outPath, relayKeys.length * size);
    return outPath;
  };
  const self = Buffer.concat([
    Buffer.from([5, 1, 22, 22]),
    selfKey,
    Buffer.alloc(12),
    u32(902000000),
    u32(250000),
    Buffer.from([10, 5]),
    Buffer.from('Test Radio'),
  ]);
  const broadcast = (payload: Buffer) => {
    const header = Buffer.from([0x3e, payload.length & 255, payload.length >> 8]);
    for (const socket of sockets) socket.write(Buffer.concat([header, payload]));
  };
  /** Firmware `getCurrentTimeUnique()`: seconds, never repeating. */
  const companionTimestamp = () => {
    lastCompanionTimestamp = Math.max(Math.floor(Date.now() / 1000), lastCompanionTimestamp + 1);
    return lastCompanionTimestamp;
  };
  const sendRoute = (): 'flood' | 'direct' =>
    contactPathLen === OUT_PATH_UNKNOWN ? 'flood' : 'direct';
  const sent = (route: 'flood' | 'direct', tag: number) =>
    Buffer.concat([
      Buffer.from([6, route === 'flood' ? 1 : 0]),
      u32(tag),
      u32(route === 'flood' ? FLOOD_EST_TIMEOUT_MS : DIRECT_EST_TIMEOUT_MS),
    ]);
  /** A flood exchange teaches the companion a zero-hop path and the repeater its way back. */
  const learnPathBothWays = () => {
    contactPathLen = 0;
    if (client) client.returnPath = 'good';
    log({ kind: 'pathLearned' });
    broadcast(Buffer.concat([Buffer.from([0x81]), repeaterKey]));
  };
  /** Carry a repeater reply back to the companion, or lose it on a stale return path. */
  const deliverReply = (
    what: RepeaterRadioEvent['kind'],
    requestRoute: 'flood' | 'direct',
    push: Buffer,
  ) => {
    if (!client) return;
    if (requestRoute === 'direct' && client.returnPath === 'stale') {
      log({ kind: 'lost', route: requestRoute, detail: `${what} reply sent on stale return path` });
      return;
    }
    setTimeout(() => {
      if (requestRoute === 'flood') learnPathBothWays();
      log({ kind: 'reply', route: requestRoute, detail: what });
      broadcast(push);
    }, REPEATER_REPLY_DELAY_MS);
  };
  /** Firmware `onPeerDataRecv` gate for PAYLOAD_TYPE_REQ. */
  const acceptRequest = (what: RepeaterRadioEvent['kind'], timestamp: number): boolean => {
    if (!client) {
      log({ kind: 'drop', detail: `${what}: sender not in access list` });
      return false;
    }
    if (timestamp <= client.lastTimestamp) {
      log({ kind: 'drop', detail: `${what}: timestamp not newer (replay check)` });
      return false;
    }
    client.lastTimestamp = timestamp;
    return true;
  };
  const statusData = () => {
    const data = Buffer.alloc(60);
    data.writeUInt16LE(4100, 0); // batt_milli_volts
    data.writeInt16LE(-112, 4); // noise_floor
    data.writeInt16LE(-71, 6); // last_rssi
    data.writeUInt32LE(1234, 8); // n_packets_recv
    data.writeUInt32LE(987, 12); // n_packets_sent
    data.writeUInt32LE(3600, 20); // total_up_time_secs
    return data;
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    const send = (payload: Buffer) => {
      const header = Buffer.from([0x3e, payload.length & 255, payload.length >> 8]);
      socket.write(Buffer.concat([header, payload]));
    };
    const receive = (command: Buffer) => {
      switch (command[0]) {
        case 1:
          send(self);
          break;
        case 22:
          send(
            Buffer.concat([
              Buffer.from([13, 14, 100, 40, 0, 0, 0, 0]),
              text('2026-10-27', 12),
              text('E2E Radio', 40),
              text('1.18.0', 20),
              Buffer.from([0, options.pathHashMode ?? 0]), // client_repeat, path hash mode
            ]),
          );
          break;
        case 4: {
          const now = Math.floor(Date.now() / 1000);
          const pathLen = Buffer.alloc(1);
          pathLen.writeInt8(contactPathLen);
          send(Buffer.concat([Buffer.from([2]), u32(far ? 2 : 1)]));
          if (far) {
            send(
              Buffer.concat([
                Buffer.from([3]),
                farKey,
                Buffer.from([2, 0]), // ADV_TYPE_REPEATER, flags
                Buffer.from([farRouteKnown ? farContactPathLen : 0xff]),
                farContactOutPath(),
                text(FAR_REPEATER_NAME, 32),
                u32(now),
                Buffer.alloc(8),
                u32(now),
              ]),
            );
          }
          send(
            Buffer.concat([
              Buffer.from([3]),
              repeaterKey,
              Buffer.from([2, 0]), // ADV_TYPE_REPEATER, flags
              pathLen,
              repeaterOutPath,
              text(REPEATER_NAME, 32),
              u32(now),
              Buffer.alloc(8),
              u32(now),
            ]),
          );
          send(Buffer.concat([Buffer.from([4]), u32(0)]));
          break;
        }
        case 13: // CMD_RESET_PATH
          contactPathLen = OUT_PATH_UNKNOWN;
          log({ kind: 'resetPath' });
          send(Buffer.from([0]));
          break;
        case 26: {
          // CMD_SEND_LOGIN
          const supplied = command.subarray(33).toString().split('\0')[0];
          const route = sendRoute();
          const timestamp = companionTimestamp();
          log({ kind: 'login', route });
          send(sent(route, timestamp));
          // Firmware handleLoginReq: a blank password only passes for a known client.
          const isAdminLogin = [REPEATER_ADMIN_PASSWORD].includes(supplied);
          if (!isAdminLogin && !(supplied === '' && client)) {
            log({ kind: 'drop', detail: 'login: wrong password' });
            break;
          }
          if (isAdminLogin) {
            if (client && timestamp <= client.lastTimestamp) {
              log({ kind: 'drop', detail: 'login: timestamp not newer (replay check)' });
              break;
            }
            client = {
              admin: true,
              returnPath: client?.returnPath ?? 'unknown',
              lastTimestamp: timestamp,
            };
          }
          if (route === 'flood' && client) client.returnPath = 'unknown';
          deliverReply(
            'login',
            route,
            Buffer.concat([
              Buffer.from([0x85, client?.admin ? 1 : 0]),
              repeaterKey.subarray(0, 6),
              u32(Math.floor(Date.now() / 1000)),
              Buffer.from([client?.admin ? 3 : 2, 2]),
            ]),
          );
          break;
        }
        case 27: {
          // CMD_SEND_STATUS_REQ
          const route = sendRoute();
          const timestamp = companionTimestamp();
          log({ kind: 'status', route });
          send(sent(route, timestamp));
          if (!acceptRequest('status', timestamp)) break;
          deliverReply(
            'status',
            route,
            Buffer.concat([
              Buffer.from([0x87, 0]),
              // The reply names the repeater that was asked (the request carries its key).
              (far && command.subarray(1, 33).equals(farKey) ? farKey : repeaterKey).subarray(0, 6),
              statusData(),
            ]),
          );
          break;
        }
        case 39: {
          // CMD_SEND_TELEMETRY_REQ (4-byte form is the companion's own telemetry)
          if (command.length < 36) {
            send(Buffer.from([1, 2]));
            break;
          }
          const route = sendRoute();
          const timestamp = companionTimestamp();
          log({ kind: 'telemetry', route });
          send(sent(route, timestamp));
          if (!acceptRequest('telemetry', timestamp)) break;
          deliverReply(
            'telemetry',
            route,
            Buffer.concat([
              Buffer.from([0x8b, 0]),
              repeaterKey.subarray(0, 6),
              Buffer.from([1, 116, 0x01, 0x9a]), // Cayenne LPP channel 1 voltage 4.10 V
            ]),
          );
          break;
        }
        case 50: {
          // CMD_SEND_BINARY_REQ: answer neighbours with an empty page
          const route = sendRoute();
          const timestamp = companionTimestamp();
          log({ kind: 'binary', route });
          send(sent(route, timestamp));
          if (!acceptRequest('binary', timestamp)) break;
          deliverReply(
            'binary',
            route,
            Buffer.concat([Buffer.from([0x8c, 0]), u32(timestamp), Buffer.alloc(4)]),
          );
          break;
        }
        case 36: {
          // CMD_SEND_TRACE_PATH: tag(4) auth(4) flags(1) path
          const tag = command.readUInt32LE(1);
          const auth = command.readUInt32LE(5);
          const flags = command[9];
          const path = command.subarray(10);
          // Firmware Mesh::onRecvPacket: a trace entry is 1 << (flags & 3) bytes (1, 2, 4 or
          // 8), whatever the mesh's path hash mode is.
          const sizeShift = flags & 0x03;
          const entrySize = 1 << sizeShift;
          log({
            kind: 'trace',
            route: 'direct',
            detail: `pathLen=${path.length} flags=${flags}`,
          });
          if (pingMode === 'reject') {
            send(Buffer.from([1, 2]));
            break;
          }
          if (path.length === 0 || path.length % entrySize !== 0) {
            send(Buffer.from([1, 6])); // ERR_CODE_ILLEGAL_ARG
            break;
          }
          send(sent('direct', tag));
          if (pingMode === 'silent') break;
          // The repeater is the only node in range. It forwards when the first entry is a
          // prefix of its key; the companion sees the trace finish only if that entry was the
          // last one. Any further entry needs another node, so the trace dies on air.
          const firstEntryIsRepeater = path
            .subarray(0, entrySize)
            .equals(repeaterKey.subarray(0, entrySize));
          // The far repeater sits behind a chain of relays. Each node forwards when the next
          // entry is a prefix of its key, and the companion hears the trace finish only when
          // the last entry belongs to the relay next to it: out through the relays, the far
          // repeater, then back through the relays.
          const entries = path.length >> sizeShift;
          const visits = (route: Buffer[]) =>
            entries === route.length &&
            route.every((key, i) =>
              path.subarray(i * entrySize, (i + 1) * entrySize).equals(key.subarray(0, entrySize)),
            );
          const isFarRoundTrip =
            far != null && (visits(farRoundTrip) || visits(farRoundTripViaRepeater));
          if (!isFarRoundTrip && (!firstEntryIsRepeater || path.length !== entrySize)) {
            log({
              kind: 'lost',
              route: 'direct',
              detail: `trace needs ${path.length >> sizeShift} hops of ${entrySize} byte(s)`,
            });
            break;
          }
          setTimeout(() => {
            const hops = path.length >> sizeShift;
            log({ kind: 'reply', route: 'direct', detail: 'trace' });
            broadcast(
              Buffer.concat([
                Buffer.from([0x89, 0, path.length, flags]),
                u32(tag),
                u32(auth),
                path,
                Buffer.alloc(hops + 1, 40),
              ]),
            );
          }, REPEATER_REPLY_DELAY_MS);
          break;
        }
        case 31:
          send(
            command[1] >= 40
              ? Buffer.from([1, 2])
              : Buffer.concat([Buffer.from([18, command[1]]), Buffer.alloc(32), Buffer.alloc(16)]),
          );
          break;
        case 23:
          send(Buffer.from([15]));
          break;
        case 10:
          send(Buffer.from([10]));
          break;
        case 5:
          send(Buffer.concat([Buffer.from([9]), u32(Math.floor(Date.now() / 1000))]));
          break;
        case 20:
          send(Buffer.from([12, 0x68, 0x10]));
          break;
        case 59:
          send(Buffer.from([25, 0, 3]));
          break;
        case 56:
          send(
            Buffer.concat([
              Buffer.from([24, command[1]]),
              Buffer.alloc(command[1] === 0 ? 9 : command[1] === 1 ? 12 : 24),
            ]),
          );
          break;
        default:
          send(Buffer.from([0]));
          break;
      }
    };
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, typeof data === 'string' ? Buffer.from(data) : data]);
      while (buffer.length >= 3) {
        const length = buffer.readUInt16LE(1);
        if (buffer.length < length + 3) break;
        const payload = buffer.subarray(3, length + 3);
        buffer = buffer.subarray(length + 3);
        receive(payload);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed to listen');
  return {
    port: address.port,
    repeaterName: REPEATER_NAME,
    events,
    /** Companion contact path length: 0 is a known zero-hop route, -1 floods. */
    setContactPathLen: (value: number) => {
      contactPathLen = value;
    },
    getContactPathLen: () => contactPathLen,
    /**
     * Bytes an older route left at the start of the repeater contact's path buffer (relay
     * hashes of nodes that are not in range). The length byte still decides the route.
     */
    setRepeaterLeftoverPath: (bytes: readonly number[]) => {
      repeaterOutPath.fill(0);
      Buffer.from(bytes).copy(repeaterOutPath);
    },
    /** Whether the radio holds a route to the far repeater; false reports it as unknown. */
    setFarRouteKnown: (value: boolean) => {
      farRouteKnown = value;
    },
    /** Repeater access-list entry for this companion; null means it does not know us. */
    setRepeaterClient: (value: Pick<RepeaterClient, 'admin' | 'returnPath'> | null) => {
      client = value ? { ...value, lastTimestamp: 0 } : null;
    },
    getRepeaterClient: () => (client ? { ...client } : null),
    /** 'silent' sends the trace and never answers; 'reject' has the companion refuse it. */
    setPingMode: (value: 'answer' | 'silent' | 'reject') => {
      pingMode = value;
    },
    count: (kind: RepeaterRadioEvent['kind']) => events.filter((e) => e.kind === kind).length,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
