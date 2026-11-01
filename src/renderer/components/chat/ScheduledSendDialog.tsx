import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  fromDateTimeLocalValue,
  schedulePresetTimes,
  toDateTimeLocalValue,
  validateScheduledAt,
} from '../../lib/scheduledSend';

export interface ScheduledSendDialogProps {
  /** `create` previews composer text; `edit` lets the user change the queued text. */
  mode: 'create' | 'edit';
  text: string;
  /** Initial target (epoch ms). Defaults to one hour from now. */
  initialAt?: number;
  /** Multi-part queued rows can only be rescheduled, not re-worded. */
  textEditable?: boolean;
  /** Reject / resolve false to keep the dialog open (e.g. persistence failed). */
  onConfirm: (result: { text: string; scheduledAt: number }) => Promise<boolean> | boolean;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pick a send time (and, when editing, the text) for a scheduled chat message. */
export function ScheduledSendDialog({
  mode,
  text,
  initialAt,
  textEditable = mode === 'edit',
  onConfirm,
  onCancel,
}: ScheduledSendDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const whenId = useId();
  const textId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [whenValue, setWhenValue] = useState(() =>
    toDateTimeLocalValue(initialAt ?? schedulePresetTimes().inOneHour),
  );
  const [draftText, setDraftText] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = useMemo(() => schedulePresetTimes(), []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [onCancel]);

  const submit = async () => {
    if (busy) return;
    const scheduledAt = fromDateTimeLocalValue(whenValue);
    const validation = validateScheduledAt(scheduledAt);
    if (validation !== 'ok') {
      setError(
        validation === 'tooFar'
          ? t('chatPanel.scheduleSendErrorFar')
          : t('chatPanel.scheduleSendErrorPast'),
      );
      return;
    }
    const finalText = textEditable ? draftText.trim() : text;
    if (finalText.length === 0) {
      setError(t('chatPanel.scheduleSendErrorEmpty'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const ok = await onConfirm({ text: finalText, scheduledAt });
      if (!ok) setError(t('chatPanel.scheduleSendFailed'));
    } catch (err) {
      console.warn('[ScheduledSendDialog] confirm failed', err);
      setError(t('chatPanel.scheduleSendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (ms: number) => {
    setWhenValue(toDateTimeLocalValue(ms));
    setError(null);
  };

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
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative mx-4 w-full max-w-sm space-y-4 border p-6"
      >
        <h3 id={titleId} className="text-ink-200 text-lg font-semibold">
          {mode === 'edit'
            ? t('chatPanel.scheduleSendEditTitle')
            : t('chatPanel.scheduleSendTitle')}
        </h3>
        {textEditable ? (
          <div className="space-y-1">
            <label htmlFor={textId} className="text-muted text-label block">
              {t('chatPanel.scheduleSendMessageLabel')}
            </label>
            <textarea
              id={textId}
              value={draftText}
              rows={3}
              maxLength={2048}
              onChange={(e) => {
                setDraftText(e.target.value);
              }}
              className="bg-app-bg border-secondary-dark text-body text-ink-200 focus:border-brand-green w-full rounded-lg border px-2.5 py-1.5 focus:outline-none"
            />
          </div>
        ) : (
          <p
            className="text-ink-300 bg-ink-800 max-h-24 overflow-y-auto rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap"
            data-testid="scheduled-send-preview"
          >
            {text}
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor={whenId} className="text-muted text-label block">
            {t('chatPanel.scheduleSendWhen')}
          </label>
          <input
            id={whenId}
            type="datetime-local"
            value={whenValue}
            onChange={(e) => {
              setWhenValue(e.target.value);
              setError(null);
            }}
            className="bg-app-bg border-secondary-dark text-body text-ink-200 focus:border-brand-green w-full rounded-lg border px-2.5 py-1.5 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1 pt-1">
            {[
              { label: t('chatPanel.scheduleSendPreset15m'), at: presets.inFifteenMinutes },
              { label: t('chatPanel.scheduleSendPreset1h'), at: presets.inOneHour },
              { label: t('chatPanel.scheduleSendPresetTomorrow'), at: presets.tomorrowMorning },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  applyPreset(preset.at);
                }}
                className="bg-ink-700 text-ink-200 hover:bg-ink-600 rounded px-2 py-1 text-xs"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-muted text-label">{t('chatPanel.scheduleSendHint')}</p>
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="bg-secondary-dark text-ink-300 hover:bg-ink-600 flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
            className="bg-brand-green text-app-bg flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {mode === 'edit' ? t('chatPanel.scheduleSendSave') : t('chatPanel.scheduleSendConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
