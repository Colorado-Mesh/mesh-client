import { Keyboard, TriangleAlert } from 'lucide-react-motion';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  type ComposerWireContext,
  computeComposerLimitStatus,
  countMessageWireBytes,
} from '@/renderer/lib/chatComposerLimits';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import type { MeshProtocol } from '@/renderer/lib/types';
import {
  CHAT_MACRO_LABEL_MAX,
  CHAT_MACRO_TEXT_MAX,
  type ChatMacroSendMode,
  type ChatMacroSize,
  resolveChatMacroSize,
  useChatMacrosStore,
} from '@/renderer/stores/chatMacrosStore';

import { chatMacroKeyName } from './ChatMacroBar';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZE_OPTIONS: { value: ChatMacroSize; labelKey: string; px: number }[] = [
  { value: 'small', labelKey: 'chatMacros.sizeSmall', px: 20 },
  { value: 'medium', labelKey: 'chatMacros.sizeMedium', px: 32 },
  { value: 'large', labelKey: 'chatMacros.sizeLarge', px: 44 },
];

const SEND_MODE_OPTIONS: { value: ChatMacroSendMode; labelKey: string }[] = [
  { value: 'insert', labelKey: 'chatMacros.sendModeInsert' },
  { value: 'sendNow', labelKey: 'chatMacros.sendModeSendNow' },
];

export interface EditMacrosDialogProps {
  protocol: MeshProtocol;
  payloadLimit?: number;
  composerContext?: ComposerWireContext;
  senderDisplayName?: string;
  useWireByteCount?: boolean;
  /** Row whose label field gets focus on open (e.g. the empty slot that was clicked). */
  initialFocusIndex?: number;
  onClose: () => void;
}

export function EditMacrosDialog({
  protocol,
  payloadLimit,
  composerContext,
  senderDisplayName,
  useWireByteCount,
  initialFocusIndex = 0,
  onClose,
}: EditMacrosDialogProps) {
  const { t } = useTranslation();
  const iconTrigger = useIconTrigger();
  const titleId = useId();
  const sizeLabelId = useId();
  const sendModeLabelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const initialFocusRef = useRef(initialFocusIndex);

  const slots = useChatMacrosStore((s) => s.slots);
  const storedSize = useChatMacrosStore((s) => s.size);
  const sendMode = useChatMacrosStore((s) => s.sendMode);
  const setSlotLabel = useChatMacrosStore((s) => s.setSlotLabel);
  const setSlotText = useChatMacrosStore((s) => s.setSlotText);
  const setSize = useChatMacrosStore((s) => s.setSize);
  const setSendMode = useChatMacrosStore((s) => s.setSendMode);
  const size = resolveChatMacroSize(storedSize);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    panel
      .querySelector<HTMLInputElement>(`[data-macro-label-index="${initialFocusRef.current}"]`)
      ?.focus();

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [onClose]);

  const segmentClass = (selected: boolean) =>
    `rounded-control text-control inline-flex items-center gap-1.5 px-2.5 py-1 transition-colors ${
      selected ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:text-ink-200'
    }`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.close')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col border"
      >
        <div className="border-ink-700 flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h3 id={titleId} className="text-ink-200 flex items-center gap-2 text-sm font-semibold">
            <Keyboard aria-hidden className="text-ink-300" trigger={iconTrigger} size={16} />
            {t('chatMacros.dialogTitle')}
          </h3>
          <div className="ml-auto flex items-center gap-2">
            <span id={sendModeLabelId} className="text-label text-muted">
              {t('chatMacros.whenUsed')}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={sendModeLabelId}
              className="border-secondary-dark rounded-card flex gap-0.5 border p-0.5"
            >
              {SEND_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={sendMode === opt.value}
                  onClick={() => {
                    setSendMode(opt.value);
                  }}
                  className={segmentClass(sendMode === opt.value)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="border-secondary-dark bg-sidebar-active-bg text-label text-ink-300 hover:text-ink-200 rounded-badge border px-1.5 font-mono leading-5"
            >
              {t('chatMacros.escKey')}
            </button>
          </div>
        </div>

        <div className="border-ink-700 flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <span id={sizeLabelId} className="text-label text-muted">
            {t('chatMacros.size')}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={sizeLabelId}
            className="border-secondary-dark rounded-card flex gap-0.5 border p-0.5"
          >
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={size === opt.value}
                onClick={() => {
                  setSize(opt.value);
                }}
                className={segmentClass(size === opt.value)}
              >
                {t(opt.labelKey)}
                <span className="text-label text-ink-300 font-mono">{opt.px}</span>
              </button>
            ))}
          </div>
          <p className="text-label text-muted min-w-0 flex-1">{t('chatMacros.sizeHelp')}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="text-label text-muted mb-2">{t('chatMacros.rangeHeading')}</p>
          <ul className="space-y-1.5">
            {slots.map((slot, index) => (
              <MacroRow
                key={index}
                index={index}
                label={slot.label}
                text={slot.text}
                protocol={protocol}
                payloadLimit={payloadLimit}
                composerContext={composerContext}
                senderDisplayName={senderDisplayName}
                useWireByteCount={useWireByteCount}
                onLabelChange={setSlotLabel}
                onTextChange={setSlotText}
              />
            ))}
          </ul>
        </div>

        <div className="border-ink-700 text-label text-muted flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            <FooterKey>{t('chatMacros.tabKey')}</FooterKey>
            {t('chatMacros.footerNextField')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FooterKey>{t('chatMacros.escKey')}</FooterKey>
            {t('chatMacros.footerClose')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TriangleAlert aria-hidden trigger={iconTrigger} size={14} />
            {t('chatMacros.footerOsKeys')}
          </span>
          <span className="ml-auto font-mono">{t('chatMacros.footerAutoSave')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FooterKey({ children }: { children: string }) {
  return (
    <kbd className="border-secondary-dark bg-sidebar-active-bg text-label text-ink-300 rounded-badge border px-1.5 font-mono leading-4 pointer-coarse:hidden">
      {children}
    </kbd>
  );
}

interface MacroRowProps {
  index: number;
  label: string;
  text: string;
  protocol: MeshProtocol;
  payloadLimit?: number;
  composerContext?: ComposerWireContext;
  senderDisplayName?: string;
  useWireByteCount?: boolean;
  onLabelChange: (index: number, label: string) => void;
  onTextChange: (index: number, text: string) => void;
}

function MacroRow({
  index,
  label,
  text,
  protocol,
  payloadLimit,
  composerContext,
  senderDisplayName,
  useWireByteCount,
  onLabelChange,
  onTextChange,
}: MacroRowProps) {
  const { t } = useTranslation();
  const warnId = useId();
  const key = chatMacroKeyName(index);
  const bytes = countMessageWireBytes(text.trim());
  const status = computeComposerLimitStatus(text, protocol, {
    payloadLimitOverride: payloadLimit,
    composerContext,
    senderDisplayName,
    useWireByteCount,
  });
  const overLimit = text.trim() !== '' && (status.phase === 'split' || status.phase === 'overMax');
  const inputBase =
    'rounded-control text-body text-ink-200 placeholder:text-muted bg-app-bg border px-2 py-1 focus:outline-none';

  return (
    <li className="flex items-center gap-2">
      <span className="border-secondary-dark bg-sidebar-active-bg text-label text-ink-300 rounded-badge w-10 shrink-0 border text-center font-mono leading-5">
        {key}
      </span>
      <input
        type="text"
        data-macro-label-index={index}
        value={label}
        maxLength={CHAT_MACRO_LABEL_MAX}
        onChange={(e) => {
          onLabelChange(index, e.target.value);
        }}
        placeholder={t('chatMacros.labelPlaceholder')}
        aria-label={t('chatMacros.labelAria', { key })}
        className={`${inputBase} border-secondary-dark focus:border-brand-green w-28 shrink-0`}
      />
      <input
        type="text"
        value={text}
        maxLength={CHAT_MACRO_TEXT_MAX}
        onChange={(e) => {
          onTextChange(index, e.target.value);
        }}
        placeholder={t('chatMacros.textPlaceholder')}
        aria-label={t('chatMacros.textAria', { key })}
        aria-invalid={overLimit || undefined}
        aria-describedby={overLimit ? warnId : undefined}
        className={`${inputBase} min-w-0 flex-1 ${
          overLimit
            ? 'border-red-500 focus:border-red-400'
            : 'border-secondary-dark focus:border-brand-green'
        }`}
      />
      <span
        className={`text-label inline-flex w-16 shrink-0 items-center justify-end gap-1 font-mono ${
          overLimit ? 'text-red-400' : 'text-muted'
        }`}
      >
        {overLimit && <TriangleAlert aria-hidden size={12} />}
        {t('chatMacros.bytes', { bytes })}
      </span>
      {overLimit && (
        <span id={warnId} className="sr-only">
          {t('chatMacros.overLimit', { limit: status.singleMessageLimit })}
        </span>
      )}
    </li>
  );
}
