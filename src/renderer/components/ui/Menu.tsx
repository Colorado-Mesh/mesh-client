import { ChevronDown } from 'lucide-react-motion';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { Z_POPOVER_MENU } from '@/renderer/lib/modalZIndex';

import { Button, type ButtonVariant, IconButton } from './Button';

export interface MenuItem {
  id: string;
  label: string;
  /** Second line under the label (muted). */
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | 'separator';

interface MenuPosition {
  top: number;
  left: number;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

function computePosition(
  anchor: HTMLElement,
  menu: HTMLElement,
  align: 'start' | 'end',
): MenuPosition {
  const a = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = align === 'end' ? a.right - width : a.left;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN));
  const below = a.bottom + MENU_GAP;
  const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, a.top - MENU_GAP - height);
  return { top, left };
}

export interface MenuProps {
  id?: string;
  open: boolean;
  /** Called on Escape, Tab, outside click, scroll, resize, or after an item is chosen. */
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  entries: readonly MenuEntry[];
  'aria-label': string;
  align?: 'start' | 'end';
  /** Menu width in px at the default text size (248, as in the Option B mockups); scales with it. */
  width?: number;
}

/**
 * Popup menu (`role="menu"`) portaled to `document.body` so card `overflow-hidden` never clips it.
 * Arrow keys, Home and End move between items; Escape closes and returns focus to the trigger.
 */
export function Menu({
  id,
  open,
  onClose,
  anchorRef,
  entries,
  'aria-label': ariaLabel,
  align = 'end',
  width = 248,
}: MenuProps) {
  const fallbackId = useId();
  const menuDomId = id ?? fallbackId;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const itemButtons = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        [],
    );

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    setPosition(computePosition(anchor, menu, align));
    // With every item disabled, focus the menu itself so Escape and Tab still reach its handler.
    (itemButtons()[0] ?? menu).focus();
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onDismiss = () => {
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const closeAndRefocus = () => {
    onClose();
    anchorRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAndRefocus();
      return;
    } else if (e.key === 'Tab') {
      onClose();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        zIndex: Z_POPOVER_MENU,
        width: `${width / 16}rem`,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
      }}
      className="border-secondary-dark bg-deep-black rounded-card shadow-level-2 fixed border p-1"
    >
      {entries.map((entry, index) =>
        entry === 'separator' ? (
          <div
            key={`separator-${index}`}
            role="separator"
            className="bg-ink-800 mx-1.5 my-1 h-px"
          />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            aria-label={entry.label}
            aria-describedby={entry.description ? `${menuDomId}-${entry.id}-desc` : undefined}
            disabled={entry.disabled}
            onClick={() => {
              closeAndRefocus();
              entry.onSelect();
            }}
            className={`text-body rounded-badge flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
              entry.tone === 'danger'
                ? 'text-red-400 hover:bg-red-400/10 focus-visible:bg-red-400/10'
                : 'hover:bg-sidebar-active-bg focus-visible:bg-sidebar-active-bg text-ink-200'
            }`}
          >
            {entry.icon && <span className="mt-px flex shrink-0">{entry.icon}</span>}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{entry.label}</span>
              {entry.description && (
                <span id={`${menuDomId}-${entry.id}-desc`} className="text-meta text-ink-300">
                  {entry.description}
                </span>
              )}
            </span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Open state and ids for a button that opens a `Menu`; the caller owns the trigger ref. */
export function useMenuState() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);
  return { open, close, toggle, menuId };
}

/** ARIA wiring for a menu trigger. */
export function menuTriggerAria(open: boolean, menuId: string) {
  return {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  };
}

export interface MenuButtonProps {
  /** Accessible name of the trigger, e.g. "More actions for Ridge Fox". */
  'aria-label': string;
  icon: ReactNode;
  entries: readonly MenuEntry[];
  menuLabel: string;
  variant?: 'ghost' | 'secondary';
  size?: 'sm' | 'md';
  disabled?: boolean;
  align?: 'start' | 'end';
  width?: number;
}

/** Icon button that opens a menu: the overflow ("more actions") pattern for rows and headers. */
export function MenuButton({
  'aria-label': ariaLabel,
  icon,
  entries,
  menuLabel,
  variant = 'ghost',
  size = 'md',
  disabled,
  align = 'end',
  width,
}: MenuButtonProps) {
  const { open, close, toggle, menuId } = useMenuState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={triggerRef}
        aria-label={ariaLabel}
        icon={icon}
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={toggle}
        {...menuTriggerAria(open, menuId)}
      />
      <Menu
        id={menuId}
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        entries={entries}
        aria-label={menuLabel}
        align={align}
        width={width}
      />
    </>
  );
}

export interface LabeledMenuButtonProps {
  /** Visible label; the chevron marks it as a menu ("Export"). */
  label: string;
  icon?: ReactNode;
  entries: readonly MenuEntry[];
  menuLabel: string;
  variant?: Extract<ButtonVariant, 'secondary' | 'ghost'>;
  size?: 'sm' | 'md';
  disabled?: boolean;
  align?: 'start' | 'end';
  width?: number;
}

/** Text button that opens a menu, for a group of equal choices with no default (Export formats). */
export function LabeledMenuButton({
  label,
  icon,
  entries,
  menuLabel,
  variant = 'secondary',
  size = 'md',
  disabled,
  align = 'end',
  width,
}: LabeledMenuButtonProps) {
  const { open, close, toggle, menuId } = useMenuState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        icon={icon}
        disabled={disabled}
        onClick={toggle}
        {...menuTriggerAria(open, menuId)}
      >
        {label}
        <ChevronDown aria-hidden className={`${ICON_MD} text-muted`} size={16} />
      </Button>
      <Menu
        id={menuId}
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        entries={entries}
        aria-label={menuLabel}
        align={align}
        width={width}
      />
    </>
  );
}

export interface SplitButtonProps {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Accessible name for the chevron, e.g. "More disconnect options". */
  menuTriggerLabel: string;
  menuLabel: string;
  entries: readonly MenuEntry[];
  /** Group name, e.g. "Disconnect radio". */
  groupLabel: string;
  variant?: Extract<ButtonVariant, 'secondary' | 'danger'>;
  disabled?: boolean;
}

const SPLIT_GROUP: Record<NonNullable<SplitButtonProps['variant']>, string> = {
  secondary: 'border-secondary-dark bg-sidebar-active-bg',
  danger: 'border-red-400/45',
};

const SPLIT_MAIN: Record<NonNullable<SplitButtonProps['variant']>, string> = {
  secondary: 'text-ink-200 hover:bg-secondary-dark',
  danger: 'text-red-400 hover:bg-red-400/10',
};

const SPLIT_CHEVRON: Record<NonNullable<SplitButtonProps['variant']>, string> = {
  secondary: 'border-secondary-dark text-ink-300 hover:bg-secondary-dark',
  danger: 'border-red-400/30 text-red-400 hover:bg-red-400/10',
};

/** Main action plus a chevron menu for its rarer variants (Export formats, Disconnect all and quit). */
export function SplitButton({
  label,
  icon,
  onClick,
  menuTriggerLabel,
  menuLabel,
  entries,
  groupLabel,
  variant = 'secondary',
  disabled,
}: SplitButtonProps) {
  const { open, close, toggle, menuId } = useMenuState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className={`rounded-control flex shrink-0 overflow-hidden border ${SPLIT_GROUP[variant]}`}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`text-body flex h-7.5 items-center gap-1.5 px-3 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SPLIT_MAIN[variant]}`}
      >
        {icon}
        {label}
      </button>
      <button
        ref={triggerRef}
        type="button"
        aria-label={menuTriggerLabel}
        title={menuTriggerLabel}
        disabled={disabled}
        onClick={toggle}
        {...menuTriggerAria(open, menuId)}
        className={`flex h-7.5 w-7.5 items-center justify-center border-l transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SPLIT_CHEVRON[variant]}`}
      >
        <ChevronDown aria-hidden className={ICON_MD} size={16} />
      </button>
      <Menu
        id={menuId}
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        entries={entries}
        aria-label={menuLabel}
      />
    </div>
  );
}
