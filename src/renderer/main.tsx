/// <reference types="vite/client" />
import './styles.css';

import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import i18n from './lib/i18n';
import { ensureLocaleLoaded } from './lib/localeResources';

if (import.meta.env.DEV) {
  void import('react').then((React) =>
    import('react-dom').then((ReactDOM) =>
      import('@axe-core/react').then((axe) => axe.default(React.default, ReactDOM.default, 1000)),
    ),
  );
}

void (async () => {
  await ensureLocaleLoaded(i18n, i18n.language);

  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nextProvider>,
  );
})();
