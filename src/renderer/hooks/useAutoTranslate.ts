import { useEffect } from 'react';

import {
  readsTranslationLanguage,
  skipMessageTranslation,
  translationMessageKey,
} from '@/renderer/lib/translation/helpers';
import { translateMessage, useTranslationStore } from '@/renderer/stores/translationStore';
import { TRANSLATION_DETECTION_CONFIDENCE } from '@/shared/translation-types';
import {
  isTranslationLanguage,
  TRANSLATION_LANGUAGES,
  translationPath,
} from '@/shared/translationLanguages';

const MAX_AUTO_QUEUE = 20;
interface AutoJob {
  key: string;
  messageKey: string;
  text: string;
  generation: number;
  preferences: ReturnType<typeof useTranslationStore.getState>['preferences'];
  owners: Set<symbol>;
}
const queued = new Map<string, AutoJob>();
const attempted = new Set<string>();
let waiting: AutoJob[] = [];
let draining = false;

async function drainAutoQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (waiting.length) {
      const job = waiting.shift()!;
      const visible = () =>
        job.owners.size > 0 && useTranslationStore.getState().generation === job.generation;
      try {
        if (!visible()) continue;
        const detection = await window.electronAPI.translation.detect(job.text);
        if (!visible()) continue;
        attempted.add(job.key);
        while (attempted.size > 200) attempted.delete(attempted.values().next().value!);
        if (
          !detection ||
          detection.confidence < TRANSLATION_DETECTION_CONFIDENCE ||
          !isTranslationLanguage(detection.language) ||
          readsTranslationLanguage(detection.language, job.preferences.readLanguages)
        )
          continue;
        const status = useTranslationStore.getState().status;
        const needed = translationPath(detection.language, job.preferences.target);
        if (needed.some((id) => !status?.packs.some((pack) => pack.id === id && pack.installed)))
          continue;
        await translateMessage(job.messageKey, job.text, 'offline', detection.language, 'auto');
      } catch {
        // catch-no-log-ok offline auto work is best effort; never send text to an online fallback
      } finally {
        if (queued.get(job.key) === job) queued.delete(job.key);
      }
    }
  } finally {
    draining = false;
  }
}

/** Mounted only for visible message rows; global serial queue also caps the visible work burst. */
export function useAutoTranslate(messageKey: string, text: string, incoming: boolean): void {
  const preferences = useTranslationStore((store) => store.preferences);
  const enabled = useTranslationStore((store) => store.status?.enabled ?? false);
  const installedIds = useTranslationStore(
    (store) =>
      store.status?.packs
        .filter((pack) => pack.installed)
        .map((pack) => pack.id)
        .join(',') ?? '',
  );
  const generation = useTranslationStore((store) => store.generation);
  useEffect(() => {
    if (
      !incoming ||
      !preferences.auto ||
      !enabled ||
      !installedIds.split(',').includes('engine') ||
      skipMessageTranslation(text)
    )
      return;
    const installed = new Set(installedIds.split(','));
    if (
      !TRANSLATION_LANGUAGES.some(
        (source) =>
          source !== preferences.target &&
          !readsTranslationLanguage(source, preferences.readLanguages) &&
          translationPath(source, preferences.target).every((id) => installed.has(id)),
      )
    )
      return;
    const key = translationMessageKey(messageKey, text, preferences.target);
    const jobKey = `${generation}:${key}`;
    if (attempted.has(jobKey)) return;
    const owner = Symbol();
    const existing = queued.get(jobKey);
    if (existing) {
      existing.owners.add(owner);
      return () => {
        existing.owners.delete(owner);
      };
    }
    for (const [id, job] of queued) {
      if (job.generation !== generation || job.owners.size === 0) queued.delete(id);
    }
    waiting = waiting.filter((job) => queued.get(job.key) === job);
    if (queued.size >= MAX_AUTO_QUEUE) return;
    const job: AutoJob = {
      key: jobKey,
      messageKey: key,
      text,
      generation,
      preferences,
      owners: new Set([owner]),
    };
    queued.set(jobKey, job);
    waiting.push(job);
    void drainAutoQueue();
    return () => {
      job.owners.delete(owner);
    };
  }, [messageKey, text, incoming, preferences, enabled, installedIds, generation]);
}
