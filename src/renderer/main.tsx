/// <reference types="vite/client" />
import './styles.css';

import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import ErrorBoundary from './components/ErrorBoundary';
import { SecureSecretsStartup } from './components/SecureSecretsStartup';
import { getAppSettingsRaw } from './lib/appSettingsStorage';
import { installBundledEmojiData } from './lib/bundledEmojiData';
import { installDevElectronApiStubIfNeeded } from './lib/devElectronApiStub';
import { hydrateDurableRendererSettings } from './lib/hydrateDurableRendererSettings';
import i18n from './lib/i18n';
import { IconMotionProvider } from './lib/icons/iconMotionContext';
import { installKeyboardOwnerGuard } from './lib/keyboardOwnerLayer';
import { ensureLocaleLoaded } from './lib/localeResources';
import { parseStoredJson } from './lib/parseStoredJson';
import {
  initReduceMotionDefaultIfAbsent,
  syncReduceMotionDatasetFromStorage,
} from './lib/reduceMotionPreference';
import {
  finalizeRendererPreferences,
  installRendererPreferencePersistence,
} from './lib/rendererPreferences';
import { installRendererUnhandledRejectionLogger } from './lib/rendererUnhandledRejection';
import { resolveAppLocale } from './locales/languages';
import { hydrateIncidentStore } from './stores/incidentStore';
import { hydrateReticulumDismissedContacts } from './stores/reticulumPeerStore';
import { hydrateScheduledBroadcastsStore } from './stores/scheduledBroadcastsStore';
import { hydrateWeatherFilterPreferences } from './stores/weatherFilterStore';

/** Shell-first: paint splash while App + protocol runtimes chunk loads in parallel. */
const App = lazy(() => import('./App'));

function AppBootSplash() {
  return (
    <main className="bg-app-bg flex h-screen w-screen items-center justify-center">
      <output className="block" aria-busy="true">
        <h1 className="sr-only">{i18n.t('app.loadingApp')}</h1>
        <div className="bg-ink-700 h-8 w-8 animate-pulse rounded-full" aria-hidden />
      </output>
    </main>
  );
}

let stopPreferencePersistence: (() => void) | undefined;
import.meta.hot?.dispose(() => stopPreferencePersistence?.());

async function prepareRendererStorage(): Promise<void> {
  await Promise.all([
    hydrateDurableRendererSettings(),
    hydrateIncidentStore(),
    hydrateScheduledBroadcastsStore(),
    // Own chunk: keep team roster store out of the entry graph until hydrate runs.
    import('./stores/teamRosterStore').then((m) => m.hydrateTeamRosterStore()),
  ]);
}

async function finishRendererStorage(): Promise<void> {
  await finalizeRendererPreferences();
  hydrateWeatherFilterPreferences();
  hydrateReticulumDismissedContacts();
  const language = resolveAppLocale(
    parseStoredJson<{ locale?: unknown }>(getAppSettingsRaw(), 'restored locale')?.locale,
  );
  if (language !== i18n.language) {
    if (await ensureLocaleLoaded(i18n, language)) {
      await i18n.changeLanguage(language);
    }
  }
  stopPreferencePersistence ??= installRendererPreferencePersistence();
  initReduceMotionDefaultIfAbsent();
  syncReduceMotionDatasetFromStorage();
  // Own chunk (not App): avoids deliver/store edges reshuffling the App entry past 1000 kB.
  void import('./lib/scheduledBroadcasts/bootScheduler')
    .then((m) => m.bootScheduledBroadcastScheduler())
    .catch((e: unknown) => {
      console.warn(
        '[main] scheduled broadcast scheduler boot failed:',
        e instanceof Error ? e.message : String(e),
      );
    });
}

if (import.meta.env.DEV) {
  void import('react')
    .then((React) =>
      import('react-dom').then((ReactDOM) =>
        import('@axe-core/react').then((axe) => axe.default(React.default, ReactDOM.default, 1000)),
      ),
    )
    .catch((e: unknown) => {
      console.warn('[main] axe-core load failed:', e instanceof Error ? e.message : String(e));
    });
}

installRendererUnhandledRejectionLogger();
// Linux emoji picker reads vendored data instead of cdn.jsdelivr.net (works offline).
installBundledEmojiData();
// Before the first render, so it runs ahead of every modal's own key listener.
installKeyboardOwnerGuard();

void (async () => {
  await ensureLocaleLoaded(i18n, i18n.language);

  installDevElectronApiStubIfNeeded();
  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <SecureSecretsStartup prepare={prepareRendererStorage} finish={finishRendererStorage}>
          <IconMotionProvider>
            <Suspense fallback={<AppBootSplash />}>
              <App />
            </Suspense>
          </IconMotionProvider>
        </SecureSecretsStartup>
      </ErrorBoundary>
    </I18nextProvider>,
  );
})().catch((e: unknown) => {
  console.error(
    '[main] renderer boot failed:',
    e instanceof Error ? (e.stack ?? e.message) : String(e),
  );
});
