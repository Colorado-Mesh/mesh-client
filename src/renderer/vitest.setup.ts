import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';

import { cleanup } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, expect, vi } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

import en from './locales/en/translation.json';
import { createElectronAPIMock, resetElectronAPIOutboxMock } from './vitest.electronApiMock';

expect.extend(matchers);
afterEach(() => {
  cleanup();
  resetElectronAPIOutboxMock();
});

// Node.js 25+ exposes a native localStorage global that emits a warning when accessed
// without --localstorage-file. Always stub it unconditionally so no code path touches
// the native getter, and all tests get a consistent in-memory implementation.
const _localStorageStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => _localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => {
    _localStorageStore[k] = v;
  },
  removeItem: (k: string) => {
    Reflect.deleteProperty(_localStorageStore, k);
  },
  clear: () => {
    Object.keys(_localStorageStore).forEach((k) => {
      Reflect.deleteProperty(_localStorageStore, k);
    });
  },
  get length() {
    return Object.keys(_localStorageStore).length;
  },
  key: (i: number) => Object.keys(_localStorageStore)[i] ?? null,
});

// jsdom doesn't implement scroll APIs
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.scrollTo = vi.fn();

// jsdom doesn't implement canvas
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

let i18nReady: Promise<unknown> | undefined;

/** Initialise i18next on first use so pure UI tests that never call t() skip the bundle load. */
export async function ensureTestI18n(): Promise<void> {
  i18nReady ??= i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  await i18nReady;
}

// Eager init keeps existing component tests working without per-file beforeAll hooks.
void ensureTestI18n();

vi.stubGlobal('electronAPI', createElectronAPIMock());
