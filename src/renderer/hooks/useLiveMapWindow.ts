import { useCallback, useEffect, useRef, useState } from 'react';

import type { OurPosition } from '@/renderer/lib/gpsSource';
import {
  buildLiveMapSnapshot,
  type LiveMapSnapshotInput,
} from '@/renderer/lib/map/liveMapSnapshot';
import type { LiveMapProtocol, LiveMapView } from '@/shared/liveMapWindow';
import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Same publication rate as the regional feed: a pop-out redraws at most four times a second. */
const PUBLISH_INTERVAL_MS = MS_PER_SECOND / 4;

export interface DockedLiveMapView {
  view: LiveMapView | null;
  /** Changes each time a pop-out closes, so the docked map remounts with its view. */
  revision: number;
}

/**
 * Main-window side of the live map pop-out for one protocol. While the pop-out is open this
 * publishes the protocol's packet and node state to it; radio state never leaves this window.
 */
export function useLiveMapWindow(
  protocol: LiveMapProtocol | null,
  input: LiveMapSnapshotInput,
  onNodeSelected?: (nodeId: number) => void,
) {
  const api = window.electronAPI.liveMap;
  const available = protocol !== null && api.available;
  const [open, setOpen] = useState(false);
  const [readyRevision, setReadyRevision] = useState(0);
  const [docked, setDocked] = useState<DockedLiveMapView>({ view: null, revision: 0 });
  const sent = useRef<{ nodes: unknown; pubKeys: unknown; at: number }>({
    nodes: null,
    pubKeys: null,
    at: 0,
  });
  const openRef = useRef(false);
  const onNodeSelectedRef = useRef(onNodeSelected);
  useEffect(() => {
    onNodeSelectedRef.current = onNodeSelected;
    openRef.current = open;
  });

  useEffect(() => {
    if (!available || protocol === null) return;
    let cancelled = false;
    const stopState = api.onState((state) => {
      if (state.protocol !== protocol) return;
      setOpen(state.open);
      if (state.ready) setReadyRevision((revision) => revision + 1);
      if (!state.open)
        setDocked((current) => ({ view: state.view, revision: current.revision + 1 }));
    });
    const stopSelection = api.onNodeSelected((selection) => {
      if (selection.protocol === protocol) onNodeSelectedRef.current?.(selection.nodeId);
    });
    api
      .getOpen()
      .then((protocols) => {
        if (cancelled || !protocols.includes(protocol)) return;
        setOpen(true);
        setReadyRevision((revision) => revision + 1);
      })
      .catch((cause: unknown) => {
        console.warn('[live-map] pop-out state unavailable', cause);
      });
    return () => {
      cancelled = true;
      stopState();
      stopSelection();
      // The data source is going away (protocol disabled); its pop-out would only freeze.
      if (openRef.current)
        api.close(protocol).catch((cause: unknown) => {
          console.warn('[live-map] pop-out failed to close', cause);
        });
    };
  }, [api, available, protocol]);

  // A pop-out that just loaded has no nodes yet; the next publication carries all of them.
  useEffect(() => {
    sent.current = { nodes: null, pubKeys: null, at: 0 };
  }, [readyRevision]);

  const { nodes, myNodeNum, meshcorePackets, meshtasticPackets, pubKeyByNodeId } = input;
  const lat = input.ourPosition?.lat;
  const lon = input.ourPosition?.lon;
  const source = input.ourPosition?.source;
  useEffect(() => {
    if (!available || protocol === null || !open || readyRevision === 0) return;
    const publish = () => {
      const ourPosition: OurPosition | null =
        lat == null || lon == null || source == null ? null : { lat, lon, source };
      const snapshot = buildLiveMapSnapshot(
        { nodes, myNodeNum, ourPosition, meshcorePackets, meshtasticPackets, pubKeyByNodeId },
        {
          nodes: sent.current.nodes !== nodes,
          pubKeys: sent.current.pubKeys !== (pubKeyByNodeId ?? null),
        },
      );
      sent.current = { nodes, pubKeys: pubKeyByNodeId ?? null, at: Date.now() };
      api.publish(protocol, snapshot);
    };
    const wait = PUBLISH_INTERVAL_MS - (Date.now() - sent.current.at);
    if (wait <= 0) {
      publish();
      return;
    }
    const timer = window.setTimeout(publish, wait);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    api,
    available,
    open,
    readyRevision,
    protocol,
    nodes,
    myNodeNum,
    meshcorePackets,
    meshtasticPackets,
    pubKeyByNodeId,
    lat,
    lon,
    source,
  ]);

  const popOut = useCallback(
    (view: LiveMapView | null) => {
      if (!available || protocol === null) return;
      api.open(protocol, view).catch((cause: unknown) => {
        console.warn('[live-map] pop-out failed to open', cause);
      });
    },
    [api, available, protocol],
  );
  const dock = useCallback(() => {
    if (!available || protocol === null) return;
    api.close(protocol).catch((cause: unknown) => {
      console.warn('[live-map] pop-out failed to close', cause);
    });
  }, [api, available, protocol]);

  return { available, open: available && open, docked, popOut, dock };
}
