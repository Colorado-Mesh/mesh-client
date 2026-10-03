import { Hash, Pin, Search, SlidersHorizontal, User } from 'lucide-react-motion';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { TabIcon } from '@/renderer/lib/icons/tabIcons';
import {
  findLauncherDestinations,
  type LauncherChannelItem,
  type LauncherContactItem,
  type LauncherMatches,
  type LauncherSettingItem,
} from '@/renderer/lib/launcherDestinations';
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
import { findSettingMatches } from '@/renderer/lib/settingsSearch';
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
  /**
   * `dialog` (default): centered, search focused. `sheet`: phone More sheet from the bottom edge;
   * focus goes to the sheet, not the search field, so the on-screen keyboard stays down.
   */
  variant?: 'dialog' | 'sheet';
  /** Shown under the search row (the phone sheet puts the protocol switcher here). */
  header?: ReactNode;
  /** Channels of the active protocol; searched (not listed) while the user types. */
  channels?: readonly LauncherChannelItem[];
  /** Contacts / nodes / peers of the active protocol; searched, capped, never listed in full. */
  contacts?: readonly LauncherContactItem[];
  /** Heading for contact results: the Nodes, Contacts or Peers tab label. */
  contactsLabel?: string;
  onOpenChannel?: (index: number) => void;
  onOpenContact?: (id: string) => void;
  /** Searchable settings of the active protocol; listed only while the user types. */
  settings?: readonly LauncherSettingItem[];
  /** Jump to a setting; the parent closes the launcher and reveals the row. */
  onOpenSetting?: (item: LauncherSettingItem) => void;
}

const NO_MATCHES: LauncherMatches<never> = { matches: [], more: false };

interface LauncherGroup {
  key: string;
  label: string;
  entries: NavSectionTab[];
}

const ENTRY_SELECTOR = '[data-launcher-entry]';
const FOCUSABLE_SELECTOR = 'input:not([disabled]), button:not([disabled])';
/** Keyboard focus ring, distinct from the active-row fill (`bg-sidebar-active-bg`). */
const LAUNCHER_ROW_FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-brand-green';

interface LauncherTabTarget {
  kind: 'tab';
  tabIndex: number;
}

interface LauncherChannelTarget {
  kind: 'channel';
  index: number;
}

interface LauncherContactTarget {
  kind: 'contact';
  id: string;
}

interface LauncherSettingTarget {
  kind: 'setting';
  item: LauncherSettingItem;
}

type LauncherRowTarget =
  LauncherTabTarget | LauncherChannelTarget | LauncherContactTarget | LauncherSettingTarget;

function launcherRowClass(isActive: boolean, fullWidth: boolean): string {
  return `hover:bg-sidebar-active-bg text-body text-ink-200 flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2 text-left ${LAUNCHER_ROW_FOCUS} ${
    fullWidth ? 'w-full' : 'flex-1'
  }${isActive ? ' bg-sidebar-active-bg' : ''}`;
}

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
  variant = 'dialog',
  header,
  channels,
  contacts,
  contactsLabel,
  onOpenChannel,
  onOpenContact,
  settings,
  onOpenSetting,
}: PanelLauncherProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState('');
  // One index drives the row fill and what Enter opens, including while the search field is focused.
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search field on open; hand focus back to the opener on close.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (variant === 'sheet') dialogRef.current?.focus();
    else inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [variant]);

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
  const channelMatches: LauncherMatches<LauncherChannelItem> = useMemo(
    () => (channels && onOpenChannel ? findLauncherDestinations(channels, query) : NO_MATCHES),
    [channels, onOpenChannel, query],
  );
  const contactMatches: LauncherMatches<LauncherContactItem> = useMemo(
    () => (contacts && onOpenContact ? findLauncherDestinations(contacts, query) : NO_MATCHES),
    [contacts, onOpenContact, query],
  );
  const settingMatches: LauncherMatches<LauncherSettingItem> = useMemo(
    () => (settings && onOpenSetting ? findSettingMatches(settings, query) : NO_MATCHES),
    [settings, onOpenSetting, query],
  );
  const hasDestinations =
    channelMatches.matches.length + contactMatches.matches.length + settingMatches.matches.length >
    0;
  // Same order as the rendered `[data-launcher-entry]` buttons.
  const targets: LauncherRowTarget[] = [];
  const panelRowIndex = new Map<number, number>();
  for (const group of groups) {
    for (const entry of group.entries) {
      panelRowIndex.set(entry.panelIndex, targets.length);
      targets.push({ kind: 'tab', tabIndex: entry.tabIndex });
    }
  }
  const channelRowIndex = new Map<number, number>();
  for (const channel of channelMatches.matches) {
    channelRowIndex.set(channel.index, targets.length);
    targets.push({ kind: 'channel', index: channel.index });
  }
  const contactRowIndex = new Map<string, number>();
  for (const contact of contactMatches.matches) {
    contactRowIndex.set(contact.id, targets.length);
    targets.push({ kind: 'contact', id: contact.id });
  }
  const settingRowIndex = new Map<string, number>();
  for (const item of settingMatches.matches) {
    settingRowIndex.set(item.id, targets.length);
    targets.push({ kind: 'setting', item });
  }
  const active = targets.length === 0 ? -1 : Math.min(activeIndex, targets.length - 1);
  const openTarget = (target: LauncherRowTarget | undefined) => {
    if (!target) return;
    if (target.kind === 'tab') onOpenTab(target.tabIndex);
    else if (target.kind === 'channel') onOpenChannel?.(target.index);
    else if (target.kind === 'contact') onOpenContact?.(target.id);
    else onOpenSetting?.(target.item);
  };
  const pinsFull = pins.length >= MAX_LAUNCHER_PINS;

  const entryButtons = () =>
    Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>(ENTRY_SELECTOR) ?? []);

  const focusEntry = (from: HTMLElement | null, step: 1 | -1) => {
    const buttons = entryButtons();
    if (buttons.length === 0) return;
    // From the search field, step away from the row that is already highlighted.
    const current = from ? buttons.indexOf(from as HTMLButtonElement) : Math.max(active, 0);
    const next = current + step;
    if (next < 0) {
      setActiveIndex(0);
      inputRef.current?.focus();
      return;
    }
    const index = Math.min(next, buttons.length - 1);
    setActiveIndex(index);
    buttons[index]?.focus();
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusEntry(null, 1);
    } else if (e.key === 'Enter') {
      if (active < 0) return;
      e.preventDefault();
      openTarget(targets[active]);
    }
  };

  /** Arrow keys between rows; typing on a row goes back to the search field. */
  const handleRowNavKeyDown = (e: KeyboardEvent<HTMLButtonElement>): boolean => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusEntry(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      setActiveIndex(0);
      inputRef.current?.focus();
      return true;
    }
    return false;
  };

  const handleEntryKeyDown = (e: KeyboardEvent<HTMLButtonElement>, entry: NavSectionTab) => {
    if (isPinToggleShortcut(e, platform)) {
      e.preventDefault();
      if (pins.includes(entry.slot) || !pinsFull) onTogglePin(entry.slot);
      return;
    }
    // Space still activates the row.
    handleRowNavKeyDown(e);
  };

  const renderDestinationGroup = (
    key: string,
    label: string,
    more: boolean,
    rows: ReactNode,
  ): ReactNode => {
    const headingId = `${titleId}-${key}`;
    return (
      <section key={key} aria-labelledby={headingId} className="mb-2">
        <h3 id={headingId} className="text-muted px-2 pt-2 pb-1 text-xs font-semibold">
          {label}
        </h3>
        <ul>{rows}</ul>
        {more && <p className="text-muted px-2 pt-1 text-xs">{t('shell.launcher.moreMatches')}</p>}
      </section>
    );
  };

  return (
    <div
      className={`fixed inset-0 flex justify-center ${
        variant === 'sheet' ? 'items-end' : 'items-start px-4 pt-[12vh]'
      }`}
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
        data-panel-launcher=""
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`border-secondary-dark bg-deep-black shadow-level-3 relative flex w-full flex-col overflow-hidden border outline-none ${
          variant === 'sheet'
            ? 'max-h-[85vh] rounded-t-xl border-b-0 pb-[env(safe-area-inset-bottom)]'
            : 'rounded-modal max-h-[76vh] max-w-170'
        }`}
      >
        <h2 id={titleId} className="sr-only">
          {t('shell.launcher.title')}
        </h2>
        <div className="border-ink-800 flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
          <Search aria-hidden className={`${ICON_MD} text-muted`} size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            aria-label={t('shell.launcher.searchLabel')}
            placeholder={t('shell.launcher.placeholder')}
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-muted text-ink-200 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        {header && (
          <div className="border-ink-800 flex shrink-0 items-center justify-center border-b px-4 py-3">
            {header}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.length === 0 && !hasDestinations ? (
            <p className="text-muted px-2 py-6 text-center text-sm">
              {t('shell.launcher.noResults')}
            </p>
          ) : groups.length === 0 ? null : (
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
                        const rowIndex = panelRowIndex.get(entry.panelIndex) ?? -1;
                        const isActive = rowIndex === active;
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
                              onFocus={() => {
                                setActiveIndex(rowIndex);
                              }}
                              onKeyDown={(e) => {
                                handleEntryKeyDown(e, entry);
                              }}
                              className={launcherRowClass(isActive, false)}
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
                              {query.trim() !== '' && isActive && <Kbd>Enter</Kbd>}
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
                                isPinned ? 'text-bright-green' : 'text-muted hover:text-ink-200'
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
          {channelMatches.matches.length > 0 &&
            onOpenChannel &&
            renderDestinationGroup(
              'channels',
              t('shell.launcher.channelsGroup'),
              channelMatches.more,
              channelMatches.matches.map((channel) => {
                const rowIndex = channelRowIndex.get(channel.index) ?? -1;
                return (
                  <li key={`ch-${String(channel.index)}`}>
                    <button
                      type="button"
                      data-launcher-entry=""
                      onClick={() => {
                        onOpenChannel(channel.index);
                      }}
                      onFocus={() => {
                        setActiveIndex(rowIndex);
                      }}
                      onKeyDown={handleRowNavKeyDown}
                      className={launcherRowClass(rowIndex === active, true)}
                    >
                      <Hash aria-hidden className={`${ICON_MD} text-muted shrink-0`} size={16} />
                      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    </button>
                  </li>
                );
              }),
            )}
          {contactMatches.matches.length > 0 &&
            onOpenContact &&
            renderDestinationGroup(
              'contacts',
              contactsLabel ?? t('shell.launcher.contactsGroup'),
              contactMatches.more,
              contactMatches.matches.map((contact) => {
                const rowIndex = contactRowIndex.get(contact.id) ?? -1;
                return (
                  <li key={`c-${contact.id}`}>
                    <button
                      type="button"
                      data-launcher-entry=""
                      onClick={() => {
                        onOpenContact(contact.id);
                      }}
                      onFocus={() => {
                        setActiveIndex(rowIndex);
                      }}
                      onKeyDown={handleRowNavKeyDown}
                      className={launcherRowClass(rowIndex === active, true)}
                    >
                      <User aria-hidden className={`${ICON_MD} text-muted shrink-0`} size={16} />
                      <span className="min-w-0 flex-1 truncate">{contact.name}</span>
                      {contact.detail && (
                        <span className="text-muted text-meta shrink-0 font-mono">
                          {contact.detail}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }),
            )}
          {settingMatches.matches.length > 0 &&
            onOpenSetting &&
            renderDestinationGroup(
              'settings',
              t('shell.launcher.settingsGroup'),
              settingMatches.more,
              settingMatches.matches.map((item) => {
                const rowIndex = settingRowIndex.get(item.id) ?? -1;
                return (
                  <li key={`s-${item.id}`}>
                    <button
                      type="button"
                      data-launcher-entry=""
                      aria-label={
                        item.detail
                          ? t('shell.launcher.settingRowAria', {
                              label: item.label,
                              section: item.detail,
                            })
                          : item.label
                      }
                      onClick={() => {
                        onOpenSetting(item);
                      }}
                      onFocus={() => {
                        setActiveIndex(rowIndex);
                      }}
                      onKeyDown={handleRowNavKeyDown}
                      className={launcherRowClass(rowIndex === active, true)}
                    >
                      <SlidersHorizontal
                        aria-hidden
                        className={`${ICON_MD} text-muted shrink-0`}
                        size={16}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.detail && (
                        <span className="text-muted text-meta max-w-[45%] shrink-0 truncate">
                          {item.detail}
                        </span>
                      )}
                    </button>
                  </li>
                );
              }),
            )}
        </div>

        <div className="text-muted border-ink-800 flex h-10 shrink-0 items-center gap-4 border-t px-4 text-xs">
          <span className="flex items-center gap-1.5 pointer-coarse:hidden">
            <Kbd>{'↑↓'}</Kbd>
            {t('shell.launcher.hintMove')}
          </span>
          <span className="flex items-center gap-1.5 pointer-coarse:hidden">
            <Kbd>Enter</Kbd>
            {t('shell.launcher.hintOpen')}
          </span>
          <span className="flex items-center gap-1.5 pointer-coarse:hidden">
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
