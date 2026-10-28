import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { dedupeChannelPillsByIndex } from '../channelListDedupe';
import type { MeshCoreChannelRaw, MeshCoreContactRaw } from './meshcoreHookTypes';

export interface RadioChatChannel {
  index: number;
  name: string;
  secret: Uint8Array;
}

/** Missing slots in an interrupted SDK read are not deletions. Explicit empty slots are. */
export function reconcileRadioChatChannels(
  previous: readonly RadioChatChannel[],
  raw: readonly MeshCoreChannelRaw[],
): RadioChatChannel[] {
  const incoming = raw.map((channel) => {
    if (
      !Number.isInteger(channel.channelIdx) ||
      channel.channelIdx < 0 ||
      channel.channelIdx > 39 ||
      typeof channel.name !== 'string' ||
      !(channel.secret instanceof Uint8Array) ||
      channel.secret.length !== 16
    ) {
      throw new Error('Invalid channel snapshot from radio');
    }
    return { index: channel.channelIdx, name: channel.name, secret: channel.secret };
  });
  return dedupeChannelPillsByIndex([...previous, ...incoming]);
}

/** Read the complete snapshot before applying anything; no writes to the radio. */
export async function readRadioChats(
  connection: {
    getContacts: () => Promise<MeshCoreContactRaw[]>;
    getChannels: () => Promise<MeshCoreChannelRaw[]>;
  },
  assertCurrent: () => void,
): Promise<{ contacts: MeshCoreContactRaw[]; channels: MeshCoreChannelRaw[] }> {
  assertCurrent();
  const contacts = await connection.getContacts();
  assertCurrent();
  const channels = await connection.getChannels();
  assertCurrent();
  reconcileRadioChatChannels([], channels);
  return { contacts, channels };
}

interface ChannelReadConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

/**
 * Read capacity from DeviceInfo's raw v3+ payload, which meshcore.js does not expose.
 * Bounded indexed reads reject every Err; an unrelated NOT_FOUND can never truncate a
 * successful snapshot. See meshcore-dev/MeshCore MyMesh.cpp CMD_DEVICE_QUERY/GET_CHANNEL.
 */
export async function readRadioChannels(
  conn: ChannelReadConnection,
  assertCurrent: () => void,
  timeoutMs = 5 * MS_PER_SECOND,
): Promise<MeshCoreChannelRaw[]> {
  async function readReply<T>(
    event: string | number,
    frame: Uint8Array,
    parse: (value: unknown) => T | undefined,
  ): Promise<T> {
    assertCurrent();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (value: T | undefined, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(cancelTimer);
        conn.off(event, onReply);
        conn.off(1, onError);
        if (error !== undefined)
          reject(error instanceof Error ? error : new Error(errLikeToLogString(error)));
        else resolve(value as T);
      };
      const onReply = (value: unknown) => {
        try {
          const parsed = parse(value);
          if (parsed !== undefined) finish(parsed);
        } catch (error) {
          // catch-no-log-ok forwarded to the UI through the rejected snapshot promise
          finish(undefined, error);
        }
      };
      const onError = () => {
        finish(undefined, new Error('Radio chat read failed'));
      };
      const timer = setTimeout(() => {
        finish(undefined, new Error('Radio chat read timed out'));
      }, timeoutMs);
      const cancelTimer = setInterval(() => {
        try {
          assertCurrent();
        } catch (error) {
          // catch-no-log-ok forwarded to the UI through the rejected snapshot promise
          finish(undefined, error);
        }
      }, MS_PER_SECOND / 20);
      conn.on(event, onReply);
      conn.on(1, onError);
      void Promise.resolve()
        .then(() => conn.sendToRadioFrame(frame))
        .catch((error: unknown) => {
          finish(undefined, error);
        });
    });
  }
  const count = await readReply('rx', new Uint8Array([22, 14]), (value) => {
    const frame =
      value instanceof Uint8Array
        ? value
        : Array.isArray(value) &&
            value.every(
              (byte) =>
                typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255,
            )
          ? Uint8Array.from(value)
          : null;
    if (frame?.[0] !== 13) return undefined;
    // Firmware before companion protocol v3 did not publish a channel-table capacity.
    if (frame.length < 8 || frame[1] < 3 || frame[3] < 1 || frame[3] > 40) {
      throw new Error('Radio did not report a supported channel capacity');
    }
    return frame[3];
  });
  const channels: MeshCoreChannelRaw[] = [];
  for (let index = 0; index < count; index++) {
    const channel = await readReply(18, new Uint8Array([31, index]), (value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('channelIdx' in value) ||
        value.channelIdx !== index
      )
        return undefined;
      const channel = value as MeshCoreChannelRaw;
      reconcileRadioChatChannels([], [channel]);
      return channel;
    });
    channels.push(channel);
  }
  assertCurrent();
  return channels;
}

const radioChatOperations = new WeakSet<object>();

/** Channel dumps and channel writes share untagged companion replies and cannot overlap. */
export async function runRadioChatOperation<T>(conn: object, work: () => Promise<T>): Promise<T> {
  if (radioChatOperations.has(conn)) throw new Error('Radio chat configuration is busy; try again');
  radioChatOperations.add(conn);
  try {
    return await work();
  } finally {
    radioChatOperations.delete(conn);
  }
}

export function mergeLiveMapChanges<K, V>(
  baseline: ReadonlyMap<K, V>,
  live: ReadonlyMap<K, V>,
  snapshot: Map<K, V>,
): void {
  for (const [key, value] of live) if (baseline.get(key) !== value) snapshot.set(key, value);
  for (const key of baseline.keys()) if (!live.has(key)) snapshot.delete(key);
}

export function waitForRadioChatSetup(
  isBusy: () => boolean,
  assertCurrent: () => void,
): Promise<void> {
  assertCurrent();
  if (!isBusy()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 60 * MS_PER_SECOND;
    const timer = setInterval(() => {
      try {
        assertCurrent();
        if (Date.now() >= deadline) throw new Error('Radio setup did not finish');
        if (!isBusy()) {
          clearInterval(timer);
          resolve();
        }
      } catch (error) {
        // catch-no-log-ok rejected to the sync UI, with the timer released
        clearInterval(timer);
        reject(error instanceof Error ? error : new Error(errLikeToLogString(error)));
      }
    }, MS_PER_SECOND / 20);
  });
}
