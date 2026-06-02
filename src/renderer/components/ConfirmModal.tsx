import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  preserveFavorites?: boolean;
  onPreserveFavoritesChange?: (value: boolean) => void;
  confirmDisabled?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  preserveFavorites,
  onPreserveFavoritesChange,
  confirmDisabled,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const focusFirst = () => {
      const nodes = focusables();
      nodes[0]?.focus();
    };

    focusFirst();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
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
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep-black relative mx-4 w-full max-w-sm space-y-4 rounded-xl border border-gray-600 p-6 shadow-2xl"
      >
        <h3 id={titleId} className="text-lg font-semibold text-gray-200">
          {title}
        </h3>
        <p className="text-muted text-sm leading-relaxed">{message}</p>
        {onPreserveFavoritesChange != null && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={preserveFavorites ?? false}
              onChange={(e) => {
                onPreserveFavoritesChange(e.target.checked);
              }}
              className="accent-brand-green"
              aria-label={t('radioPanel.resetNodeDbPreserveFavorites')}
            />
            {t('radioPanel.resetNodeDbPreserveFavorites')}
          </label>
        )}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
