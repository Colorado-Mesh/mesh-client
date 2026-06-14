import { app, type Session } from 'electron';

import { sanitizeLogMessage } from './sanitize-log-message';
import { pickSpellCheckerLanguages } from './spellcheckLanguages';

const SPELLCHECK_RETRY_DELAYS_MS = [250, 1000, 5000] as const;

interface SpellcheckSessionState {
  configured: boolean;
  warnedExhausted: boolean;
  retryTimers: ReturnType<typeof setTimeout>[];
  dictionaryHandlers: (() => void)[];
}

const sessionState = new WeakMap<Session, SpellcheckSessionState>();

function getState(sess: Session): SpellcheckSessionState {
  let state = sessionState.get(sess);
  if (!state) {
    state = { configured: false, warnedExhausted: false, retryTimers: [], dictionaryHandlers: [] };
    sessionState.set(sess, state);
  }
  return state;
}

function clearRetryTimers(state: SpellcheckSessionState): void {
  for (const timer of state.retryTimers) {
    clearTimeout(timer);
  }
  state.retryTimers = [];
}

function warnExhausted(sess: Session, state: SpellcheckSessionState): void {
  if (state.warnedExhausted || state.configured || process.platform === 'darwin') {
    return;
  }
  state.warnedExhausted = true;
  const available = sess.availableSpellCheckerLanguages;
  const count = Array.isArray(available) ? available.length : 0;
  console.warn(`[main] spellcheck: dictionary list still empty after retries (${count} available)`);
}

/** Attempt Hunspell language setup; returns true when no further Win/Linux setup is needed. */
export function tryConfigureRendererSpellcheck(sess: Session): boolean {
  try {
    sess.setSpellCheckerEnabled(true);
    if (process.platform === 'darwin') {
      return true;
    }
    const available = sess.availableSpellCheckerLanguages;
    if (!Array.isArray(available) || available.length === 0) {
      return false;
    }
    const picked = pickSpellCheckerLanguages(available, app.getLocale());
    if (picked.length === 0) {
      return false;
    }
    sess.setSpellCheckerLanguages(picked);
    console.debug('[main] spellcheck: languages configured', {
      picked,
      active: sess.getSpellCheckerLanguages(),
    });
    return true;
  } catch (e) {
    console.warn(
      '[main] spellcheck: configure failed',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return false;
  }
}

/**
 * Win/Linux: Hunspell only runs after languages are set (see Electron spellchecker tutorial).
 * macOS: native checker; ensure the session flag is on. Retries when dictionary lists populate
 * asynchronously.
 */
export function setupRendererSpellcheck(sess: Session): void {
  const state = getState(sess);

  const attempt = (): boolean => {
    if (tryConfigureRendererSpellcheck(sess)) {
      state.configured = true;
      clearRetryTimers(state);
      return true;
    }
    return false;
  };

  if (attempt()) {
    return;
  }

  if (state.dictionaryHandlers.length === 0) {
    const onDictionaryReady = (): void => {
      if (attempt()) {
        for (const off of state.dictionaryHandlers) {
          off();
        }
        state.dictionaryHandlers = [];
      }
    };

    sess.on('spellcheck-dictionary-initialized', onDictionaryReady);
    sess.on('spellcheck-dictionary-download-success', onDictionaryReady);
    state.dictionaryHandlers.push(
      () => sess.off('spellcheck-dictionary-initialized', onDictionaryReady),
      () => sess.off('spellcheck-dictionary-download-success', onDictionaryReady),
    );
  }

  if (state.retryTimers.length === 0) {
    for (const delayMs of SPELLCHECK_RETRY_DELAYS_MS) {
      const timer = setTimeout(() => {
        if (attempt()) {
          return;
        }
        if (delayMs === SPELLCHECK_RETRY_DELAYS_MS[SPELLCHECK_RETRY_DELAYS_MS.length - 1]) {
          warnExhausted(sess, state);
        }
      }, delayMs);
      state.retryTimers.push(timer);
    }
  }
}

/** Re-run spellcheck setup after renderer load (dictionary lists may populate late). */
export function retryRendererSpellcheck(sess: Session): void {
  const state = getState(sess);
  if (state.configured) {
    return;
  }
  if (tryConfigureRendererSpellcheck(sess)) {
    state.configured = true;
    clearRetryTimers(state);
    return;
  }
  setupRendererSpellcheck(sess);
}
