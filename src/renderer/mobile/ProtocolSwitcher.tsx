import './ProtocolSwitcher.css';

import { Check, ChevronDown, X } from 'lucide-react-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

export interface ProtocolSwitcherProps {
  protocol: MeshProtocol;
  onSelect: (protocol: MeshProtocol) => void;
  contexts: Record<MeshProtocol, { radioName: string; connected: boolean; unreadCount: number }>;
}

export function ProtocolSwitcher({ protocol, onSelect, contexts }: ProtocolSwitcherProps) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const activeTheme = PROTOCOL_THEME[protocol];

  const positionSheet = useCallback(() => {
    const sheet = dialog.current;
    if (!sheet) return;
    const shell = trigger.current?.closest('.mobile-shell');
    const bounds = shell?.getBoundingClientRect();
    const shellWidth = bounds?.width || window.innerWidth;
    const wide = shell?.getAttribute('data-wide') === 'true';
    const margin = wide ? 16 : 0;
    const width = Math.min(shellWidth, wide ? 360 : 720, window.innerWidth - margin * 2);
    const triggerBounds = trigger.current?.getBoundingClientRect();
    const anchorLeft = wide
      ? (triggerBounds?.right ?? margin + width) - width
      : (bounds?.left ?? 0) + (shellWidth - width) / 2;
    const left = Math.max(margin, Math.min(anchorLeft, window.innerWidth - width - margin));
    const top = Math.max(
      margin,
      Math.min((triggerBounds?.bottom ?? margin) + 8, window.innerHeight - 176),
    );
    const bottom = Math.max(0, window.innerHeight - (bounds?.bottom ?? window.innerHeight));
    sheet.dataset.presentation = wide ? 'popover' : 'sheet';
    sheet.style.setProperty('--protocol-sheet-width', `${width}px`);
    sheet.style.setProperty('--protocol-sheet-left', `${left}px`);
    sheet.style.setProperty('--protocol-sheet-bottom', `${bottom}px`);
    sheet.style.setProperty('--protocol-sheet-top', `${top}px`);
    sheet.style.setProperty('--protocol-sheet-height', `${window.innerHeight - top - margin}px`);
  }, []);

  const restoreFocus = useCallback(() => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }, []);

  const closeSheet = useCallback(() => {
    if (dialog.current?.open) dialog.current.close();
    restoreFocus();
  }, [restoreFocus]);

  useEffect(() => {
    const sheet = dialog.current;
    if (!open || !sheet) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = sheet.querySelectorAll<HTMLElement>('button, input:checked');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleBackdrop = (event: MouseEvent) => {
      if (event.target === sheet) closeSheet();
    };
    sheet.addEventListener('keydown', handleKeyDown);
    sheet.addEventListener('click', handleBackdrop);
    window.addEventListener('resize', positionSheet);
    window.addEventListener('scroll', positionSheet, true);
    const shell = trigger.current?.closest('.mobile-shell');
    const shellObserver = new MutationObserver(positionSheet);
    if (shell) shellObserver.observe(shell, { attributes: true, attributeFilter: ['data-wide'] });
    return () => {
      sheet.removeEventListener('keydown', handleKeyDown);
      sheet.removeEventListener('click', handleBackdrop);
      window.removeEventListener('resize', positionSheet);
      window.removeEventListener('scroll', positionSheet, true);
      shellObserver.disconnect();
    };
  }, [open, positionSheet, closeSheet]);

  const openSheet = () => {
    const sheet = dialog.current;
    if (!sheet || sheet.open) return;
    positionSheet();
    sheet.showModal();
    setOpen(true);
    sheet.querySelector<HTMLInputElement>('input:checked')?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`mobile-protocol-trigger ${activeTheme.nameTextClass}`}
        aria-label={t('mobilePrototype.switchProtocol', { protocol: activeTheme.displayName })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        onClick={openSheet}
      >
        <span>{activeTheme.displayName}</span>
        <ChevronDown aria-hidden="true" size={18} />
      </button>

      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        className="mobile-protocol-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        aria-modal="true"
        onClose={restoreFocus}
        onCancel={(event) => {
          event.preventDefault();
          closeSheet();
        }}
      >
        <div className="mobile-protocol-sheet">
          <div className="mobile-protocol-sheet-header">
            <h2 id={`${id}-title`} className="text-title font-semibold">
              {t('mobilePrototype.protocolSwitcherTitle')}
            </h2>
            <button
              type="button"
              className="mobile-protocol-close"
              aria-label={t('mobilePrototype.closeProtocolSwitcher')}
              onClick={closeSheet}
            >
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          <p id={`${id}-description`} className="text-body-lg text-muted leading-relaxed">
            {t('mobilePrototype.protocolIsolation')}
          </p>
          <fieldset className="mobile-protocol-options">
            <legend className="sr-only">{t('mobilePrototype.protocolSwitcherTitle')}</legend>
            {REGISTERED_MESH_PROTOCOLS.map((value) => {
              const theme = PROTOCOL_THEME[value];
              const context = contexts[value];
              const selected = value === protocol;
              const contextId = `${id}-${value}-context`;
              const unreadId = `${id}-${value}-unread`;
              return (
                <label
                  key={value}
                  className={`mobile-protocol-option ${selected ? theme.railActiveClass : 'bg-deep-black'}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${id}-protocol`}
                    value={value}
                    checked={selected}
                    aria-label={t(theme.ariaSwitchKey)}
                    aria-describedby={`${contextId} ${unreadId}`}
                    onChange={() => {
                      onSelect(value);
                      closeSheet();
                    }}
                    onClick={() => {
                      if (selected) closeSheet();
                    }}
                  />
                  <span
                    className={`mobile-protocol-monogram ${theme.nameTextClass}`}
                    aria-hidden="true"
                  >
                    {theme.monogram}
                  </span>
                  <span className="mobile-protocol-context">
                    <span className={`text-title block font-medium ${theme.nameTextClass}`}>
                      {theme.displayName}
                    </span>
                    <span id={contextId} className="text-body-lg text-ink-300 mt-1 block">
                      <span className="block">{context.radioName}</span>{' '}
                      <span className="text-label text-muted mt-1 block">
                        {t(
                          context.connected
                            ? 'mobilePrototype.sampleLinkReady'
                            : 'mobilePrototype.notConnected',
                        )}
                      </span>
                    </span>
                    <span
                      id={unreadId}
                      className={`mobile-protocol-unread text-label mt-2 ${context.unreadCount > 0 ? theme.unreadBadgeFillClass : 'text-muted'}`}
                    >
                      {t('mobilePrototype.sampleUnread', { count: context.unreadCount })}
                    </span>
                  </span>
                  {selected && <Check aria-hidden="true" size={22} className="shrink-0" />}
                </label>
              );
            })}
          </fieldset>
        </div>
      </dialog>
    </>
  );
}
