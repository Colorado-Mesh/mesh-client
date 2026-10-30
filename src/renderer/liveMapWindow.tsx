/// <reference types="vite/client" />
import './styles.css';

import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import ErrorBoundary from './components/ErrorBoundary';
import { LiveMapWindow } from './components/map/LiveMapWindow';
import { getAppSettingsRaw } from './lib/appSettingsStorage';
import { installDevElectronApiStubIfNeeded } from './lib/devElectronApiStub';
import { applyFontScale, loadFontScale } from './lib/fontScale';
import i18n from './lib/i18n';
import { IconMotionProvider } from './lib/icons/iconMotionContext';
import { ensureLocaleLoaded } from './lib/localeResources';
import { parseStoredJson } from './lib/parseStoredJson';
import { syncReduceMotionDatasetFromStorage } from './lib/reduceMotionPreference';
import { installRendererUnhandledRejectionLogger } from './lib/rendererUnhandledRejection';
import { applyThemeColors, loadThemeColors } from './lib/themeColors';

/** Entry for live-map.html, the live traffic pop-out window. */
async function start(): Promise<void> {
  installRendererUnhandledRejectionLogger();
  installDevElectronApiStubIfNeeded();
  // Read the main window's appearance and language; this window never writes preferences.
  applyThemeColors(loadThemeColors());
  applyFontScale(loadFontScale());
  syncReduceMotionDatasetFromStorage();
  const locale = parseStoredJson<{ locale?: unknown }>(
    getAppSettingsRaw(),
    'restored locale',
  )?.locale;
  const language = typeof locale === 'string' ? locale : i18n.language;
  await ensureLocaleLoaded(i18n, language);
  if (language !== i18n.language) await i18n.changeLanguage(language);
  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <IconMotionProvider>
          <LiveMapWindow />
        </IconMotionProvider>
      </ErrorBoundary>
    </I18nextProvider>,
  );
}

start().catch((cause: unknown) => {
  console.error(
    '[live-map] window boot failed:',
    cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
  );
});
