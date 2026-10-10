import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mecpCodeInComposeMode, type MecpComposeMode } from '@/renderer/lib/mecp/mecpComposeRoles';
import {
  CATEGORIES,
  type CategoryLetter,
  encode,
  getByteLength,
  getCachedMecpLanguage,
  loadMecpLanguage,
  MAX_MESSAGE_BYTES,
  mecpLanguageForAppLocale,
  type Severity,
  severityLabelKey,
} from '@/renderer/lib/mecp/mecpMessages';

import { TEXTAREA_BOX_CLASS } from '../ui/formClasses';
import { MECP_SEVERITY_BADGE_CLASSES } from './MecpSeverityBadge';

const SEVERITY_ORDER: Severity[] = [0, 1, 2, 3];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Increment an existing `Npax` token, or append `1pax`. */
export function bumpMecpPaxFreetext(prev: string): string {
  if (/(\d+)pax/.test(prev)) {
    return prev.replace(/(\d+)pax/, (_, n: string) => `${Number(n) + 1}pax`);
  }
  const trimmed = prev.trim();
  return trimmed ? `${trimmed} 1pax` : '1pax';
}

interface MecpComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (mecpString: string) => void | Promise<void>;
  /** App GPS waterfall (device → static → browser → IP). Prefer over raw geolocation. */
  resolveGps?: () => Promise<{ lat: number; lon: number } | null>;
  mode?: MecpComposeMode;
}

const DEFAULT_MECP_SEVERITY: Severity = 3;
const DEFAULT_MECP_CATEGORY: CategoryLetter = 'D';
const DEFAULT_MECP_CODES: string[] = [];

export function MecpComposeModal({
  open,
  onClose,
  onSend,
  resolveGps,
  mode = 'all',
}: MecpComposeModalProps) {
  const { t, i18n } = useTranslation();
  const [severity, setSeverity] = useState<Severity>(DEFAULT_MECP_SEVERITY);
  const initialCategory = mode === 'response' ? 'R' : DEFAULT_MECP_CATEGORY;
  const [category, setCategory] = useState<CategoryLetter>(initialCategory);
  const [showAllCodes, setShowAllCodes] = useState(mode === 'all');
  const [codes, setCodes] = useState<string[]>(() => [...DEFAULT_MECP_CODES]);
  const [freetext, setFreetext] = useState('');
  const [langFile, setLangFile] = useState(() =>
    getCachedMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en')),
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    void loadMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en')).then(setLangFile);
  }, [i18n.language]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
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

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  const codesForCategory = useMemo(() => {
    return Object.keys(langFile.codes)
      .filter(
        (c) => c.startsWith(category) && mecpCodeInComposeMode(c, showAllCodes ? 'all' : mode),
      )
      .sort();
  }, [langFile.codes, category, showAllCodes, mode]);
  const categories = (Object.keys(CATEGORIES) as CategoryLetter[]).filter((letter) =>
    Object.keys(langFile.codes).some(
      (code) => code.startsWith(letter) && mecpCodeInComposeMode(code, showAllCodes ? 'all' : mode),
    ),
  );
  const title =
    mode === 'response'
      ? t('mecp.compose.responseTitle')
      : mode === 'request'
        ? t('mecp.compose.requestTitle')
        : t('mecp.compose.title');
  const responseMode = mode === 'response';

  const encoded = useMemo(
    () => encode(severity, codes, freetext.trim() || undefined),
    [severity, codes, freetext],
  );

  const byteLen = encoded.byteLength || getByteLength(encoded.message);
  const canSend = codes.length > 0 && !encoded.overLimit && !sending;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const toggleCode = useCallback(
    (code: string) => {
      clearError();
      setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
    },
    [clearError],
  );

  const attachGps = useCallback(async () => {
    clearError();
    try {
      let pos: { lat: number; lon: number } | null = null;
      if (resolveGps) {
        pos = await resolveGps();
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        pos = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => {
              resolve({ lat: p.coords.latitude, lon: p.coords.longitude });
            },
            () => {
              resolve(null);
            },
            { enableHighAccuracy: true, timeout: 10_000 },
          );
        });
      }
      if (!pos) {
        setError(t('mecp.compose.gpsFailed'));
        return;
      }
      const gps = `${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}`;
      setFreetext((prev) => (prev.trim() ? `${prev.trim()} ${gps}` : gps));
    } catch (e) {
      console.warn('[MecpComposeModal] GPS failed', e instanceof Error ? e.message : e);
      setError(t('mecp.compose.gpsFailed'));
    }
  }, [clearError, resolveGps, t]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    clearError();
    setSending(true);
    try {
      await onSend(encoded.message);
      onClose();
      setCodes([...DEFAULT_MECP_CODES]);
      setCategory(initialCategory);
      setFreetext('');
      setSeverity(DEFAULT_MECP_SEVERITY);
    } catch (e) {
      console.warn('[MecpComposeModal] send failed', e instanceof Error ? e.message : e);
      const msg = e instanceof Error && e.message.trim() ? e.message : t('mecp.compose.sendFailed');
      setError(msg);
    } finally {
      setSending(false);
    }
  }, [canSend, clearError, encoded.message, initialCategory, onClose, onSend, t]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`bg-deep-black rounded-modal shadow-level-4 relative max-h-[90vh] w-full max-w-lg overflow-y-auto border p-4 ${responseMode ? 'border-blue-700/50' : 'border-red-700/50'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2
            className={`text-lg font-semibold ${responseMode ? 'text-blue-200' : 'text-red-200'}`}
          >
            {title}
          </h2>
          <button
            type="button"
            className="text-ink-400 text-sm hover:text-white"
            onClick={onClose}
            aria-label={t('aria.closeDialog')}
          >
            {t('common.close')}
          </button>
        </div>

        <p className="text-ink-400 mb-2 text-xs">{t('mecp.compose.severity')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={t(severityLabelKey(s))}
              aria-pressed={severity === s}
              onClick={() => {
                clearError();
                setSeverity(s);
              }}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                severity === s ? MECP_SEVERITY_BADGE_CLASSES[s] : 'bg-ink-800 text-ink-300'
              }`}
            >
              {t(severityLabelKey(s))}
            </button>
          ))}
        </div>

        {mode !== 'all' && (
          <label className="text-ink-300 mb-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showAllCodes}
              aria-label={t('mecp.compose.showAllCodes')}
              onChange={(event) => {
                setShowAllCodes(event.target.checked);
                setCategory(initialCategory);
              }}
            />
            {t('mecp.compose.showAllCodes')}
          </label>
        )}
        <p className="text-ink-400 mb-2 text-xs">{t('mecp.compose.category')}</p>
        <div className="mb-3 grid grid-cols-3 gap-1 sm:grid-cols-4">
          {categories.map((letter) => (
            <button
              key={letter}
              type="button"
              aria-pressed={category === letter}
              aria-label={langFile.categories[letter]?.name ?? letter}
              onClick={() => {
                clearError();
                setCategory(letter);
              }}
              className={`text-2xs rounded px-1 py-1 ${
                category === letter
                  ? responseMode
                    ? 'bg-blue-900/80 text-blue-100'
                    : 'bg-red-900/80 text-red-100'
                  : 'bg-ink-800 text-ink-300'
              }`}
            >
              {letter} {langFile.categories[letter]?.name ?? ''}
            </button>
          ))}
        </div>

        <p className="text-ink-400 mb-2 text-xs">{t('mecp.compose.codes')}</p>
        <div className="mb-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
          {codesForCategory.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={codes.includes(code)}
              onClick={() => {
                toggleCode(code);
              }}
              className={`text-2xs rounded px-1.5 py-0.5 ${
                codes.includes(code)
                  ? responseMode
                    ? 'bg-blue-700 text-white'
                    : 'bg-red-700 text-white'
                  : 'bg-ink-800 text-ink-300'
              }`}
            >
              {code} {langFile.codes[code]}
            </button>
          ))}
        </div>
        {codes.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {codes.map((code) => (
              <button
                key={`chip-${code}`}
                type="button"
                aria-label={t('mecp.compose.removeCode', { code })}
                onClick={() => {
                  toggleCode(code);
                }}
                className={`text-2xs rounded-full px-2 py-0.5 ${responseMode ? 'bg-blue-900/60 text-blue-100' : 'bg-red-900/60 text-red-100'}`}
              >
                {code} ×
              </button>
            ))}
          </div>
        ) : null}

        <label className="text-ink-400 mb-1 block text-xs" htmlFor="mecp-freetext">
          {t('mecp.compose.freetext')}
        </label>
        <textarea
          id="mecp-freetext"
          value={freetext}
          onChange={(e) => {
            clearError();
            setFreetext(e.target.value);
          }}
          rows={2}
          className={`${TEXTAREA_BOX_CLASS} mb-2 w-full`}
          aria-label={t('mecp.compose.freetext')}
        />
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="border-ink-600 text-ink-300 rounded border px-2 py-0.5 text-xs"
            onClick={() => {
              clearError();
              setFreetext(bumpMecpPaxFreetext);
            }}
            aria-label={t('mecp.compose.addPax')}
          >
            {t('mecp.compose.addPax')}
          </button>
          <button
            type="button"
            className="border-ink-600 text-ink-300 rounded border px-2 py-0.5 text-xs"
            onClick={() => {
              void attachGps();
            }}
            aria-label={t('mecp.compose.attachGps')}
          >
            {t('mecp.compose.attachGps')}
          </button>
        </div>

        <p className="text-ink-300 mb-1 font-mono text-xs break-all">{encoded.message || '—'}</p>
        <p
          className={`mb-3 text-xs ${encoded.overLimit ? 'text-red-400' : 'text-muted'}`}
          role="status"
        >
          {t('mecp.compose.byteBudget', { used: byteLen, max: MAX_MESSAGE_BYTES })}
        </p>

        {error ? (
          <p className="mb-3 text-xs text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="text-ink-300 rounded px-3 py-1.5 text-sm"
            onClick={onClose}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSend}
            className={`rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 ${responseMode ? 'bg-blue-700' : 'bg-red-700'}`}
            onClick={() => void handleSend()}
            aria-label={t('mecp.compose.send')}
          >
            {t('mecp.compose.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
