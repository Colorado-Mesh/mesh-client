import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from '@/renderer/lib/defaultAppSettings';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

const REDUCE_MOTION_INIT_KEY = 'mesh-client:reduceMotionInitialized';

type ReduceMotionListener = () => void;
const listeners = new Set<ReduceMotionListener>();

function applyDocumentDataset(enabled: boolean): void {
  if (enabled) {
    document.documentElement.dataset.reduceMotion = 'true';
  } else {
    delete document.documentElement.dataset.reduceMotion;
  }
}

/** One-time OS hint when the key has never been stored. */
export function initReduceMotionDefaultIfAbsent(): void {
  try {
    if (localStorage.getItem(REDUCE_MOTION_INIT_KEY) === '1') return;
    const raw = getAppSettingsRaw();
    const parsed = parseStoredJson<Record<string, unknown>>(raw, 'initReduceMotionDefaultIfAbsent');
    if (parsed && 'reduceMotion' in parsed) {
      localStorage.setItem(REDUCE_MOTION_INIT_KEY, '1');
      return;
    }
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      mergeAppSetting('reduceMotion', true, 'initReduceMotionDefaultIfAbsent');
      applyDocumentDataset(true);
    }
    localStorage.setItem(REDUCE_MOTION_INIT_KEY, '1');
  } catch {
    // catch-no-log-ok localStorage or matchMedia unavailable in restricted environments
  }
}

export function readReduceMotion(): boolean {
  const parsed = parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'readReduceMotion');
  if (parsed && typeof parsed.reduceMotion === 'boolean') {
    return parsed.reduceMotion;
  }
  return DEFAULT_APP_SETTINGS_SHARED.reduceMotion;
}

export function writeReduceMotion(enabled: boolean): void {
  mergeAppSetting('reduceMotion', enabled, 'writeReduceMotion');
  applyDocumentDataset(enabled);
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeReduceMotion(listener: ReduceMotionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function syncReduceMotionDatasetFromStorage(): void {
  applyDocumentDataset(readReduceMotion());
}
