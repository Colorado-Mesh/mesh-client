import i18n from '../i18n';
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

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** The MECP pack for the app's language; English until that pack has loaded. */
function appMecpLanguage(): LanguageFile {
  return getCachedMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en'));
}

/** Load the MECP pack for the app's language, so TAK clients get reports in it. */
export function warmTakMecpLanguage(appLocale: string): Promise<LanguageFile> {
  return loadMecpLanguage(mecpLanguageForAppLocale(appLocale || 'en'));
}

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
export function describeMecpForTak(parsed: MecpParsed, lang: LanguageFile, t: Translate): string {
  const severity = parsed.severity ?? 3;
  const label = `${SEVERITY_SIGNS[severity]} ${t(severityLabelKey(severity))}`;
  const head = parsed.isDrill ? `${t('mecp.atakDrill')} ${label}` : label;
  const { count, gps, eta } = parsed.extracted;
  const meanings = parsed.codes.map((code) => lang.codes[code] as string | undefined);
  const countInCode = count != null && meanings.some((m) => m?.includes('[N]'));
  const parts = parsed.codes.map((code, i) => {
    const meaning = meanings[i];
    if (meaning === undefined) return code;
    return meaning
      .replace('[N]', count != null ? String(count) : '[N]')
      .replace('[minutes]', eta != null ? String(eta) : '[minutes]');
  });
  if (count != null && !countInCode) parts.push(t('mecp.atakPeople', { count }));
  if (gps) parts.push(`${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
  let rest = stripMecpCoordsFromFreetext(parsed.freetext ?? '');
  if (count != null) rest = withoutWord(rest, (w) => w.toLowerCase() === `${count}pax`);
  if (eta != null) rest = withoutWord(rest, (w) => w === String(eta));
  if (rest) parts.push(`“${rest}”`);
  return parts.length > 0 ? `${head}: ${parts.join(' · ')}` : head;
}

/**
 * What TAK clients see for a heard message that is an MECP report: the report in words in the
 * app's language, with the code line kept below it, as MeshCore TAK Bridge shows one. Null for
 * any other message.
 */
export function takMecpText(text: string, t: Translate = i18n.t.bind(i18n)): string | null {
  const parsed = tryParseMecp(text.trim());
  if (!parsed) return null;
  return `${describeMecpForTak(parsed, appMecpLanguage(), t)}\n${parsed.raw.trim()}`;
}
