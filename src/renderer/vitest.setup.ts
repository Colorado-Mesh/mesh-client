import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';
// emoji-picker-element (ChatPanel) opens IndexedDB; jsdom has none.
import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, expect, vi } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

import en from './locales/en/translation.json';
import { createElectronAPIMock, resetElectronAPIOutboxMock } from './vitest.electronApiMock';

expect.extend(matchers);

// jsdom omits structuredClone; fake-indexeddb requires it (Node engines provide it).
if (typeof globalThis.structuredClone === 'function') {
  vi.stubGlobal('structuredClone', globalThis.structuredClone.bind(globalThis));
}

/** Empty DOMRect for jsdom Range / IntersectionObserver stubs. */
function emptyDomRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return this;
    },
  };
}

// emoji-picker-element uses IntersectionObserver after IndexedDB opens (jsdom has none).
interface IntersectionObserverStubInstance {
  root: null;
  rootMargin: string;
  thresholds: number[];
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  takeRecords: ReturnType<typeof vi.fn>;
}
vi.stubGlobal(
  'IntersectionObserver',
  vi.fn(function IntersectionObserverStub(this: IntersectionObserverStubInstance) {
    this.root = null;
    this.rootMargin = '';
    this.thresholds = [];
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    this.takeRecords = vi.fn(() => []);
  }),
);

// emoji-picker-element ZWJ checks call Range#getBoundingClientRect (incomplete in jsdom).
if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = emptyDomRect;
}
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
afterEach(() => {
  cleanup();
  resetElectronAPIOutboxMock();
});

/** Fail tests on [object Object] in console.warn (use mockConsoleWarn when expecting warnings). */
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const text = args.map(String).join(' ');
  if (text.includes('[object Object]')) {
    throw new Error(`Unexpected console.warn containing [object Object]: ${text}`);
  }
  Reflect.apply(originalConsoleWarn, console, args);
};

// Node.js 25+ exposes a native localStorage global that emits a warning when accessed
// without --localstorage-file. Always stub it unconditionally so no code path touches
// the native getter, and all tests get a consistent in-memory implementation.
const _localStorageStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => _localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => {
    _localStorageStore[k] = typeof v === 'string' ? v : JSON.stringify(v);
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
