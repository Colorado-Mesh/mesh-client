import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mergeAppSetting } from '../lib/appSettingsStorage';
import i18n from '../lib/i18n';
import { ensureLocaleLoaded } from '../lib/localeResources';
import { SUPPORTED_LANGUAGES } from '../locales/languages';

export default function LanguageSelector() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reconcile DB locale with current i18n locale on mount
  useEffect(() => {
    void window.electronAPI.appSettings.getAll().then(async (settings) => {
      const dbLocale = settings.locale;
      if (dbLocale && dbLocale !== i18n.language) {
        const ok = await ensureLocaleLoaded(i18n, dbLocale);
        if (ok) await i18n.changeLanguage(dbLocale);
      }
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen]);

  const handleSelect = (code: string) => {
    void (async () => {
      const ok = await ensureLocaleLoaded(i18n, code);
      if (!ok) {
        setIsOpen(false);
        return;
      }
      await i18n.changeLanguage(code);
      mergeAppSetting('locale', code, 'LanguageSelector');
      void window.electronAPI.appSettings.set('locale', code);
      setIsOpen(false);
    })();
  };

  const currentLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.label ??
    SUPPORTED_LANGUAGES.find((l) => l.code === 'en')!.label;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={t('aria.languageSelector')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => {
          setIsOpen((o) => !o);
        }}
        className={`flex items-center gap-1 rounded-lg p-1.5 text-xs transition-all ${
          isOpen
            ? 'bg-secondary-dark text-gray-100 ring-1 ring-cyan-400/50'
            : 'text-muted hover:bg-secondary-dark hover:text-gray-200'
        }`}
        title={currentLabel}
      >
        <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9.5" className="fill-cyan-500/15" />
          <circle cx="12" cy="12" r="10" className="stroke-cyan-300" strokeWidth={1.5} />
          <path
            className="stroke-emerald-300"
            strokeWidth={1.5}
            d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20"
          />
          <path className="stroke-violet-300" strokeWidth={1.5} d="M2 7h20M2 17h20" />
          <circle cx="18" cy="6" r="1.5" className="fill-amber-300/90" />
        </svg>
      </button>

      {isOpen && (
        <ul
          role="listbox"
          aria-label={t('aria.languageSelector')}
          className="bg-deep-black absolute top-full right-0 z-50 mt-1 max-h-72 w-44 overflow-y-auto rounded-lg border border-gray-700 py-1 shadow-xl"
        >
          {SUPPORTED_LANGUAGES.map(({ code, label }) => (
            <li key={code} role="option" aria-selected={i18n.language === code}>
              <button
                type="button"
                onClick={() => {
                  handleSelect(code);
                }}
                className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                  i18n.language === code
                    ? 'text-brand-green bg-gray-800'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
