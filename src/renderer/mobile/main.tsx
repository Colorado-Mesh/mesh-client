import '../styles.css';
import './mobile.css';

import i18next from 'i18next';
import { createRoot } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { aria, common, mobilePrototype, shell } from '../locales/en/translation.json';
import { MobilePrototype } from './MobilePrototype';

const previewI18n = i18next.createInstance();
void previewI18n
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: { aria, common, mobilePrototype, shell },
      },
    },
    interpolation: { escapeValue: false },
  })
  .then(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('Mobile prototype root is missing');
    createRoot(root).render(
      <I18nextProvider i18n={previewI18n}>
        <MobilePrototype />
      </I18nextProvider>,
    );
  })
  .catch((error: unknown) => {
    console.error('Mobile prototype failed to load', error);
  });
