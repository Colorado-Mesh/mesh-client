import './styles.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, useTranslation } from 'react-i18next';

import LiveTrafficPanel from './components/map/LiveTrafficPanel';
import { installDevElectronApiStubIfNeeded } from './lib/devElectronApiStub';
import i18n from './lib/i18n';
import { IconMotionProvider } from './lib/icons/iconMotionContext';
import { installBeaconPreviewBridge } from './lib/map/beaconPreviewBridge';
import type { RxPacketEntry } from './lib/meshcore/meshcoreHookTypes';
import type { MeshtasticRawPacketEntry } from './lib/rawPacketLogConstants';
import { initReduceMotionDefaultIfAbsent } from './lib/reduceMotionPreference';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';
import type { MeshNode } from './lib/types';

const EMPTY_NODES = new Map<number, MeshNode>();
const EMPTY_MESHCORE: readonly RxPacketEntry[] = [];
const EMPTY_MESHTASTIC: readonly MeshtasticRawPacketEntry[] = [];

function TrafficPreview() {
  const { t } = useTranslation();
  const [meshcore, setMeshcore] = useState(true);
  return (
    <main className="bg-app-bg text-ink-200 flex h-dvh min-h-0 flex-col p-3 md:p-5">
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold">Mesh Client</span>
          <span className="text-muted text-label">{t('liveTraffic.title')}</span>
        </div>
        <div className="flex gap-1">
          {[true, false].map((isMeshcore) => (
            <button
              key={String(isMeshcore)}
              aria-label={isMeshcore ? 'MeshCore' : 'Meshtastic'}
              aria-pressed={meshcore === isMeshcore}
              onClick={() => {
                setMeshcore(isMeshcore);
              }}
              className={`rounded-control text-label px-3 py-1.5 font-medium ${meshcore === isMeshcore ? 'bg-brand-green text-app-bg' : 'bg-deep-black text-ink-300'}`}
            >
              {isMeshcore ? 'MeshCore' : 'Meshtastic'}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <LiveTrafficPanel
          key={String(meshcore)}
          nodes={EMPTY_NODES}
          myNodeNum={0}
          meshcorePackets={meshcore ? EMPTY_MESHCORE : undefined}
          meshtasticPackets={meshcore ? undefined : EMPTY_MESHTASTIC}
        />
      </div>
    </main>
  );
}

// Separate Vite entry for local review; production builds only include index.html.
if (import.meta.env.DEV) {
  installDevElectronApiStubIfNeeded();
  const disposeBeaconPreview = installBeaconPreviewBridge();
  initReduceMotionDefaultIfAbsent();
  applyThemeColors(loadThemeColors());
  const root = createRoot(document.getElementById('root')!);
  import.meta.hot?.dispose(() => {
    root.unmount();
    disposeBeaconPreview();
  });
  root.render(
    <I18nextProvider i18n={i18n}>
      <IconMotionProvider>
        <TrafficPreview />
      </IconMotionProvider>
    </I18nextProvider>,
  );
}
