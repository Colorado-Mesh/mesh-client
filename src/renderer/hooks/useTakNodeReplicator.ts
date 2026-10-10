import { useEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  collectTakNodeUpdates,
  TAK_NODE_REFRESH_MS,
  TAK_NODE_SCAN_INTERVAL_MS,
  type TakFeedSources,
  takNodeUpdateKey,
  takNodeUpdateSignature,
} from '@/renderer/lib/takNodeFeed';
import { setTakSinkActive } from '@/renderer/stores/takSinkStore';
import { type TakTrackerEntry, useTakTrackerStore } from '@/renderer/stores/takTrackerStore';
import { TAK_NODE_UPDATE_BATCH_MAX, type TAKNodeUpdate } from '@/shared/tak-types';

interface UseTakNodeReplicatorArgs {
  /** A TAK sink in main is accepting node updates. */
  active: boolean;
  nodesByProtocol: TakFeedSources['nodesByProtocol'];
}

interface ReplicatorInputs {
  nodesByProtocol: TakFeedSources['nodesByProtocol'];
  trackerFixes: Record<string, TakTrackerEntry>;
}

function readSources(inputs: ReplicatorInputs): TakFeedSources {
  return {
    nodesByProtocol: inputs.nodesByProtocol,
    trackerFixes: Object.values(inputs.trackerFixes),
  };
}

function sendUpdates(updates: TAKNodeUpdate[]): void {
  for (let i = 0; i < updates.length; i += TAK_NODE_UPDATE_BATCH_MAX) {
    const batch = updates.slice(i, i + TAK_NODE_UPDATE_BATCH_MAX);
    window.electronAPI.tak.pushNodeUpdates(batch).catch((e: unknown) => {
      console.warn('[TakReplicator] pushNodeUpdates failed ' + errLikeToLogString(e));
    });
  }
}

/**
 * Feeds node positions from both protocols (plus MeshCore tracker fixes) to the TAK sinks
 * in main, whichever protocol tab is active. Mount once from
 * AppContent.
 *
 * Sends everything when a sink becomes active and every {@link TAK_NODE_REFRESH_MS} so markers
 * do not go stale in ATAK; in between, a throttled scan sends only nodes whose position, name,
 * or battery changed.
 */
export function useTakNodeReplicator({ active, nodesByProtocol }: UseTakNodeReplicatorArgs): void {
  const trackerFixes = useTakTrackerStore((s) => s.fixes);
  const inputsRef = useRef<ReplicatorInputs>({
    nodesByProtocol,
    trackerFixes,
  });
  /** Last signature sent per `${protocol}:${node_id}` (or tracker uid); rebuilt on every full send. */
  const sentRef = useRef(new Map<string, string>());
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputsRef.current = { nodesByProtocol, trackerFixes };
  }, [nodesByProtocol, trackerFixes]);

  useEffect(() => {
    setTakSinkActive(active);
    return () => {
      setTakSinkActive(false);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const sendAll = () => {
      const updates = collectTakNodeUpdates(readSources(inputsRef.current));
      const sent = new Map<string, string>();
      for (const u of updates) sent.set(takNodeUpdateKey(u), takNodeUpdateSignature(u));
      sentRef.current = sent;
      sendUpdates(updates);
    };
    sendAll();
    const refreshTimer = setInterval(sendAll, TAK_NODE_REFRESH_MS);
    return () => {
      clearInterval(refreshTimer);
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      sentRef.current = new Map();
    };
  }, [active]);

  useEffect(() => {
    // Throttle rather than debounce: steady node churn still yields a scan every window.
    if (!active || scanTimerRef.current) return;
    scanTimerRef.current = setTimeout(() => {
      scanTimerRef.current = null;
      const changed: TAKNodeUpdate[] = [];
      for (const u of collectTakNodeUpdates(readSources(inputsRef.current))) {
        const key = takNodeUpdateKey(u);
        const signature = takNodeUpdateSignature(u);
        if (sentRef.current.get(key) === signature) continue;
        sentRef.current.set(key, signature);
        changed.push(u);
      }
      if (changed.length > 0) sendUpdates(changed);
    }, TAK_NODE_SCAN_INTERVAL_MS);
  }, [active, nodesByProtocol, trackerFixes]);

  useEffect(
    () => () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    },
    [],
  );
}
