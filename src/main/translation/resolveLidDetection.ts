import type { TranslationDetection } from '../../shared/translation-types';
import {
  isTranslationLanguage,
  normalizeTranslationLanguage,
} from '../../shared/translationLanguages';

/** How many fastText LID labels to inspect for a supported language. */
export const LID_TOP_K = 5;

/**
 * Absolute fastText mass required before pairwise decision confidence may promote a
 * supported winner. Rejects ultra-short ambiguous tokens like "hola".
 */
export const LID_MIN_RAW_SCORE = 0.35;

/** Treat a second supported score below this as "no real competitor". */
const LID_NEGLIGIBLE_SECOND = 0.05;

/**
 * When the only meaningful supported label clears {@link LID_MIN_RAW_SCORE}, report at
 * least this decision confidence so the 0.7 router gate accepts clear unique winners
 * whose raw softmax mass was split across unsupported labels.
 */
export const LID_UNIQUE_SUPPORTED_CONFIDENCE = 0.85;

/**
 * Unsupported Ibero-Romance labels whose probability mass should boost Spanish when
 * resolving top-k LID guesses. Never merges competing supported languages (e.g. es+pt).
 */
const SPANISH_ALIASES = new Set(['gl', 'ca', 'an', 'ast']);

export function normalizeLidText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Strip the fastText `__label__` prefix and normalize to a bare language code. */
export function lidLabelLanguage(label: string): string {
  return normalizeTranslationLanguage(label.replace(/^__label__/, ''));
}

/**
 * Pick the best supported translation language from top-k LID guesses.
 * Coalesces unsupported Ibero-Romance sibling scores into `es` confidence only.
 * Reports pairwise decision confidence among the top two supported labels so Romance
 * probability splits (es vs pt/it) still clear the router gate when Spanish clearly wins.
 */
export function resolveLidDetection(
  guesses: readonly (readonly [confidence: number, label: string])[],
): TranslationDetection | null {
  if (guesses.length === 0) return null;

  const scores = new Map<string, number>();
  for (const [confidence, label] of guesses) {
    const language = lidLabelLanguage(label);
    if (!language || !Number.isFinite(confidence) || confidence <= 0) continue;
    scores.set(language, (scores.get(language) ?? 0) + confidence);
  }
  if (scores.size === 0) return null;

  let spanishBoost = 0;
  for (const alias of SPANISH_ALIASES) {
    const score = scores.get(alias);
    if (score !== undefined) {
      spanishBoost += score;
      scores.delete(alias);
    }
  }
  if (spanishBoost > 0) scores.set('es', (scores.get('es') ?? 0) + spanishBoost);

  let bestLanguage: string | undefined;
  let bestConfidence = 0;
  let secondConfidence = 0;
  for (const [language, confidence] of scores) {
    if (!isTranslationLanguage(language)) continue;
    if (confidence > bestConfidence) {
      secondConfidence = bestConfidence;
      bestLanguage = language;
      bestConfidence = confidence;
    } else if (confidence > secondConfidence) {
      secondConfidence = confidence;
    }
  }
  if (!bestLanguage) return null;

  if (bestConfidence < LID_MIN_RAW_SCORE) {
    return { language: bestLanguage, confidence: Math.min(1, bestConfidence) };
  }
  if (secondConfidence <= LID_NEGLIGIBLE_SECOND) {
    return {
      language: bestLanguage,
      confidence: Math.min(1, Math.max(bestConfidence, LID_UNIQUE_SUPPORTED_CONFIDENCE)),
    };
  }
  const pairwise = bestConfidence / (bestConfidence + secondConfidence);
  return {
    language: bestLanguage,
    confidence: Math.min(1, Math.max(bestConfidence, pairwise)),
  };
}
