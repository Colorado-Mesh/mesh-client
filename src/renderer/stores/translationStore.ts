import { create } from 'zustand';

import { getAppSettingsRaw, mergeAppSettingsPartial } from '@/renderer/lib/appSettingsStorage';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { translationCacheKey } from '@/renderer/lib/translation/helpers';
import type { TranslationResult, TranslationStatus } from '@/shared/translation-types';
import {
  isTranslationLanguage,
  normalizeTranslationLanguage,
  type TranslationLanguage,
} from '@/shared/translationLanguages';

export const TRANSLATION_CACHE_CAP = 200;
export interface TranslationPreferences {
  target: TranslationLanguage;
  readLanguages: string[];
  auto: boolean;
}
export interface MessageTranslationState {
  loading: boolean;
  result?: TranslationResult;
  showTranslation: boolean;
}
const IDLE: MessageTranslationState = { loading: false, showTranslation: true };

function preferences(): TranslationPreferences {
  const stored =
    parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'translation settings') ?? {};
  const locale = normalizeTranslationLanguage(
    typeof stored.locale === 'string' ? stored.locale : 'en',
  );
  const requested = normalizeTranslationLanguage(
    typeof stored.translationTargetLanguage === 'string'
      ? stored.translationTargetLanguage
      : locale,
  );
  return {
    target: isTranslationLanguage(requested) ? requested : 'en',
    readLanguages: Array.isArray(stored.translationReadLanguages)
      ? stored.translationReadLanguages.filter(
          (language): language is string => typeof language === 'string',
        )
      : [locale],
    auto: stored.translationAutoEnabled === true,
  };
}

interface TranslationStore {
  preferences: TranslationPreferences;
  status: TranslationStatus | null;
  generation: number;
  messages: Map<string, MessageTranslationState>;
  cache: Map<string, TranslationResult>;
  setPreferences: (preferences: TranslationPreferences) => void;
  setStatus: (status: TranslationStatus) => void;
  setMessage: (key: string, state: MessageTranslationState) => void;
  toggle: (key: string) => void;
  clear: () => void;
}

let statusRevision = 0;
let statusPromise: Promise<void> | undefined;

export const useTranslationStore = create<TranslationStore>((set, get) => ({
  preferences: preferences(),
  status: null,
  generation: 0,
  messages: new Map(),
  cache: new Map(),
  setPreferences: (value) => {
    mergeAppSettingsPartial(
      {
        translationTargetLanguage: value.target,
        translationReadLanguages: value.readLanguages,
        translationAutoEnabled: value.auto,
      },
      'translation settings',
    );
    set({
      preferences: value,
      generation: get().generation + 1,
      messages: new Map(),
      cache: new Map(),
    });
  },
  setStatus: (status) => {
    statusRevision++;
    statusPromise = undefined;
    const previous = get().status;
    const changed =
      previous &&
      (previous.enabled !== status.enabled ||
        previous.libre.enabled !== status.libre.enabled ||
        previous.libre.url !== status.libre.url ||
        previous.packs
          .filter((pack) => pack.installed)
          .map((pack) => pack.id)
          .join() !==
          status.packs
            .filter((pack) => pack.installed)
            .map((pack) => pack.id)
            .join());
    set({
      status,
      ...(changed
        ? { generation: get().generation + 1, messages: new Map(), cache: new Map() }
        : {}),
    });
  },
  setMessage: (key, state) => {
    const messages = new Map(get().messages);
    messages.delete(key);
    messages.set(key, state);
    while (messages.size > TRANSLATION_CACHE_CAP) messages.delete(messages.keys().next().value!);
    set({ messages });
  },
  toggle: (key) => {
    const state = get().messages.get(key);
    if (state) get().setMessage(key, { ...state, showTranslation: !state.showTranslation });
  },
  clear: () => {
    set({ generation: get().generation + 1, messages: new Map(), cache: new Map() });
  },
}));

export function getMessageTranslation(key: string): MessageTranslationState {
  return useTranslationStore.getState().messages.get(key) ?? IDLE;
}
export const IDLE_MESSAGE_TRANSLATION = IDLE;
export async function refreshTranslationStatus(fresh = false): Promise<void> {
  if (!window.electronAPI?.translation) return;
  if (fresh) {
    statusRevision++;
    statusPromise = undefined;
  }
  if (!statusPromise) {
    const revision = statusRevision;
    const request = window.electronAPI.translation
      .getStatus()
      .then((status) => {
        if (revision === statusRevision) useTranslationStore.getState().setStatus(status);
      })
      .catch(() => {
        // catch-no-log-ok an unavailable main service leaves the disabled opt-in UI
      })
      .finally(() => {
        if (statusPromise === request) statusPromise = undefined;
      });
    statusPromise = request;
  }
  await statusPromise;
}
export function ensureTranslationStatus(): void {
  if (!useTranslationStore.getState().status) void refreshTranslationStatus();
}

const pending = new Map<string, Promise<void>>();
export function translateMessage(
  key: string,
  text: string,
  provider: 'offline' | 'libre' = 'offline',
  source?: TranslationLanguage,
  mode: 'manual' | 'auto' = 'manual',
): Promise<void> {
  const store = useTranslationStore.getState();
  const pendingKey = `${store.generation}:${provider}:${key}`;
  const existing = pending.get(pendingKey);
  if (existing) return existing;
  const generation = store.generation;
  const target = store.preferences.target;
  store.setMessage(key, { loading: true, showTranslation: true });
  const promise = (async () => {
    try {
      const cacheKey = await translationCacheKey(text, target, provider);
      if (useTranslationStore.getState().generation !== generation) return;
      const cached = useTranslationStore.getState().cache.get(cacheKey);
      const result =
        cached ??
        (await window.electronAPI.translation.translate({ text, target, source, mode, provider }));
      const latest = useTranslationStore.getState();
      if (latest.generation !== generation) return;
      if (result.ok) {
        const cache = new Map(latest.cache);
        cache.delete(cacheKey);
        cache.set(cacheKey, result);
        while (cache.size > TRANSLATION_CACHE_CAP) cache.delete(cache.keys().next().value!);
        useTranslationStore.setState({ cache });
      }
      latest.setMessage(key, { loading: false, result, showTranslation: true });
    } catch {
      // catch-no-log-ok message text and provider diagnostics must not reach logs
      if (useTranslationStore.getState().generation === generation)
        useTranslationStore.getState().setMessage(key, {
          loading: false,
          result: { ok: false, reason: 'error' },
          showTranslation: true,
        });
    }
  })().finally(() => {
    pending.delete(pendingKey);
  });
  pending.set(pendingKey, promise);
  return promise;
}
