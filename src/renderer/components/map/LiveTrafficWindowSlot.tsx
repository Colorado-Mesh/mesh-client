import { AppWindow, ArrowDownToLine, ExternalLink } from 'lucide-react-motion';
import { lazy, Suspense, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useLiveMapWindow } from '@/renderer/hooks/useLiveMapWindow';
import type { LiveMapSnapshotInput } from '@/renderer/lib/map/liveMapSnapshot';
import type { LiveMapProtocol, LiveMapView } from '@/shared/liveMapWindow';

import { Button, IconButton } from '../ui/Button';

const LiveTrafficPanel = lazy(() => import('./LiveTrafficPanel'));

interface LiveTrafficWindowSlotProps extends LiveMapSnapshotInput {
  active: boolean;
  protocol: LiveMapProtocol;
  onNodeClick?: (id: number) => void;
  /** Opens a node clicked in the pop-out window. */
  onWindowNodeClick?: (id: number) => void;
}

/**
 * The Map panel's live traffic view, or a notice while it is open in its own window. The inline
 * panel unmounts while popped out, so only one window holds a regional feed session at a time.
 */
export function LiveTrafficWindowSlot({
  active,
  protocol,
  onNodeClick,
  onWindowNodeClick,
  ...data
}: LiveTrafficWindowSlotProps) {
  const { t } = useTranslation();
  const liveWindow = useLiveMapWindow(protocol, data, onWindowNodeClick);
  const view = useRef<LiveMapView | null>(null);
  const rememberView = useCallback((next: LiveMapView) => {
    view.current = next;
  }, []);
  const { popOut } = liveWindow;
  const openWindow = useCallback(() => {
    popOut(view.current);
  }, [popOut]);

  if (liveWindow.open) {
    if (!active) return null;
    return (
      <section
        aria-label={t('liveTraffic.title')}
        className="bg-app-bg text-ink-200 flex h-full min-h-0 items-center justify-center p-5"
      >
        <div className="border-ink-700 bg-deep-black rounded-card shadow-level-1 max-w-sm border p-5 text-center">
          <AppWindow aria-hidden className="text-muted mx-auto mb-3 h-6 w-6" />
          <h2 className="mb-1 text-sm font-medium">{t('liveTraffic.window.openElsewhere')}</h2>
          <p className="text-muted mb-4 text-xs leading-relaxed">
            {t('liveTraffic.window.openElsewhereHint')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              onClick={openWindow}
              icon={<ExternalLink aria-hidden className="h-3.5 w-3.5" />}
            >
              {t('liveTraffic.window.show')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={liveWindow.dock}
              icon={<ArrowDownToLine aria-hidden className="h-3.5 w-3.5" />}
            >
              {t('liveTraffic.window.moveBack')}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <Suspense fallback={<div className="text-muted p-4">{t('app.loadingApp')}</div>}>
      <LiveTrafficPanel
        key={liveWindow.docked.revision}
        active={active}
        {...data}
        onNodeClick={onNodeClick}
        initialView={liveWindow.docked.view}
        onViewChange={rememberView}
        windowActions={
          liveWindow.available ? (
            <IconButton
              size="sm"
              variant="ghost"
              aria-label={t('liveTraffic.window.open')}
              onClick={openWindow}
              icon={<ExternalLink aria-hidden className="h-3.5 w-3.5" />}
            />
          ) : null
        }
      />
    </Suspense>
  );
}
