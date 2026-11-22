import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '../../shared/meshProtocol';
import { defaultFirstRunSelection } from '../lib/firstRunWizard';
import {
  acknowledgeMeshcomLicense,
  isMeshcomLicenseAcknowledged,
} from '../lib/meshcom/meshcomLicenseAck';
import { PROTOCOL_THEME } from '../lib/protocolTheme';
import { ConfirmModal } from './ConfirmModal';
import { focusSelectedSectionTabSoon } from './firstRunFocus';
import { Button } from './ui/Button';

/** What each protocol needs, shown under its name (issue #1542 wording). */
const PROTOCOL_NEEDS_KEY: Record<MeshProtocol, string> = {
  meshtastic: 'firstRun.needs.meshtastic',
  meshcore: 'firstRun.needs.meshcore',
  reticulum: 'firstRun.needs.reticulum',
  meshcom: 'firstRun.needs.meshcom',
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  onContinue: (selected: MeshProtocol[]) => void;
  onSkip: () => void;
}

/**
 * First-run protocol picker (issue #1542). A modal dialog with one checkbox per protocol and
 * what each needs. MeshCom goes through the same licence acknowledgement as App > Protocols.
 * Escape or Skip setup closes it without changing anything.
 */
export function FirstRunProtocolPicker({ onContinue, onSkip }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const introId = useId();
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<MeshProtocol[]>(defaultFirstRunSelection);
  const [licencePending, setLicencePending] = useState(false);
  const licencePendingRef = useRef(false);
  const onSkipRef = useRef(onSkip);

  useEffect(() => {
    onSkipRef.current = onSkip;
  }, [onSkip]);

  useEffect(() => {
    licencePendingRef.current = licencePending;
  }, [licencePending]);

  // Focus once on mount; trap Tab and map Escape to Skip. The licence prompt owns the
  // keyboard while it is open (it has its own trap and Escape).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusOpts = { preventScroll: true } as const;
    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    focusables()[0]?.focus(focusOpts);

    const onKeyDown = (e: KeyboardEvent) => {
      if (licencePendingRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkipRef.current();
        focusSelectedSectionTabSoon();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus(focusOpts);
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus(focusOpts);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggle = (proto: MeshProtocol, checked: boolean) => {
    if (checked && proto === 'meshcom' && !isMeshcomLicenseAcknowledged()) {
      setLicencePending(true);
      return;
    }
    setSelected((prev) => (checked ? [...prev, proto] : prev.filter((p) => p !== proto)));
  };

  const noneSelected = selected.length === 0;

  return (
    // Top-anchored (not centred) so the "choose at least one" hint grows the dialog downward
    // and never moves the checkboxes under the pointer.
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-16">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        data-testid="first-run-protocol-picker"
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative flex max-h-full w-full max-w-lg flex-col border"
      >
        <div className="min-h-0 space-y-4 overflow-y-auto p-6">
          <h2 id={titleId} className="text-ink-200 text-lg font-semibold">
            {t('firstRun.title')}
          </h2>
          <p id={introId} className="text-muted text-sm leading-relaxed">
            {t('firstRun.intro')}
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('firstRun.listLabel')}</legend>
            {REGISTERED_MESH_PROTOCOLS.map((proto) => {
              const inputId = `first-run-protocol-${proto}`;
              const needsId = `${inputId}-needs`;
              const name = PROTOCOL_THEME[proto].displayName;
              return (
                <label
                  key={proto}
                  htmlFor={inputId}
                  className="border-ink-800 hover:bg-ink-900 rounded-card flex cursor-pointer items-start gap-3 border px-3 py-2.5 transition-colors"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected.includes(proto)}
                    onChange={(e) => {
                      toggle(proto, e.target.checked);
                    }}
                    aria-label={name}
                    aria-describedby={needsId}
                    className="accent-brand-green mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="text-ink-200 block text-sm font-medium">{name}</span>
                    <span id={needsId} className="text-muted block text-xs leading-relaxed">
                      {t(PROTOCOL_NEEDS_KEY[proto])}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {noneSelected ? (
            <p id={hintId} role="status" className="text-sm text-orange-300">
              {t('firstRun.noneSelected')}
            </p>
          ) : null}
        </div>
        <div className="border-ink-800 flex flex-wrap justify-end gap-2 border-t px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => {
              onSkip();
              focusSelectedSectionTabSoon();
            }}
          >
            {t('firstRun.skip')}
          </Button>
          <Button
            variant="primary"
            disabled={noneSelected}
            aria-describedby={noneSelected ? hintId : undefined}
            onClick={() => {
              onContinue(selected);
            }}
          >
            {t('firstRun.continue')}
          </Button>
        </div>
      </div>
      {licencePending ? (
        <ConfirmModal
          title={t('meshcom.licenseNoticeTitle')}
          message={t('meshcom.licenseNoticeBody')}
          confirmLabel={t('meshcom.licenseNoticeAccept')}
          onConfirm={() => {
            acknowledgeMeshcomLicense();
            setLicencePending(false);
            setSelected((prev) => (prev.includes('meshcom') ? prev : [...prev, 'meshcom']));
          }}
          onCancel={() => {
            setLicencePending(false);
          }}
        />
      ) : null}
    </div>
  );
}
