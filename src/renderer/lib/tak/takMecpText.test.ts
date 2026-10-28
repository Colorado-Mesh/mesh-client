import { afterEach, describe, expect, it } from 'vitest';

import en from '../mecp/languages/en.json';
import type { LanguageFile } from '../mecp/mecpMessages';
import { tryParseMecp } from '../mecp/mecpMessages';
import {
  describeMecpForTak,
  resetTakMecpLocale,
  setTakMecpLocale,
  takMecpText,
} from './takMecpText';

/** The app's strings for these keys, in English. */
const t = (key: string, opts?: Record<string, unknown>): string => {
  const count = Number(opts?.count);
  const strings: Record<string, string> = {
    'mecp.severity.mayday': 'MAYDAY',
    'mecp.severity.urgent': 'URGENT',
    'mecp.severity.safety': 'SAFETY',
    'mecp.severity.routine': 'ROUTINE',
    'mecp.atakDrill': 'DRILL',
    'mecp.atakPeople': count === 1 ? `${count} person` : `${count} people`,
  };
  return strings[key] ?? key;
};

const EN = en as LanguageFile;
const describeIn = (text: string, lang: LanguageFile = EN) => {
  const parsed = tryParseMecp(text);
  if (!parsed) throw new Error(`not MECP: ${text}`);
  return describeMecpForTak(parsed, lang, t);
};

describe('describeMecpForTak', () => {
  it('puts a report in words: severity, codes, people and position', () => {
    expect(describeIn('MECP/0/M01 M07 P05 2pax 48.6520,20.1305')).toBe(
      '🆘 MAYDAY: Injury · Fracture / immobile · At GPS coordinates · 2 people · 48.6520, 20.1305',
    );
  });

  it('quotes the free text left over', () => {
    expect(describeIn('MECP/1/M05 1pax near the north trailhead')).toBe(
      '🚨 URGENT: Hypothermia · 1 person · “near the north trailhead”',
    );
  });

  it("fills the code's own count and minutes, without repeating them", () => {
    expect(describeIn('MECP/3/H07 4pax')).toBe('ℹ️ ROUTINE: Have shelter / space for 4pax');
    expect(describeIn('MECP/3/R03 15')).toBe('ℹ️ ROUTINE: ETA 15');
  });

  it('says a drill is a drill', () => {
    expect(describeIn('MECP/0/D01 M01')).toBe('DRILL 🆘 MAYDAY: This is a drill · Injury');
  });

  it('shows the severity alone for a report with no codes', () => {
    expect(describeIn('MECP/2/')).toBe('⚠️ SAFETY');
  });

  it("uses the pack it is given, as for the app's language", () => {
    const de: LanguageFile = {
      ...EN,
      codes: { ...EN.codes, M01: 'Verletzung', H07: 'Unterkunft / Platz für [N] Pers.' },
    };
    expect(describeIn('MECP/0/M01 H07 3pax', de)).toBe(
      '🆘 MAYDAY: Verletzung · Unterkunft / Platz für 3 Pers.',
    );
  });
});

describe('takMecpText', () => {
  afterEach(() => {
    resetTakMecpLocale();
  });

  it('keeps the code line below the words, in English until the app says otherwise', () => {
    expect(takMecpText(' MECP/0/M01 2pax ')).toBe('🆘 MAYDAY: Injury · 2 people\nMECP/0/M01 2pax');
    expect(takMecpText('MECP/3/D01')).toBe('DRILL ℹ️ ROUTINE: This is a drill\nMECP/3/D01');
  });

  it("uses the app's language once it is handed over", async () => {
    const german = (key: string, opts?: Record<string, unknown>) =>
      key === 'mecp.atakPeople' ? `${String(opts?.count)} Personen` : t(key, opts);
    await setTakMecpLocale('de-DE', german);
    expect(takMecpText('MECP/0/M01 2pax')).toBe(
      '🆘 MAYDAY: Verletzung · 2 Personen\nMECP/0/M01 2pax',
    );
  });

  it('keeps the last language asked for when an earlier pack loads later', async () => {
    const first = setTakMecpLocale('de', t);
    const second = setTakMecpLocale('en', t);
    await Promise.all([first, second]);
    expect(takMecpText('MECP/0/M01')).toBe('🆘 MAYDAY: Injury\nMECP/0/M01');
  });

  it('leaves anything else alone', () => {
    expect(takMecpText('on scene')).toBeNull();
    expect(takMecpText('see MECP/0/M01 later')).toBeNull();
    expect(takMecpText('MECP/7/M01')).toBeNull();
  });
});
