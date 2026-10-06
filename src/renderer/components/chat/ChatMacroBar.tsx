import { ChevronDown, ChevronUp, Ellipsis, Plus, Settings2 } from 'lucide-react-motion';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import {
  CHAT_MACRO_SLOT_COUNT,
  type ChatMacroSize,
  type ChatMacroSlot,
  isChatMacroSlotEmpty,
  resolveChatMacroSize,
  useChatMacrosStore,
} from '@/renderer/stores/chatMacrosStore';

export const CHAT_MACRO_MIN_VISIBLE = 6;

/** Approximate button width per size in rem; drives how many fit before "More". */
const BUTTON_WIDTH_REM: Record<ChatMacroSize, number> = { small: 5.5, medium: 6.5, large: 7 };
export const CONTROL_WIDTH_REM: Record<ChatMacroSize, number> = {
  small: 1.75,
  medium: 2.25,
  large: 3,
};
/** Key badge plus padding once the label has truncated away, plus the gap. */
export const MIN_BUTTON_WIDTH_REM = 2.75;

const BUTTON_HEIGHT_CLASS: Record<ChatMacroSize, string> = {
  small: 'h-5 text-label',
  medium: 'h-8 text-control',
  large: 'h-11 text-control',
};
const ICON_BUTTON_CLASS: Record<ChatMacroSize, string> = {
  small: 'h-5 w-6',
  medium: 'h-8 w-8',
  large: 'h-11 w-11',
};

export function chatMacroKeyName(index: number): string {
  return `F${index + 1}`;
}

/**
 * How many macro buttons fit in `widthPx`. Aims for the design minimum (labels truncate to make
 * room), but only as many as fit at their narrowest, so tiny toolbars never overflow.
 */
export function computeVisibleMacroCount(
  widthPx: number,
  size: ChatMacroSize,
  remPx: number,
): number {
  if (widthPx <= 0) return CHAT_MACRO_SLOT_COUNT;
  const button = BUTTON_WIDTH_REM[size] * remPx;
  const control = CONTROL_WIDTH_REM[size] * remPx;
  const allWidth = widthPx - control * 2;
  const all = Math.floor(allWidth / button);
  if (all >= CHAT_MACRO_SLOT_COUNT) return CHAT_MACRO_SLOT_COUNT;
  // Small buttons are content-sized and truncate, so keep every key visible while they still fit.
  if (
    size === 'small' &&
    Math.floor(allWidth / (MIN_BUTTON_WIDTH_REM * remPx)) >= CHAT_MACRO_SLOT_COUNT
  ) {
    return CHAT_MACRO_SLOT_COUNT;
  }
  const withMoreWidth = widthPx - control * 3;
  const withMore = Math.floor(withMoreWidth / button);
  const fitAtNarrowest = Math.floor(withMoreWidth / (MIN_BUTTON_WIDTH_REM * remPx));
  const target = Math.max(withMore, Math.min(CHAT_MACRO_MIN_VISIBLE, fitAtNarrowest));
  return Math.max(0, Math.min(target, CHAT_MACRO_SLOT_COUNT));
}

function rootRemPx(): number {
  const parsed = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
}

export interface ChatMacroBarProps {
  /** `inline` sits on the hint row (collapsed chip or Small bar); `row` is the full Medium/Large row. */
  placement: 'inline' | 'row';
  onApply: (index: number) => void;
  onEdit: (focusIndex: number) => void;
}

export function ChatMacroBar({ placement, onApply, onEdit }: ChatMacroBarProps) {
  const { t } = useTranslation();
  const iconTrigger = useParentIconTrigger();
  const slots = useChatMacrosStore((s) => s.slots);
  const storedSize = useChatMacrosStore((s) => s.size);
  const collapsed = useChatMacrosStore((s) => s.collapsed);
  const lastUsedIndex = useChatMacrosStore((s) => s.lastUsedIndex);
  const setCollapsed = useChatMacrosStore((s) => s.setCollapsed);
  const size = resolveChatMacroSize(storedSize);

  const ownsPlacement =
    collapsed || size === 'small' ? placement === 'inline' : placement === 'row';
  if (!ownsPlacement) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          setCollapsed(false);
        }}
        aria-label={t('chatMacros.show')}
        aria-expanded={false}
        className="border-secondary-dark bg-sidebar-active-bg text-label text-ink-300 hover:text-ink-200 rounded-control inline-flex h-6 shrink-0 items-center gap-1 border px-2 transition-colors"
      >
        <span>{t('chatMacros.show')}</span>
        <ChevronUp aria-hidden className="h-3.5 w-3.5" trigger={iconTrigger} size={14} />
      </button>
    );
  }

  return (
    <MacroToolbar
      size={size}
      placement={placement}
      slots={slots}
      lastUsedIndex={lastUsedIndex}
      onApply={onApply}
      onEdit={onEdit}
      onCollapse={() => {
        setCollapsed(true);
      }}
    />
  );
}

interface MacroToolbarProps {
  size: ChatMacroSize;
  placement: 'inline' | 'row';
  slots: ChatMacroSlot[];
  lastUsedIndex: number | null;
  onApply: (index: number) => void;
  onEdit: (focusIndex: number) => void;
  onCollapse: () => void;
}

function MacroToolbar({
  size,
  placement,
  slots,
  lastUsedIndex,
  onApply,
  onEdit,
  onCollapse,
}: MacroToolbarProps) {
  const { t } = useTranslation();
  const iconTrigger = useParentIconTrigger();
  const containerRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const moreWrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidthPx(entry.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (moreWrapRef.current?.contains(e.target as Node)) return;
      setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const visibleCount = computeVisibleMacroCount(widthPx, size, rootRemPx());
  const indices = Array.from({ length: CHAT_MACRO_SLOT_COUNT }, (_, i) => i);
  const visible = indices.slice(0, visibleCount);
  const overflow = indices.slice(visibleCount);
  const fill = placement === 'row';

  const iconButtonClass = `border-secondary-dark bg-sidebar-active-bg text-ink-300 hover:text-ink-200 rounded-control inline-flex shrink-0 items-center justify-center border transition-colors ${ICON_BUTTON_CLASS[size]}`;
  const iconSize = size === 'small' ? 14 : 16;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={t('chatMacros.toolbarAria')}
      className={`flex min-w-0 items-center gap-1 ${fill ? 'mt-2 w-full' : 'flex-1 justify-end'}`}
    >
      {visible.map((index) => (
        <MacroButton
          key={index}
          index={index}
          slot={slots[index]}
          size={size}
          fill={fill}
          active={lastUsedIndex === index}
          onApply={onApply}
          onEdit={onEdit}
        />
      ))}
      {overflow.length > 0 && (
        <div ref={moreWrapRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={t('chatMacros.more')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? moreMenuId : undefined}
            onClick={() => {
              setMoreOpen((open) => !open);
            }}
            className={iconButtonClass}
          >
            <Ellipsis aria-hidden trigger={iconTrigger} size={iconSize} />
          </button>
          {moreOpen && (
            <div
              id={moreMenuId}
              role="menu"
              aria-label={t('chatMacros.more')}
              className="bg-deep-black border-ink-600 rounded-card shadow-level-2 absolute right-0 bottom-full z-20 mb-1 min-w-40 border py-1"
            >
              {overflow.map((index) => {
                const slot = slots[index];
                const empty = isChatMacroSlotEmpty(slot);
                const key = chatMacroKeyName(index);
                const label = slot.label.trim() || slot.text.trim();
                return (
                  <button
                    key={index}
                    type="button"
                    role="menuitem"
                    aria-label={
                      empty
                        ? t('chatMacros.addAria', { key })
                        : t('chatMacros.buttonAria', { key, label })
                    }
                    onClick={() => {
                      setMoreOpen(false);
                      if (empty) onEdit(index);
                      else onApply(index);
                    }}
                    className="text-body text-ink-200 hover:bg-ink-800 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
                  >
                    <KeyBadge keyName={key} active={false} />
                    {empty ? (
                      <Plus aria-hidden className="text-muted" size={14} />
                    ) : (
                      <span className="min-w-0 truncate">{label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={t('chatMacros.editAria')}
        onClick={() => {
          onEdit(0);
        }}
        className={iconButtonClass}
      >
        <Settings2 aria-hidden trigger={iconTrigger} size={iconSize} />
      </button>
      <button
        type="button"
        aria-label={t('chatMacros.hide')}
        aria-expanded
        onClick={onCollapse}
        className={iconButtonClass}
      >
        <ChevronDown aria-hidden trigger={iconTrigger} size={iconSize} />
      </button>
    </div>
  );
}

function KeyBadge({ keyName, active }: { keyName: string; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`rounded-badge text-2xs shrink-0 border px-1 font-mono leading-4 ${
        active ? 'border-app-bg/40 text-app-bg' : 'border-secondary-dark text-ink-300'
      }`}
    >
      {keyName}
    </span>
  );
}

interface MacroButtonProps {
  index: number;
  slot: ChatMacroSlot;
  size: ChatMacroSize;
  fill: boolean;
  active: boolean;
  onApply: (index: number) => void;
  onEdit: (focusIndex: number) => void;
}

function MacroButton({ index, slot, size, fill, active, onApply, onEdit }: MacroButtonProps) {
  const { t } = useTranslation();
  const iconTrigger = useParentIconTrigger();
  const empty = isChatMacroSlotEmpty(slot);
  const key = chatMacroKeyName(index);
  const label = slot.label.trim() || slot.text.trim();
  const tone = active
    ? 'border-brand-green bg-brand-green text-app-bg'
    : empty
      ? 'border-secondary-dark border-dashed bg-transparent text-ink-300 hover:text-ink-200'
      : 'border-secondary-dark bg-sidebar-active-bg text-ink-200 hover:border-brand-green/50';

  return (
    <button
      type="button"
      // Keep focus in the composer so the inserted text lands at the caret.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        if (empty) onEdit(index);
        else onApply(index);
      }}
      aria-label={
        empty ? t('chatMacros.addAria', { key }) : t('chatMacros.buttonAria', { key, label })
      }
      className={`rounded-control inline-flex min-w-0 items-center gap-1.5 border px-1.5 transition-colors ${BUTTON_HEIGHT_CLASS[size]} ${fill ? 'flex-1' : 'max-w-32'} ${tone}`}
    >
      <KeyBadge keyName={key} active={active} />
      {empty ? (
        <Plus
          aria-hidden
          className="shrink-0"
          trigger={iconTrigger}
          size={size === 'small' ? 12 : 14}
        />
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
    </button>
  );
}
