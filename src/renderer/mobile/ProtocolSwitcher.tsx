import './ProtocolSwitcher.css';

import { ChevronDown, Radio, X } from 'lucide-react-motion';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProtocolSwitcher as SharedProtocolSwitcher } from '@/renderer/components/ProtocolSwitcher';
import { StatusDot } from '@/renderer/components/ui/StatusDot';
import { PROTOCOL_THEME } from '@/renderer/lib/protocolTheme';
import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

export interface ProtocolSwitcherProps {
  protocol: MeshProtocol;
  onSelect: (protocol: MeshProtocol) => void;
  contexts: Record<MeshProtocol, { radioName: string; connected: boolean; unreadCount: number }>;
  wide?: boolean;
}

export function ProtocolSwitcher({
  protocol,
  onSelect,
  contexts,
  wide = false,
}: ProtocolSwitcherProps) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const activeTheme = PROTOCOL_THEME[protocol];
  const unreadByProtocol = Object.fromEntries(
    REGISTERED_MESH_PROTOCOLS.map((value) => [value, contexts[value].unreadCount]),
  ) as Record<MeshProtocol, number>;

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
      ? (triggerBounds?.right ?? bounds?.left ?? margin) + 8
      : (bounds?.left ?? 0) + (shellWidth - width) / 2;
    const minimumLeft = Math.max(margin, bounds?.left ?? 0);
    const maximumLeft = Math.min(
      window.innerWidth - width - margin,
      (bounds?.right ?? window.innerWidth) - width,
    );
    const left = Math.max(minimumLeft, Math.min(anchorLeft, maximumLeft));
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
      const controls = sheet.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])');
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
    sheet.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
  };

  const selectFromSheet = (value: MeshProtocol) => {
    if (value !== protocol) onSelect(value);
    closeSheet();
    queueMicrotask(() => trigger.current?.focus({ preventScroll: true }));
  };

  return (
    <>
      {wide && (
        <div className="mobile-protocol-rail-control">
          <SharedProtocolSwitcher
            protocol={protocol}
            unreadByProtocol={unreadByProtocol}
            onProtocolChange={onSelect}
            orientation="vertical"
          />
        </div>
      )}
      <button
        ref={trigger}
        type="button"
        className={`mobile-protocol-trigger ${wide ? 'mobile-protocol-radio-trigger text-muted' : activeTheme.nameTextClass}`}
        aria-label={t('mobilePrototype.switchProtocol', { protocol: activeTheme.displayName })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        onClick={openSheet}
      >
        {wide ? (
          <Radio aria-hidden="true" size={18} />
        ) : (
          <>
            <span>{activeTheme.displayName}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </>
        )}
      </button>

      <dialog
        ref={dialog}
        id={`${id}-dialog`}
        className="mobile-protocol-dialog"
        aria-labelledby={`${id}-title`}
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
          <div className="mobile-protocol-segments">
            <SharedProtocolSwitcher
              protocol={protocol}
              unreadByProtocol={unreadByProtocol}
              onProtocolChange={selectFromSheet}
              orientation="horizontal"
            />
          </div>
          <div className="mobile-protocol-context-list">
            {REGISTERED_MESH_PROTOCOLS.map((value) => {
              const theme = PROTOCOL_THEME[value];
              const context = contexts[value];
              return (
                <div key={value} className="mobile-protocol-context-row">
                  <Radio aria-hidden="true" size={16} className={theme.nameTextClass} />
                  <span className="mobile-protocol-context">
                    <span className={`text-label block font-medium ${theme.nameTextClass}`}>
                      {theme.displayName}
                    </span>
                    <span className="text-body text-ink-200 block font-medium">
                      {context.radioName}
                    </span>
                    <span className="mobile-protocol-context-status text-label text-muted">
                      <StatusDot tone={context.connected ? 'ok' : 'idle'} />
                      {t(
                        context.connected
                          ? 'mobilePrototype.sampleLinkReady'
                          : 'mobilePrototype.notConnected',
                      )}
                    </span>
                  </span>
                  <span className="mobile-protocol-unread text-label text-muted">
                    {t('mobilePrototype.sampleUnread', { count: context.unreadCount })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </dialog>
    </>
  );
}
