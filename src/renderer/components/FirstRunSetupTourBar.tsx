import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { MeshProtocol } from '../../shared/meshProtocol';
import { PROTOCOL_THEME } from '../lib/protocolTheme';
import { focusSelectedSectionTabSoon } from './firstRunFocus';
import { Button } from './ui/Button';

/** What to do on each protocol's Connection panel during the tour. */
const TOUR_HINT_KEY: Record<MeshProtocol, string> = {
  meshtastic: 'firstRun.tourHint.meshtastic',
  meshcore: 'firstRun.tourHint.meshcore',
  reticulum: 'firstRun.tourHint.reticulum',
  meshcom: 'firstRun.tourHint.meshcom',
};

interface Props {
  protocols: readonly MeshProtocol[];
  step: number;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * Strip above the active panel while the first-run tour runs: which protocol is being set up,
 * how far along the tour is, and Next / Done / Skip. The panel below stays fully usable.
 */
export function FirstRunSetupTourBar({ protocols, step, onNext, onSkip }: Props) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLElement>(null);

  // The picker that opened the tour is gone, so focus would sit on the page body: start the
  // keyboard on the bar (screen readers announce its label) unless it already moved elsewhere.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) barRef.current?.focus({ preventScroll: true });
  }, []);

  const protocol = protocols[step];
  if (protocol == null) return null;
  const isLast = step >= protocols.length - 1;
  const name = PROTOCOL_THEME[protocol].displayName;

  return (
    <section
      ref={barRef}
      tabIndex={-1}
      aria-label={t('firstRun.tourLabel')}
      data-testid="first-run-setup-tour"
      className="border-ink-700 bg-ink-900 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 outline-none"
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-ink-200 text-sm font-medium" aria-live="polite">
          {t('firstRun.tourStep', { name, step: step + 1, total: protocols.length })}
        </p>
        <p className="text-muted text-xs leading-relaxed">
          {t(TOUR_HINT_KEY[protocol])}
          {isLast ? ` ${t('firstRun.tourLastHint')}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {isLast ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSkip();
              focusSelectedSectionTabSoon();
            }}
          >
            {t('firstRun.skip')}
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            onNext();
            if (isLast) focusSelectedSectionTabSoon();
          }}
        >
          {isLast ? t('firstRun.done') : t('firstRun.next')}
        </Button>
      </div>
    </section>
  );
}
