import { ArrowDownToLine, Pin } from 'lucide-react-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  applyLiveMapSnapshot,
  emptyLiveMapWindowData,
  type LiveMapWindowData,
} from '@/renderer/lib/map/liveMapSnapshot';
import type { LiveMapProtocol, LiveMapView, LiveMapWindowInit } from '@/shared/liveMapWindow';

import { IconButton } from '../ui/Button';
import LiveTrafficPanel from './LiveTrafficPanel';

const PROTOCOL_NAMES: Record<LiveMapProtocol, string> = {
  meshtastic: 'Meshtastic',
  meshcore: 'MeshCore',
};

/** Live traffic for one protocol in its own window; packets arrive from the main window. */
export function LiveMapWindow() {
  const { t } = useTranslation();
  const api = window.electronAPI.liveMap;
  const [init, setInit] = useState<LiveMapWindowInit | null | undefined>(undefined);
  const [data, setData] = useState<LiveMapWindowData | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  useEffect(() => {
    let ready = false;
    let pending: unknown[] = [];
    let cancelled = false;
    // Listen before announcing readiness, so the first full snapshot cannot be missed.
    const stopSnapshots = api.onSnapshot((snapshot) => {
      if (!ready) {
        pending.push(snapshot);
        return;
      }
      setData((current) => current && applyLiveMapSnapshot(current, snapshot));
    });
    api
      .init()
      .then((value) => {
        if (cancelled) return;
        setInit(value);
        if (!value) return;
        ready = true;
        setAlwaysOnTop(value.alwaysOnTop);
        const queued = pending;
        pending = [];
        setData(queued.reduce(applyLiveMapSnapshot, emptyLiveMapWindowData(value.protocol)));
      })
      .catch((cause: unknown) => {
        console.error('[live-map] window init failed', cause);
        if (!cancelled) setInit(null);
      });
    return () => {
      cancelled = true;
      stopSnapshots();
    };
  }, [api]);

  const protocolName = init ? PROTOCOL_NAMES[init.protocol] : null;
  const title = protocolName ? t('liveTraffic.window.title', { protocol: protocolName }) : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  const selectNode = useCallback(
    (nodeId: number) => {
      api.selectNode(nodeId);
    },
    [api],
  );
  const reportView = useCallback(
    (view: LiveMapView) => {
      api.reportView(view);
    },
    [api],
  );
  const toggleAlwaysOnTop = useCallback(() => {
    api.setAlwaysOnTop(!alwaysOnTop).then(setAlwaysOnTop, (cause: unknown) => {
      console.warn('[live-map] keep on top failed', cause);
    });
  }, [api, alwaysOnTop]);
  const returnToMainWindow = useCallback(() => {
    api.dock().catch((cause: unknown) => {
      console.warn('[live-map] return to main window failed', cause);
    });
  }, [api]);

  if (init === null) {
    return (
      <main className="bg-app-bg text-muted flex h-dvh items-center justify-center p-5 text-sm">
        <p>{t('liveTraffic.window.unavailable')}</p>
      </main>
    );
  }
  if (!init || !data) return <main className="bg-app-bg h-dvh" aria-busy="true" />;
  return (
    <main className="bg-app-bg text-ink-200 flex h-dvh min-h-0 flex-col">
      <h1 className="sr-only">{title}</h1>
      <LiveTrafficPanel
        nodes={data.nodes}
        myNodeNum={data.myNodeNum}
        ourPosition={data.ourPosition}
        meshcorePackets={data.meshcorePackets}
        meshtasticPackets={data.meshtasticPackets}
        pubKeyByNodeId={data.pubKeyByNodeId}
        onNodeClick={selectNode}
        initialView={init.view}
        onViewChange={reportView}
        windowActions={
          <>
            <IconButton
              size="sm"
              aria-label={t('liveTraffic.window.keepOnTop')}
              aria-pressed={alwaysOnTop}
              active={alwaysOnTop ? 'brand' : false}
              onClick={toggleAlwaysOnTop}
              icon={<Pin aria-hidden className="h-3.5 w-3.5" />}
            />
            <IconButton
              size="sm"
              aria-label={t('liveTraffic.window.return')}
              onClick={returnToMainWindow}
              icon={<ArrowDownToLine aria-hidden className="h-3.5 w-3.5" />}
            />
          </>
        }
      />
    </main>
  );
}
