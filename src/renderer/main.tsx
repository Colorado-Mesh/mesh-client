/// <reference types="vite/client" />
import './styles.css';

import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import ErrorBoundary from './components/ErrorBoundary';
import { runConnectionPanelStorageMigrations } from './lib/connectionPanelStorageMigrations';
import { installDevElectronApiStubIfNeeded } from './lib/devElectronApiStub';
import i18n from './lib/i18n';
import { IconMotionProvider } from './lib/icons/iconMotionContext';
import { ensureLocaleLoaded } from './lib/localeResources';
import {
  initReduceMotionDefaultIfAbsent,
  syncReduceMotionDatasetFromStorage,
} from './lib/reduceMotionPreference';
import { installRendererUnhandledRejectionLogger } from './lib/rendererUnhandledRejection';

/** Shell-first: paint splash while App + protocol runtimes chunk loads in parallel. */
const App = lazy(() => import('./App'));

function AppBootSplash() {
  return (
    <main className="bg-app-bg flex h-screen w-screen items-center justify-center">
      <output className="block" aria-busy="true">
        <h1 className="sr-only">{i18n.t('app.loadingApp')}</h1>
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-700" aria-hidden />
      </output>
    </main>
  );
}

if (import.meta.env.DEV) {
  void import('react').then((React) =>
    import('react-dom').then((ReactDOM) =>
      import('@axe-core/react').then((axe) => axe.default(React.default, ReactDOM.default, 1000)),
    ),
  );
}

installRendererUnhandledRejectionLogger();

void (async () => {
  await ensureLocaleLoaded(i18n, i18n.language);

  installDevElectronApiStubIfNeeded();

  initReduceMotionDefaultIfAbsent();
  syncReduceMotionDatasetFromStorage();
  runConnectionPanelStorageMigrations();

  // Kick App chunk download immediately after locale (parallel with splash paint).
  void import('./App');

  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <IconMotionProvider>
          <Suspense fallback={<AppBootSplash />}>
            <App />
          </Suspense>
        </IconMotionProvider>
      </ErrorBoundary>
    </I18nextProvider>,
  );
})();
