import { Globe, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import { mergeAppSetting } from '../lib/appSettingsStorage';
import i18n from '../lib/i18n';
import { ensureLocaleLoaded } from '../lib/localeResources';
import { SUPPORTED_LANGUAGES } from '../locales/languages';

interface MenuPosition {
  top: number;
  right: number;
}

function computeMenuPosition(button: HTMLButtonElement): MenuPosition {
  const rect = button.getBoundingClientRect();
  return {
    top: rect.bottom + 4,
    right: window.innerWidth - rect.right,
  };
}

export default function LanguageSelector() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const parentTrigger = useParentIconTrigger();

  const closeMenu = () => {
    setIsOpen(false);
    setMenuPos(null);
  };

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

  // Close dropdown on outside click (button + portaled menu)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen]);

  // Close on scroll/resize so fixed menu does not drift from the trigger
  useEffect(() => {
    if (!isOpen) return;
    const handleDismiss = () => {
      closeMenu();
    };
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [isOpen]);

  const handleSelect = (code: string) => {
    void (async () => {
      const ok = await ensureLocaleLoaded(i18n, code);
      if (!ok) {
        closeMenu();
        return;
      }
      await i18n.changeLanguage(code);
      mergeAppSetting('locale', code, 'LanguageSelector');
      void window.electronAPI.appSettings.set('locale', code);
      closeMenu();
    })();
  };

  const currentLabel =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)?.label ??
    SUPPORTED_LANGUAGES.find((l) => l.code === 'en')!.label;

  const menu =
    isOpen && menuPos
      ? createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label={t('aria.languageSelector')}
            style={{
              position: 'fixed',
              top: menuPos.top,
              right: menuPos.right,
            }}
            className="bg-deep-black z-50 max-h-72 w-44 overflow-y-auto rounded-lg border border-gray-700 py-1 shadow-xl"
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
          </ul>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('aria.languageSelector')}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        {...{ [PARENT_HOVER_ATTR]: '' }}
        onClick={() => {
          if (isOpen) {
            closeMenu();
            return;
          }
          if (buttonRef.current) {
            setMenuPos(computeMenuPosition(buttonRef.current));
          }
          setIsOpen(true);
        }}
        className={`flex items-center gap-1 rounded-lg p-1.5 text-xs transition-all ${
          isOpen
            ? 'bg-secondary-dark text-gray-100 ring-1 ring-cyan-400/50'
            : 'text-muted hover:bg-secondary-dark hover:text-gray-200'
        }`}
        title={currentLabel}
      >
        <Globe
          aria-hidden
          className={`${ICON_MD} text-cyan-300`}
          trigger={parentTrigger}
          size={16}
        />
      </button>
      {menu}
    </div>
  );
}
