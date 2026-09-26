import { Pin, Search } from 'lucide-react-motion';
import type { KeyboardEvent } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { TabIcon } from '@/renderer/lib/icons/tabIcons';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';
import {
  formatBadgeCount,
  NAV_BADGE_FILL_CLASS,
  navBadgeAriaLabel,
  type NavBadgeCounts,
  slotBadge,
} from '@/renderer/lib/navBadges';
import {
  NAV_SECTION_LABEL_KEYS,
  type NavSection,
  type NavSectionTab,
} from '@/renderer/lib/navSections';
import {
  filterLauncherEntries,
  formatShortcut,
  isPinToggleShortcut,
  MAX_LAUNCHER_PINS,
} from '@/renderer/lib/panelLauncher';
import type { TabSlotId } from '@/renderer/lib/tabSlotIds';

import { Kbd } from '../ui/Kbd';

export interface PanelLauncherProps {
  sections: readonly NavSection[];
  badgeCounts: NavBadgeCounts;
  pins: readonly TabSlotId[];
  /** `window.electronAPI.getPlatform()`; picks Cmd or Ctrl for hints and the pin shortcut. */
  platform: string;
  onTogglePin: (slot: TabSlotId) => void;
  /** Open a panel by filtered tab index; the parent closes the launcher. */
  onOpenTab: (tabIndex: number) => void;
  onClose: () => void;
}

interface LauncherGroup {
  key: string;
  label: string;
  entries: NavSectionTab[];
}

const ENTRY_SELECTOR = '[data-launcher-entry]';
const FOCUSABLE_SELECTOR = 'input:not([disabled]), button:not([disabled])';

/**
 * All-panels launcher (Ctrl+K, Cmd+K on macOS). Every panel visible for the active protocol,
 * grouped by rail section and searchable, with pin toggles for Ctrl/Cmd+1..4.
 */
export function PanelLauncher({
  sections,
  badgeCounts,
  pins,
  platform,
  onTogglePin,
  onOpenTab,
  onClose,
}: PanelLauncherProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search field on open; hand focus back to the opener on close.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Escape closes; Tab stays inside the dialog while it is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const allGroups = useMemo<LauncherGroup[]>(() => {
    const multi = sections.filter((s) => s.tabs.length > 1);
    const single = sections.filter((s) => s.tabs.length === 1).flatMap((s) => s.tabs);
    const groups: LauncherGroup[] = multi.map((s) => ({
      key: s.id,
      label: t(NAV_SECTION_LABEL_KEYS[s.id]),
      entries: s.tabs,
    }));
    if (single.length > 0) {
      groups.push({ key: 'other', label: t('shell.launcher.otherGroup'), entries: single });
    }
    return groups;
  }, [sections, t]);

  const groups = useMemo(
    () =>
      allGroups
        .map((group) => ({ ...group, entries: filterLauncherEntries(group.entries, query) }))
        .filter((group) => group.entries.length > 0),
    [allGroups, query],
  );
  const panelCount = allGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const firstMatch = groups[0]?.entries[0];
  const pinsFull = pins.length >= MAX_LAUNCHER_PINS;

  const entryButtons = () =>
    Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>(ENTRY_SELECTOR) ?? []);

  const focusEntry = (from: HTMLElement | null, step: 1 | -1) => {
    const buttons = entryButtons();
    if (buttons.length === 0) return;
    const index = from ? buttons.indexOf(from as HTMLButtonElement) : -1;
    const next = index + step;
    if (next < 0) {
      inputRef.current?.focus();
      return;
    }
    buttons[Math.min(next, buttons.length - 1)]?.focus();
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusEntry(null, 1);
    } else if (e.key === 'Enter' && firstMatch) {
      e.preventDefault();
      onOpenTab(firstMatch.tabIndex);
    }
  };

  const handleEntryKeyDown = (e: KeyboardEvent<HTMLButtonElement>, entry: NavSectionTab) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusEntry(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (isPinToggleShortcut(e, platform)) {
      e.preventDefault();
      if (pins.includes(entry.slot) || !pinsFull) onTogglePin(entry.slot);
      return;
    }
    // Typing on a row goes back to the search field (Space still activates the row).
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
      style={{ zIndex: Z_NODE_DETAIL_MODAL }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('common.close')}
        onClick={onClose}
        className="bg-app-bg/70 absolute inset-0 cursor-default border-0 p-0"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-secondary-dark bg-deep-black relative flex max-h-[76vh] w-full max-w-170 flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        <h2 id={titleId} className="sr-only">
          {t('shell.launcher.title')}
        </h2>
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-slate-800 px-4">
          <Search aria-hidden className={`${ICON_MD} text-muted`} size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            aria-label={t('shell.launcher.searchLabel')}
            placeholder={t('shell.launcher.placeholder')}
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-muted min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.length === 0 ? (
            <p className="text-muted px-2 py-6 text-center text-sm">
              {t('shell.launcher.noResults')}
            </p>
          ) : (
            <div className="gap-x-4 sm:columns-2">
              {groups.map((group) => {
                const headingId = `${titleId}-${group.key}`;
                return (
                  <section
                    key={group.key}
                    aria-labelledby={headingId}
                    className="mb-2 break-inside-avoid"
                  >
                    <h3 id={headingId} className="text-muted px-2 pt-2 pb-1 text-xs font-semibold">
                      {group.label}
                    </h3>
                    <ul>
                      {group.entries.map((entry) => {
                        const badge = slotBadge(entry.slot, badgeCounts);
                        const pinPosition = pins.indexOf(entry.slot);
                        const isPinned = pinPosition !== -1;
                        const isFirstMatch = query.trim() !== '' && entry === firstMatch;
                        return (
                          <li key={entry.panelIndex} className="flex items-center gap-1">
                            <button
                              type="button"
                              data-launcher-entry=""
                              aria-label={navBadgeAriaLabel(t, entry.label, badge)}
                              aria-keyshortcuts={
                                isPinned
                                  ? `${platform === 'darwin' ? 'Meta' : 'Control'}+${pinPosition + 1}`
                                  : undefined
                              }
                              onClick={() => {
                                onOpenTab(entry.tabIndex);
                              }}
                              onKeyDown={(e) => {
                                handleEntryKeyDown(e, entry);
                              }}
                              className={`hover:bg-sidebar-active-bg focus-visible:bg-sidebar-active-bg text-body flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left text-slate-200 outline-none ${
                                isFirstMatch ? 'bg-sidebar-active-bg' : ''
                              }`}
                            >
                              <span className="text-muted flex shrink-0">
                                <TabIcon name={entry.iconSlot} />
                              </span>
                              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                              {badge && (
                                <span
                                  className={`text-label flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1.25 font-mono leading-none text-white ${NAV_BADGE_FILL_CLASS[badge.tone]}`}
                                >
                                  {formatBadgeCount(badge.count)}
                                </span>
                              )}
                              {isFirstMatch && <Kbd>Enter</Kbd>}
                              {isPinned && (
                                <Kbd>{formatShortcut(String(pinPosition + 1), platform)}</Kbd>
                              )}
                            </button>
                            <button
                              type="button"
                              aria-pressed={isPinned}
                              aria-label={
                                isPinned
                                  ? t('shell.launcher.unpin', { label: entry.label })
                                  : t('shell.launcher.pin', { label: entry.label })
                              }
                              title={
                                !isPinned && pinsFull
                                  ? t('shell.launcher.pinLimit', { max: MAX_LAUNCHER_PINS })
                                  : undefined
                              }
                              disabled={!isPinned && pinsFull}
                              onClick={() => {
                                onTogglePin(entry.slot);
                              }}
                              className={`hover:bg-sidebar-active-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                isPinned ? 'text-bright-green' : 'text-muted hover:text-slate-200'
                              }`}
                            >
                              <Pin
                                aria-hidden
                                className={`${ICON_MD} ${isPinned ? 'fill-current' : ''}`}
                                size={16}
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-muted flex h-10 shrink-0 items-center gap-4 border-t border-slate-800 px-4 text-xs">
          <span className="flex items-center gap-1.5">
            <Kbd>{'↑↓'}</Kbd>
            {t('shell.launcher.hintMove')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd>
            {t('shell.launcher.hintOpen')}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{formatShortcut('P', platform)}</Kbd>
            {t('shell.launcher.hintPin')}
          </span>
          <span className="ml-auto font-mono">
            {t('shell.launcher.panelCount', { count: panelCount })}
          </span>
        </div>
      </div>
    </div>
  );
}
