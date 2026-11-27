import type { KeyboardEvent } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { readStoredStaticGps, resolveOurPosition } from '@/renderer/lib/gpsSource';
import {
  filterMeshcoreIataAirports,
  findNearestMeshcoreIata,
  formatMeshcoreIataAirportLabel,
  loadMeshcoreIataAirports,
  MESHCORE_IATA_TEST_CODE,
  type MeshcoreIataAirport,
  meshcoreTopicPrefixFromIataSegment,
} from '@/renderer/lib/meshcoreMqttIataCatalog';
import { parseMeshcoreIataTopicPrefix } from '@/renderer/lib/meshcoreMqttTopicPrefix';
import { Z_POPOVER_MENU } from '@/renderer/lib/modalZIndex';
import { readRadioSelfPosition } from '@/renderer/lib/radioSelfPosition';

import { INPUT_CLASS, SELECT_CLASS } from './ui/formClasses';

const POPOVER_WIDTH = 360;
const VIEWPORT_MARGIN = 8;
/** Cap filtered rows so the list stays responsive with ~10k airports. */
const FILTERED_LIST_CAP = 200;
const POPOVER_MAX_H_PX = 420;

export interface MeshcoreMqttIataSelectProps {
  id: string;
  labelledById?: string;
  topicPrefix: string;
  onSelectTopicPrefix: (topicPrefix: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

type ListEntry =
  { kind: 'test' } | { kind: 'airport'; airport: MeshcoreIataAirport; nearest: boolean };

function segmentFromTopicPrefix(topicPrefix: string): string | null {
  const parsed = parseMeshcoreIataTopicPrefix(topicPrefix);
  return parsed.ok ? parsed.segment : null;
}

/**
 * Searchable IATA picklist for MeshCore MQTT topic prefixes (`meshcore/{IATA}`).
 * When GPS is available, opens scrolled to the nearest airport (highlight only — no auto-commit).
 */
export function MeshcoreMqttIataSelect({
  id,
  labelledById,
  topicPrefix,
  onSelectTopicPrefix,
  disabled,
  invalid,
}: MeshcoreMqttIataSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [airports, setAirports] = useState<MeshcoreIataAirport[]>([]);
  const [nearestCode, setNearestCode] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nearestRowRef = useRef<HTMLButtonElement>(null);
  const highlightRowRef = useRef<HTMLButtonElement>(null);
  const [focusAfterClose, setFocusAfterClose] = useState(false);
  const listId = useId();
  const optionIdPrefix = useId();

  const selectedSegment = segmentFromTopicPrefix(topicPrefix);
  const selectedAirport =
    selectedSegment && selectedSegment !== MESHCORE_IATA_TEST_CODE
      ? (airports.find((a) => a.code === selectedSegment) ?? null)
      : null;

  const triggerLabel = (() => {
    if (selectedSegment === MESHCORE_IATA_TEST_CODE) {
      return t('connectionPanel.iataPicklist.testOption');
    }
    if (selectedAirport) return formatMeshcoreIataAirportLabel(selectedAirport);
    if (selectedSegment) return selectedSegment;
    return t('connectionPanel.iataPicklist.placeholder');
  })();

  const entries: ListEntry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nearest =
      nearestCode != null ? (airports.find((a) => a.code === nearestCode) ?? null) : null;
    let filtered = filterMeshcoreIataAirports(airports, query);
    const pins: MeshcoreIataAirport[] = [];
    if (!q && nearest) pins.push(nearest);
    if (
      selectedAirport &&
      filtered.some((a) => a.code === selectedAirport.code) &&
      !pins.some((a) => a.code === selectedAirport.code)
    ) {
      pins.push(selectedAirport);
    }
    if (pins.length > 0) {
      const pinCodes = new Set(pins.map((a) => a.code));
      filtered = [...pins, ...filtered.filter((a) => !pinCodes.has(a.code))];
    }
    filtered = filtered.slice(0, FILTERED_LIST_CAP);
    const airportEntries: ListEntry[] = filtered.map((airport) => ({
      kind: 'airport' as const,
      airport,
      nearest: nearestCode != null && airport.code === nearestCode,
    }));
    // Prefix only (`t`, `te`, `test`), not any substring of "test".
    const showTest = !q || MESHCORE_IATA_TEST_CODE.startsWith(q);
    if (!showTest) return airportEntries;
    const testEntry: ListEntry = { kind: 'test' };
    // When airports match, Enter stays on an airport (highlight 0), not meshcore/test.
    if (q && airportEntries.length > 0) return [...airportEntries, testEntry];
    return [testEntry, ...airportEntries];
  }, [airports, query, nearestCode, selectedAirport]);

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
    setNearestCode(null);
    setPosition(null);
    if (restoreFocus) setFocusAfterClose(true);
  };

  useEffect(() => {
    let cancelled = false;
    void loadMeshcoreIataAirports()
      .then((list) => {
        if (!cancelled) setAirports(list);
      })
      .catch((e: unknown) => {
        console.debug('[MeshcoreMqttIataSelect] catalog load failed ' + errLikeToLogString(e));
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (open || !focusAfterClose) return;
    const frame = requestAnimationFrame(() => {
      triggerRef.current?.focus();
      setFocusAfterClose(false);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, focusAfterClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = popoverRef.current?.offsetWidth || POPOVER_WIDTH;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const idealMax = Math.min(POPOVER_MAX_H_PX, window.innerHeight * 0.7);
    const placeBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(
      120,
      Math.min(idealMax, placeBelow ? spaceBelow - 4 : spaceAbove - 4),
    );
    const top = placeBelow ? rect.bottom + 4 : Math.max(VIEWPORT_MARGIN, rect.top - 4 - maxHeight);
    queueMicrotask(() => {
      setPosition({ top, left, maxHeight });
    });
  }, [open]);

  // Focus after the positioned portal mounts (input exists only when position is set).
  useLayoutEffect(() => {
    if (!open || !position) return;
    inputRef.current?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open || airports.length === 0) return;
    const ac = new AbortController();
    void (async () => {
      const device = readRadioSelfPosition('meshcore');
      const staticGps = readStoredStaticGps();
      const pos = await resolveOurPosition(
        device?.lat,
        device?.lon,
        staticGps?.lat,
        staticGps?.lon,
        device?.altitudeMeters,
      );
      if (ac.signal.aborted || !pos) return;
      const nearest = findNearestMeshcoreIata(airports, pos.lat, pos.lon);
      if (!nearest || ac.signal.aborted) return;
      // Highlight-only — never auto-commit the nearest airport.
      setNearestCode(nearest.code);
    })();
    return () => {
      ac.abort();
    };
  }, [open, airports]);

  // Map nearest → highlight index only for rows currently shown (blank search).
  useEffect(() => {
    if (!open || !nearestCode || query.trim()) return;
    const idx = entries.findIndex((e) => e.kind === 'airport' && e.airport.code === nearestCode);
    if (idx < 0) return;
    queueMicrotask(() => {
      setHighlight(idx);
    });
  }, [open, nearestCode, entries, query]);

  useLayoutEffect(() => {
    if (!open) return;
    highlightRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, entries]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu(true);
      }
    };
    const onDismiss = () => {
      closeMenu(false);
    };
    // Scroll inside the list must not close it; scroll elsewhere moves the anchor.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      onDismiss();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, entries.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const entry = entries[highlight];
      if (!entry) return;
      const segment = entry.kind === 'test' ? MESHCORE_IATA_TEST_CODE : entry.airport.code;
      onSelectTopicPrefix(meshcoreTopicPrefixFromIataSegment(segment));
      closeMenu(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    }
  };

  const activeOptionId = entries[highlight] != null ? `${optionIdPrefix}-${highlight}` : undefined;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-labelledby={labelledById}
        aria-label={labelledById ? undefined : t('connectionPanel.iataPicklist.aria')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-describedby={invalid ? `${id}-invalid` : undefined}
        disabled={disabled}
        data-invalid={invalid ? 'true' : undefined}
        onClick={() => {
          if (open) {
            closeMenu(false);
            return;
          }
          setOpen(true);
        }}
        className={`${SELECT_CLASS} flex items-center justify-between gap-2 text-left ${
          invalid ? 'border-red-500' : ''
        }`}
      >
        <span className={`min-w-0 truncate ${selectedSegment ? '' : 'text-muted'}`}>
          {triggerLabel}
        </span>
        <span className="text-muted shrink-0 text-xs" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            className="bg-deep-black rounded-modal shadow-level-3 border-ink-800 fixed flex flex-col overflow-hidden border"
            style={{
              zIndex: Z_POPOVER_MENU,
              width: `${POPOVER_WIDTH / 16}rem`,
              maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
              maxHeight: position.maxHeight,
              top: position.top,
              left: position.left,
            }}
          >
            <div className="border-ink-800 border-b p-2">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeOptionId}
                aria-label={t('connectionPanel.iataPicklist.searchAria')}
                placeholder={t('connectionPanel.iataPicklist.searchPlaceholder')}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={handleKeyDown}
                className={INPUT_CLASS}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={t('connectionPanel.iataPicklist.listAria')}
              className="min-h-0 flex-1 overflow-y-auto p-1"
            >
              {loadError ? (
                <p className="text-muted px-2.5 py-3 text-center text-xs">
                  {t('connectionPanel.iataPicklist.loadFailed')}
                </p>
              ) : entries.length === 0 ? (
                <p className="text-muted px-2.5 py-3 text-center text-xs">
                  {t('connectionPanel.iataPicklist.empty')}
                </p>
              ) : (
                entries.map((entry, index) => {
                  const highlighted = index === highlight;
                  const isNearest = entry.kind === 'airport' && entry.nearest;
                  const selected =
                    entry.kind === 'test'
                      ? selectedSegment === MESHCORE_IATA_TEST_CODE
                      : selectedSegment === entry.airport.code;
                  const label =
                    entry.kind === 'test'
                      ? t('connectionPanel.iataPicklist.testOption')
                      : formatMeshcoreIataAirportLabel(entry.airport);
                  const optionLabel =
                    isNearest && !selected
                      ? t('connectionPanel.iataPicklist.nearestOption', { label })
                      : label;
                  const segment =
                    entry.kind === 'test' ? MESHCORE_IATA_TEST_CODE : entry.airport.code;
                  return (
                    <button
                      key={segment}
                      ref={highlighted ? highlightRowRef : isNearest ? nearestRowRef : undefined}
                      type="button"
                      id={`${optionIdPrefix}-${index}`}
                      role="option"
                      aria-selected={selected}
                      onPointerMove={() => {
                        if (index !== highlight) setHighlight(index);
                      }}
                      onClick={() => {
                        onSelectTopicPrefix(meshcoreTopicPrefixFromIataSegment(segment));
                        closeMenu(true);
                      }}
                      className={`text-body flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-left ${
                        highlighted ? 'bg-sidebar-active-bg text-ink-100' : 'text-ink-300'
                      }`}
                    >
                      <span
                        className={`min-w-0 flex-1 truncate ${selected ? 'text-bright-green font-medium' : ''}`}
                      >
                        {optionLabel}
                      </span>
                      {isNearest ? (
                        <span className="text-muted text-2xs shrink-0 uppercase">
                          {t('connectionPanel.iataPicklist.nearestBadge')}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
