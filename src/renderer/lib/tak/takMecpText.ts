import {
  getCachedMecpLanguage,
  type LanguageFile,
  loadMecpLanguage,
  mecpLanguageForAppLocale,
  type MecpParsed,
  severityLabelKey,
  stripMecpCoordsFromFreetext,
  tryParseMecp,
} from '../mecp/mecpMessages';

/** A sign per severity, MAYDAY to ROUTINE, as MeshCore TAK Bridge shows them. */
const SEVERITY_SIGNS = ['🆘', '🚨', '⚠️', 'ℹ️'] as const;

export type TakMecpTranslate = (key: string, opts?: Record<string, unknown>) => string;

/** The app's words for a report, in English, until the app hands over its own. */
const ENGLISH: Record<string, string> = {
  'mecp.severity.mayday': 'MAYDAY',
  'mecp.severity.urgent': 'URGENT',
  'mecp.severity.safety': 'SAFETY',
  'mecp.severity.routine': 'ROUTINE',
  'mecp.atakDrill': 'DRILL',
};

const englishTranslate: TakMecpTranslate = (key, opts) => {
  if (key === 'mecp.atakPeople') {
    const count = Number(opts?.count);
    return count === 1 ? '1 person' : `${count} people`;
  }
  return ENGLISH[key] ?? key;
};

/**
 * The app's language for reports to TAK clients. Kept here, set by the TAK relay hook, so this
 * module never loads the app's i18n itself: the relay also runs where there is none.
 */
let appTranslate: TakMecpTranslate = englishTranslate;
let appPack: LanguageFile = getCachedMecpLanguage('en');
let localeRequest = 0;

/**
 * Use the app's language for reports to TAK clients: its words now, and its MECP pack once it
 * has loaded (English until then).
 */
export async function setTakMecpLocale(appLocale: string, t: TakMecpTranslate): Promise<void> {
  const request = ++localeRequest;
  // English words with the English pack while the new one loads, never one with the other.
  appTranslate = englishTranslate;
  appPack = getCachedMecpLanguage('en');
  const pack = await loadMecpLanguage(mecpLanguageForAppLocale(appLocale || 'en'));
  // A later change of language wins over this one, whichever pack loads first.
  if (request !== localeRequest) return;
  // A pack that failed to load comes back as English; keep the words English with it.
  appTranslate = pack === getCachedMecpLanguage('en') ? englishTranslate : t;
  appPack = pack;
}

/** Back to English, as before the app hands over its language; for tests. */
export function resetTakMecpLocale(): void {
  localeRequest++;
  appTranslate = englishTranslate;
  appPack = getCachedMecpLanguage('en');
}

/** The count in a code's meaning, `[N]` in every pack. */
const COUNT_PLACEHOLDER = '[N]';
/** Any other bracketed word is the minutes, which each pack names in its own language. */
const MINUTES_PLACEHOLDER_RE = /\[(?!N\])[^\]]+\]/u;

/** `text`'s words, without the first one `drop` picks out. */
function withoutWord(text: string, drop: (word: string) => boolean): string {
  const words = text.split(/\s+/u).filter(Boolean);
  const at = words.findIndex(drop);
  if (at >= 0) words.splice(at, 1);
  return words.join(' ');
}

/**
 * A report in words, on one line: the severity, what each code means, the people, the position,
 * and whatever free text is left, in quotes, e.g.
 * `🆘 MAYDAY: Injury · Fracture / immobile · 2 people · 48.6520, 20.1305`. Drills say so first.
 * The same shape as MeshCore TAK Bridge, in the app's language.
 */
export function describeMecpForTak(
  parsed: MecpParsed,
  lang: LanguageFile,
  t: TakMecpTranslate,
): string {
  const severity = parsed.severity ?? 3;
  const label = `${SEVERITY_SIGNS[severity]} ${t(severityLabelKey(severity))}`;
  const head = parsed.isDrill ? `${t('mecp.atakDrill')} ${label}` : label;
  const { count, gps, eta } = parsed.extracted;
  const meanings = parsed.codes.map((code) => lang.codes[code] as string | undefined);
  const countInCode = count != null && meanings.some((m) => m?.includes(COUNT_PLACEHOLDER));
  const etaInCode =
    eta != null && meanings.some((m) => m !== undefined && MINUTES_PLACEHOLDER_RE.test(m));
  const parts = parsed.codes.map((code, i) => {
    let meaning = meanings[i];
    if (meaning === undefined) return code;
    if (count != null) meaning = meaning.replace(COUNT_PLACEHOLDER, String(count));
    if (eta != null) meaning = meaning.replace(MINUTES_PLACEHOLDER_RE, String(eta));
    return meaning;
  });
  if (count != null && !countInCode) parts.push(t('mecp.atakPeople', { count }));
  if (gps) parts.push(`${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
  let rest = stripMecpCoordsFromFreetext(parsed.freetext ?? '');
  if (count != null) rest = withoutWord(rest, (w) => w.toLowerCase() === `${count}pax`);
  // The minutes leave the free text only once the sentence shows them.
  if (etaInCode) rest = withoutWord(rest, (w) => w === String(eta));
  if (rest) parts.push(`“${rest}”`);
  return parts.length > 0 ? `${head}: ${parts.join(' · ')}` : head;
}

/**
 * What TAK clients see for a heard message that is an MECP report: the report in words in the
 * app's language, with the code line kept below it, as MeshCore TAK Bridge shows one. Null for
 * any other message.
 */
export function takMecpText(text: string): string | null {
  const parsed = tryParseMecp(text.trim());
  if (!parsed) return null;
  return `${describeMecpForTak(parsed, appPack, appTranslate)}\n${parsed.raw.trim()}`;
}
