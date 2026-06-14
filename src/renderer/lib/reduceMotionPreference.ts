import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from '@/renderer/lib/defaultAppSettings';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
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

function notifyReduceMotionListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (e) {
      console.warn('[reduceMotion] listener notification failed ' + errLikeToLogString(e));
    }
  }
}

function persistReduceMotion(enabled: boolean): boolean {
  mergeAppSetting('reduceMotion', enabled, 'writeReduceMotion');
  return readReduceMotion() === enabled;
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
  const previous = readReduceMotion();
  try {
    applyDocumentDataset(enabled);
  } catch (e) {
    console.warn('[reduceMotion] dataset apply failed ' + errLikeToLogString(e));
    return;
  }

  if (!persistReduceMotion(enabled)) {
    try {
      applyDocumentDataset(previous);
    } catch (e) {
      console.warn('[reduceMotion] dataset rollback failed ' + errLikeToLogString(e));
    }
    console.warn('[reduceMotion] persist failed; reverted dataset to match storage');
    return;
  }

  notifyReduceMotionListeners();
}

export function subscribeReduceMotion(listener: ReduceMotionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function syncReduceMotionDatasetFromStorage(): void {
  try {
    applyDocumentDataset(readReduceMotion());
  } catch (e) {
    console.warn('[reduceMotion] dataset sync failed ' + errLikeToLogString(e));
  }
}
