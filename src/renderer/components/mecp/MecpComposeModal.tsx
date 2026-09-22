import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

const SEVERITY_ORDER: Severity[] = [0, 1, 2, 3];

interface MecpComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (mecpString: string) => void | Promise<void>;
}

export function MecpComposeModal({ open, onClose, onSend }: MecpComposeModalProps) {
  const { t, i18n } = useTranslation();
  const [severity, setSeverity] = useState<Severity>(0);
  const [category, setCategory] = useState<CategoryLetter>('M');
  const [codes, setCodes] = useState<string[]>([]);
  const [freetext, setFreetext] = useState('');
  const [drill, setDrill] = useState(false);
  const [langFile, setLangFile] = useState(() =>
    getCachedMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en')),
  );
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void loadMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en')).then(setLangFile);
  }, [i18n.language]);

  const codesForCategory = useMemo(() => {
    return Object.keys(langFile.codes)
      .filter((c) => c.startsWith(category))
      .sort();
  }, [langFile.codes, category]);

  const effectiveCodes = useMemo(() => {
    const list = [...codes];
    if (drill && !list.includes('D01')) list.unshift('D01');
    return list;
  }, [codes, drill]);

  const encoded = useMemo(
    () => encode(severity, effectiveCodes, freetext.trim() || undefined),
    [severity, effectiveCodes, freetext],
  );

  const byteLen = encoded.byteLength || getByteLength(encoded.message);
  const canSend = effectiveCodes.length > 0 && !encoded.overLimit && !sending;

  const toggleCode = useCallback((code: string) => {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }, []);

  const attachGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gps = `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        setFreetext((prev) => (prev.trim() ? `${prev.trim()} ${gps}` : gps));
      },
      (err) => {
        console.warn('[MecpComposeModal] GPS failed', err.message);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(encoded.message);
      onClose();
      setCodes([]);
      setFreetext('');
      setDrill(false);
    } finally {
      setSending(false);
    }
  }, [canSend, encoded.message, onClose, onSend]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('mecp.compose.title')}
    >
      <div className="bg-deep-black max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-red-700/50 p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-red-200">{t('mecp.compose.title')}</h2>
          <button
            type="button"
            className="text-sm text-gray-400 hover:text-white"
            onClick={onClose}
            aria-label={t('aria.closeDialog')}
          >
            {t('common.close')}
          </button>
        </div>

        <p className="mb-2 text-xs text-gray-400">{t('mecp.compose.severity')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={t(severityLabelKey(s))}
              aria-pressed={severity === s}
              onClick={() => {
                setSeverity(s);
              }}
              className={`rounded px-2 py-1 text-xs font-semibold ${
                severity === s
                  ? s === 0
                    ? 'bg-red-700 text-white'
                    : s === 1
                      ? 'bg-orange-700 text-white'
                      : s === 2
                        ? 'bg-amber-700 text-white'
                        : 'bg-slate-600 text-white'
                  : 'bg-slate-800 text-gray-300'
              }`}
            >
              {t(severityLabelKey(s))}
            </button>
          ))}
        </div>

        <p className="mb-2 text-xs text-gray-400">{t('mecp.compose.category')}</p>
        <div className="mb-3 grid grid-cols-3 gap-1 sm:grid-cols-4">
          {(Object.keys(CATEGORIES) as CategoryLetter[]).map((letter) => (
            <button
              key={letter}
              type="button"
              aria-pressed={category === letter}
              aria-label={langFile.categories[letter]?.name ?? letter}
              onClick={() => {
                setCategory(letter);
              }}
              className={`rounded px-1 py-1 text-[10px] ${
                category === letter ? 'bg-red-900/80 text-red-100' : 'bg-slate-800 text-gray-300'
              }`}
            >
              {letter} {langFile.categories[letter]?.name ?? ''}
            </button>
          ))}
        </div>

        <p className="mb-2 text-xs text-gray-400">{t('mecp.compose.codes')}</p>
        <div className="mb-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
          {codesForCategory.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={codes.includes(code)}
              onClick={() => {
                toggleCode(code);
              }}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                codes.includes(code) ? 'bg-red-700 text-white' : 'bg-slate-800 text-gray-300'
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
                className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] text-red-100"
              >
                {code} ×
              </button>
            ))}
          </div>
        ) : null}

        <label className="mb-1 block text-xs text-gray-400" htmlFor="mecp-freetext">
          {t('mecp.compose.freetext')}
        </label>
        <textarea
          id="mecp-freetext"
          value={freetext}
          onChange={(e) => {
            setFreetext(e.target.value);
          }}
          rows={2}
          className="mb-2 w-full rounded border border-gray-700 bg-slate-900 px-2 py-1 text-sm text-gray-100"
          aria-label={t('mecp.compose.freetext')}
        />
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300"
            onClick={() => {
              setFreetext((p) => (p.trim() ? `${p.trim()} 1pax` : '1pax'));
            }}
            aria-label={t('mecp.compose.addPax')}
          >
            {t('mecp.compose.addPax')}
          </button>
          <button
            type="button"
            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300"
            onClick={() => {
              attachGps();
            }}
            aria-label={t('mecp.compose.attachGps')}
          >
            {t('mecp.compose.attachGps')}
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={drill}
              onChange={(e) => {
                setDrill(e.target.checked);
              }}
              aria-label={t('mecp.compose.drill')}
            />
            {t('mecp.compose.drill')}
          </label>
        </div>

        <p className="mb-1 font-mono text-xs break-all text-gray-300">{encoded.message || '—'}</p>
        <p
          className={`mb-3 text-xs ${encoded.overLimit ? 'text-red-400' : 'text-gray-500'}`}
          role="status"
        >
          {t('mecp.compose.byteBudget', { used: byteLen, max: MAX_MESSAGE_BYTES })}
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm text-gray-300"
            onClick={onClose}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSend}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
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
