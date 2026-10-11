import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  type BeaconTrafficMessage,
  buildBeaconTrafficNodeIndex,
  normalizeBeaconMessage,
  normalizeBeaconObservation,
} from '@/renderer/lib/map/beaconTrafficModel';
import {
  buildCoreScopeTrafficNodeIndex,
  normalizeCoreScopeMessage,
  normalizeCoreScopeObservation,
} from '@/renderer/lib/map/coreScopeTrafficModel';
import {
  LIVE_TRAFFIC_MAX_AGE_MS,
  LIVE_TRAFFIC_MAX_PACKETS,
  type LiveTrafficEvent,
  type LiveTrafficPoint,
} from '@/renderer/lib/map/liveTrafficModel';
import type { BeaconFeedStatus, RegionalFeedProvider } from '@/shared/beacon';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export { COLORADO_BEACON_URL } from '@/renderer/lib/map/beaconPresets';

export interface BeaconRegionOption {
  slug: string;
  name: string;
}

/** Regional observations stay in this view; they never enter the radio's node/message stores. */
export function useBeaconTraffic(
  enabled: boolean,
  provider: RegionalFeedProvider = 'beacon',
  visible = true,
) {
  const [dataProvider, setDataProvider] = useState(provider);
  const [status, setStatus] = useState<BeaconFeedStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<LiveTrafficEvent[]>([]);
  const [points, setPoints] = useState<readonly LiveTrafficPoint[]>([]);
  const [regions, setRegions] = useState<BeaconRegionOption[]>([]);
  const [directoryLimited, setDirectoryLimited] = useState(false);
  const index = useRef(buildBeaconTrafficNodeIndex([]));
  const coreScopeIndex = useRef(buildCoreScopeTrafficNodeIndex([]));
  const messages = useRef(new Map<string, BeaconTrafficMessage>());
  const pending = useRef(new Map<string, LiveTrafficEvent>());
  const generation = useRef(0);
  const activeSession = useRef(false);
  const acceptUpdates = useRef(false);
  const viewVisible = useRef(visible);
  const flushPending = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    viewVisible.current = visible;
    if (visible) flushPending.current?.();
  }, [visible]);

  const clearFeed = useCallback(() => {
    index.current = buildBeaconTrafficNodeIndex([]);
    coreScopeIndex.current = buildCoreScopeTrafficNodeIndex([]);
    messages.current.clear();
    pending.current.clear();
    setEvents([]);
    setPoints([]);
    setRegions([]);
    setDirectoryLimited(false);
    setDataProvider(provider);
  }, [provider]);

  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI.beacon;
    let active = true;
    let dirty = false;
    activeSession.current = true;
    acceptUpdates.current = true;
    const enabledGeneration = ++generation.current;
    index.current = buildBeaconTrafficNodeIndex([]);
    coreScopeIndex.current = buildCoreScopeTrafficNodeIndex([]);
    pending.current.clear();
    messages.current.clear();
    queueMicrotask(() => {
      // An explicit connect can run before this queued lifecycle reset.
      if (!active || generation.current !== enabledGeneration) return;
      setStatus('disconnected');
      setError(null);
      clearFeed();
    });
    const flush = () => {
      if (!active || !viewVisible.current || document.hidden) return;
      const now = Date.now();
      for (const [id, event] of pending.current) {
        if (event.ts > now || now - event.ts > LIVE_TRAFFIC_MAX_AGE_MS) {
          pending.current.delete(id);
          dirty = true;
        }
      }
      if (!dirty) return;
      dirty = false;
      setEvents([...pending.current.values()]);
    };
    flushPending.current = flush;
    const receiveMessage = (value: unknown) => {
      const message =
        provider === 'corescope' ? normalizeCoreScopeMessage(value) : normalizeBeaconMessage(value);
      if (!message) return;
      messages.current.delete(message.packetHash);
      messages.current.set(message.packetHash, message);
      if (messages.current.size > LIVE_TRAFFIC_MAX_PACKETS) {
        const oldest = messages.current.keys().next().value;
        if (oldest !== undefined) messages.current.delete(oldest);
      }
      for (const [id, event] of pending.current) {
        if (event.packetHash !== message.packetHash) continue;
        pending.current.set(id, {
          ...event,
          messageText: message.messageText,
          senderLabel: message.senderLabel ?? event.senderLabel,
          contentStatus: 'decoded',
        });
        dirty = true;
      }
    };
    const unsubscribe = api.onUpdate((update) => {
      if (!active || !acceptUpdates.current) return;
      if ((update.provider ?? 'beacon') !== provider) return;
      if (update.type === 'status') {
        setStatus(update.status);
        setError(update.message ?? null);
      } else if (update.type === 'snapshot') {
        // A resync replaces the directory. Old observations must not keep its old geometry.
        pending.current.clear();
        messages.current.clear();
        dirty = false;
        setEvents([]);
        setDirectoryLimited(update.directoryLimited === true);
        if (provider === 'corescope') {
          coreScopeIndex.current = buildCoreScopeTrafficNodeIndex(update.nodes, update.observers);
          setPoints(coreScopeIndex.current.points);
        } else {
          index.current = buildBeaconTrafficNodeIndex(update.nodes, update.observers);
          setPoints(index.current.points);
        }
        for (const message of update.messages ?? []) receiveMessage(message);
        setRegions(
          update.regions.flatMap((region) =>
            typeof region.slug === 'string' && typeof region.name === 'string'
              ? [{ slug: region.slug, name: region.name }]
              : [],
          ),
        );
      } else if (update.type === 'message') {
        receiveMessage(update.message);
      } else {
        // CoreScope includes decrypted public text on packet reports rather than separate events.
        if (provider === 'corescope') receiveMessage(update.packet);
        const receivedAt = Date.now();
        const event =
          provider === 'corescope'
            ? normalizeCoreScopeObservation(
                update.packet,
                coreScopeIndex.current,
                receivedAt,
                messages.current,
                { receivedAt },
              )
            : normalizeBeaconObservation(
                update.packet,
                index.current,
                Date.now(),
                messages.current,
              );
        if (!event) return;
        const previous = pending.current.get(event.id);
        if (previous) {
          const count = event.reportedObservationCount;
          if (count != null && count > (previous.reportedObservationCount ?? 0)) {
            pending.current.set(event.id, { ...previous, reportedObservationCount: count });
            dirty = true;
          }
          return;
        }
        pending.current.set(event.id, { ...event, sourceSessionId: String(generation.current) });
        if (pending.current.size > LIVE_TRAFFIC_MAX_PACKETS) {
          const oldest = pending.current.keys().next().value;
          if (oldest !== undefined) pending.current.delete(oldest);
        }
        dirty = true;
      }
    });
    return () => {
      active = false;
      flushPending.current = null;
      activeSession.current = false;
      acceptUpdates.current = false;
      generation.current += 1;
      unsubscribe();
      void api.disconnect().catch((cause: unknown) => {
        console.warn('[beacon] disconnect failed', cause);
      });
    };
  }, [enabled, clearFeed, provider]);

  // Navigation suspends publication, not the bounded session or its single subscription.
  useEffect(() => {
    if (!enabled || !visible) return;
    let timer: number | undefined;
    const updateVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      flushPending.current?.();
      timer = window.setInterval(() => flushPending.current?.(), MS_PER_SECOND / 4);
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, [enabled, provider, visible]);

  const connect = useCallback(
    async (baseUrl: string, region?: string) => {
      if (!enabled || !activeSession.current) return false;
      const attempt = ++generation.current;
      acceptUpdates.current = false;
      clearFeed();
      setError(null);
      setStatus('connecting');
      try {
        // Stop the previous URL before validating/connecting the new one. A rejected URL
        // must not leave the old feed streaming under the user's new source selection.
        await window.electronAPI.beacon.disconnect();
        if (!activeSession.current || attempt !== generation.current) return false;
        acceptUpdates.current = true;
        const result = await window.electronAPI.beacon.connect({ baseUrl, region, provider });
        if (!activeSession.current || attempt !== generation.current) return false;
        if (!result.ok) {
          acceptUpdates.current = false;
          setStatus('error');
          setError(result.error ?? 'Connection failed');
        }
        return result.ok;
      } catch (cause) {
        if (!activeSession.current || attempt !== generation.current) return false;
        acceptUpdates.current = false;
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Connection failed');
        console.warn('[beacon] connection failed', cause);
        return false;
      }
    },
    [enabled, clearFeed, provider],
  );

  const disconnect = useCallback(async () => {
    const attempt = ++generation.current;
    acceptUpdates.current = false;
    await window.electronAPI.beacon.disconnect();
    if (activeSession.current && attempt === generation.current) setStatus('disconnected');
  }, []);

  // Provider changes must hide old-source data in the render before effect cleanup runs.
  return dataProvider === provider
    ? { status, error, events, points, regions, directoryLimited, connect, disconnect }
    : {
        status: 'disconnected' as const,
        error: null,
        events: [],
        points: [],
        regions: [],
        directoryLimited: false,
        connect,
        disconnect,
      };
}
