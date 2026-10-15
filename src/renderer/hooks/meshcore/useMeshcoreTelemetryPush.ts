import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { errLikeToLogString } from '../../lib/errLikeToLogString';
import {
  buildMeshcoreTelemetryMinDeltas,
  buildMeshcoreTelemetrySubscribeRequest,
  buildMeshcoreTelemetryUnsubscribeRequest,
  MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MIN_BYTES,
  type MeshcoreLppChannelEntry,
  type MeshcoreTelemetryPushOptions,
  MeshcoreTelemetryPushRegistry,
  type MeshcoreTelemetryPushSubscription,
  meshcoreTelemetryResubscribeDelayMs,
  parseMeshcoreTelemetryPushPayload,
  parseMeshcoreTelemetrySubscribeReply,
  randomMeshcoreTelemetryPushTag,
} from '../../lib/meshcore/meshcoreTelemetryPush';
import { MC_PUSH_BINARY_RESPONSE } from '../../lib/meshcoreWireCodes';

/** Let the post-connect contact/message sync settle before re-subscribing over RF. */
export const MESHCORE_TELEMETRY_PUSH_RECONNECT_DELAY_MS = 5_000;

export type MeshcoreTelemetryPushErrorCode = 'noMetrics' | 'rejected';

/** Subscribe failure the UI can explain; other errors are RPC failures (timeout, auth). */
export class MeshcoreTelemetryPushError extends Error {
  readonly code: MeshcoreTelemetryPushErrorCode;
  constructor(code: MeshcoreTelemetryPushErrorCode) {
    super(`telemetry push ${code}`);
    this.name = 'MeshcoreTelemetryPushError';
    this.code = code;
  }
}

export interface MeshcoreTelemetryPushActions {
  subscriptions: ReadonlyMap<number, MeshcoreTelemetryPushSubscription>;
  subscribe(
    nodeId: number,
    options: MeshcoreTelemetryPushOptions,
  ): Promise<MeshcoreTelemetryPushSubscription>;
  unsubscribe(nodeId: number): Promise<void>;
  /** Forget every subscription (manual disconnect); sends nothing over RF. */
  clearAll(): void;
}

export interface MeshcoreTelemetryPushConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
}

export interface UseMeshcoreTelemetryPushDeps {
  connRef: RefObject<MeshcoreTelemetryPushConnection | null>;
  /** Radio session is up; going false pauses timers, going true re-subscribes. */
  connected: boolean;
  /** LPP channels the sensor reports, requesting telemetry first when none is cached. */
  getTelemetryChannels(nodeId: number): Promise<readonly MeshcoreLppChannelEntry[]>;
  /** Login if needed, then send a binary request to the sensor; resolves to the reply body. */
  sendSensorRequest(nodeId: number, payload: Uint8Array): Promise<Uint8Array>;
  onPushTelemetry(nodeId: number, lpp: Uint8Array): void;
}

export function useMeshcoreTelemetryPush(
  deps: UseMeshcoreTelemetryPushDeps,
): MeshcoreTelemetryPushActions {
  const { connRef, connected } = deps;
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const [registry] = useState(() => new MeshcoreTelemetryPushRegistry());
  const [subscriptions, setSubscriptions] = useState<
    ReadonlyMap<number, MeshcoreTelemetryPushSubscription>
  >(() => new Map());
  /** Bumped on subscribe/unsubscribe/clearAll so a late RF reply cannot restore a cancelled sub. */
  const subscribeGenerationsRef = useRef(new Map<number, number>());

  const publish = useCallback(() => {
    setSubscriptions(new Map(registry.list().map((s) => [s.nodeId, s])));
  }, [registry]);

  const bumpSubscribeGeneration = useCallback((nodeId: number): number => {
    const next = (subscribeGenerationsRef.current.get(nodeId) ?? 0) + 1;
    subscribeGenerationsRef.current.set(nodeId, next);
    return next;
  }, []);

  const subscribeRef = useRef<
    (
      nodeId: number,
      options: MeshcoreTelemetryPushOptions,
    ) => Promise<MeshcoreTelemetryPushSubscription>
  >(() => Promise.reject(new Error('telemetry push not ready')));

  const scheduleRenew = useCallback(
    (nodeId: number, delayMs: number, options: MeshcoreTelemetryPushOptions) => {
      registry.scheduleResubscribe(nodeId, delayMs, () => {
        subscribeRef.current(nodeId, options).catch((e: unknown) => {
          console.warn(
            `[useMeshcoreTelemetryPush] re-subscribe node=0x${nodeId.toString(16)} failed ` +
              errLikeToLogString(e),
          );
        });
      });
    },
    [registry],
  );

  const subscribe = useCallback(
    async (
      nodeId: number,
      options: MeshcoreTelemetryPushOptions,
    ): Promise<MeshcoreTelemetryPushSubscription> => {
      const generation = bumpSubscribeGeneration(nodeId);
      const stillCurrent = (): MeshcoreTelemetryPushSubscription | null => {
        if (subscribeGenerationsRef.current.get(nodeId) === generation) return null;
        return registry.get(nodeId) ?? null;
      };
      const channels = await depsRef.current.getTelemetryChannels(nodeId);
      const afterChannels = stillCurrent();
      if (afterChannels) return afterChannels;
      if (subscribeGenerationsRef.current.get(nodeId) !== generation) {
        throw new Error('telemetry push subscribe superseded');
      }
      const minDeltas = buildMeshcoreTelemetryMinDeltas(channels, options.thresholds);
      if (minDeltas.length < MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MIN_BYTES) {
        throw new MeshcoreTelemetryPushError('noMetrics');
      }
      const tag = randomMeshcoreTelemetryPushTag();
      const reply = parseMeshcoreTelemetrySubscribeReply(
        await depsRef.current.sendSensorRequest(
          nodeId,
          buildMeshcoreTelemetrySubscribeRequest(tag, options.timeoutSecs, minDeltas),
        ),
      );
      const afterReply = stillCurrent();
      if (afterReply) return afterReply;
      if (subscribeGenerationsRef.current.get(nodeId) !== generation) {
        throw new Error('telemetry push subscribe superseded');
      }
      if (reply.grantedSecs === 0) {
        throw new MeshcoreTelemetryPushError('rejected');
      }
      const sub: MeshcoreTelemetryPushSubscription = {
        nodeId,
        tag,
        options,
        grantedSecs: reply.grantedSecs,
        subscribedAt: Date.now(),
        lastPushAt: registry.get(nodeId)?.lastPushAt ?? null,
      };
      registry.set(sub);
      scheduleRenew(nodeId, meshcoreTelemetryResubscribeDelayMs(reply.grantedSecs), options);
      publish();
      console.debug(
        `[useMeshcoreTelemetryPush] subscribed node=0x${nodeId.toString(16)} granted=${reply.grantedSecs}s deltas=${minDeltas.length}B`,
      );
      return sub;
    },
    [bumpSubscribeGeneration, publish, registry, scheduleRenew],
  );
  useEffect(() => {
    subscribeRef.current = subscribe;
  }, [subscribe]);

  const unsubscribe = useCallback(
    async (nodeId: number): Promise<void> => {
      bumpSubscribeGeneration(nodeId);
      const had = registry.get(nodeId) != null;
      registry.delete(nodeId);
      publish();
      if (!had || !connRef.current) return;
      try {
        await depsRef.current.sendSensorRequest(nodeId, buildMeshcoreTelemetryUnsubscribeRequest());
      } catch (e) {
        // The sensor drops the subscription at its timeout anyway; pushes for the tag are ignored.
        console.warn(
          `[useMeshcoreTelemetryPush] unsubscribe node=0x${nodeId.toString(16)} failed ` +
            errLikeToLogString(e),
        );
      }
    },
    [bumpSubscribeGeneration, connRef, publish, registry],
  );

  const clearAll = useCallback(() => {
    for (const [nodeId, gen] of subscribeGenerationsRef.current) {
      subscribeGenerationsRef.current.set(nodeId, gen + 1);
    }
    registry.clearAll();
    publish();
  }, [publish, registry]);

  useEffect(() => {
    if (!connected) {
      registry.pauseAll();
      return;
    }
    const conn = connRef.current;
    if (!conn) return;
    const onPush = (response: unknown): void => {
      const r = response as { tag?: number; responseData?: unknown };
      if (typeof r.tag !== 'number' || !(r.responseData instanceof Uint8Array)) return;
      const sub = registry.findByTag(r.tag);
      if (!sub) return;
      const payload = parseMeshcoreTelemetryPushPayload(r.responseData);
      if (!payload) return;
      registry.markPush(sub.nodeId, Date.now());
      publish();
      depsRef.current.onPushTelemetry(sub.nodeId, payload.lpp);
    };
    conn.on(MC_PUSH_BINARY_RESPONSE, onPush);
    for (const sub of registry.list()) {
      scheduleRenew(sub.nodeId, MESHCORE_TELEMETRY_PUSH_RECONNECT_DELAY_MS, sub.options);
    }
    return () => {
      conn.off(MC_PUSH_BINARY_RESPONSE, onPush);
    };
  }, [connected, connRef, publish, registry, scheduleRenew]);

  useEffect(
    () => () => {
      registry.clearAll();
    },
    [registry],
  );

  return useMemo(
    () => ({ subscriptions, subscribe, unsubscribe, clearAll }),
    [subscriptions, subscribe, unsubscribe, clearAll],
  );
}
