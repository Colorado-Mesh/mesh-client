import type { EncodeResult, Severity } from './engine';
import { encode, MAX_MESSAGE_BYTES } from './engine';
import { MECP_EXPLANATION_LANGUAGES } from './mecpExplanationLanguages';

export { MECP_EXPLANATION_LANGUAGES } from './mecpExplanationLanguages';

export interface MecpWireTextOptions {
  explanationLanguage?: string;
  includeHelpLink?: boolean;
}

export const MECP_HELP_URL = 'https://mecp.radio';

type CodeLabels = Readonly<Partial<Record<string, string>>>;

const CODE_PACKS: Readonly<Partial<Record<string, CodeLabels>>> = import.meta.glob<CodeLabels>(
  './languages/*.json',
  { eager: true, import: 'codes' },
);

const SEVERITY_LABELS: Readonly<Partial<Record<number, string>>> = {
  0: 'MAYDAY',
  1: 'URGENT',
  2: 'SAFETY',
  3: 'ROUTINE',
};

function summaryCodes(codes: readonly string[]): readonly string[] {
  // Other ACK codes describe the original report, not actions by the acknowledging station.
  return codes.includes('R01')
    ? codes.filter((code) => code === 'R01' || code === 'D01' || code === 'D02')
    : codes;
}

function localizedSummary(language: string, codes: readonly string[]): string {
  const labels = CODE_PACKS[`./languages/${language}.json`];
  if (!labels || !MECP_EXPLANATION_LANGUAGES.some((choice) => choice.id === language)) {
    throw new RangeError(`Unsupported MECP explanation language: ${language}`);
  }
  const selected = summaryCodes(codes);
  const ordered = [
    ...selected.filter((code) => code === 'D02'),
    ...selected.filter((code) => code === 'D01'),
    ...selected.filter((code) => code !== 'D01' && code !== 'D02'),
  ];
  const meanings = ordered.map((code) => labels[code] ?? code);
  return meanings.length > 0 ? `[${language}: ${meanings.join('; ')}]` : `[${language}]`;
}

function legacyEnglishSummary(severity: number, codes: readonly string[]): string {
  const english = CODE_PACKS['./languages/en.json'];
  const isAck = codes.includes('R01');
  const priority = SEVERITY_LABELS[severity] ?? 'MECP';
  const label = codes.includes('D02')
    ? 'TEST ONLY'
    : codes.includes('D01')
      ? 'DRILL ONLY'
      : isAck
        ? `${priority} ACK`
        : priority;
  const meanings = summaryCodes(codes).map((code) => {
    if (code === 'R01') return 'Received';
    if (code === 'B02') return 'Beacon received';
    return english?.[code] ?? code;
  });
  return meanings.length > 0 ? `[${label}: ${meanings.join('; ')}]` : `[${label}]`;
}

/** Keep the structured fields first so existing decoders retain R03's leading ETA. */
export function encodeReadableMecp(
  severity: Severity,
  codes: string[],
  freetext?: string,
  maxBytes = MAX_MESSAGE_BYTES,
  options: MecpWireTextOptions = {},
): EncodeResult {
  const summary =
    options.explanationLanguage === undefined
      ? undefined
      : localizedSummary(options.explanationLanguage, codes);
  const details = [freetext?.trim(), summary, options.includeHelpLink ? MECP_HELP_URL : undefined]
    .filter(Boolean)
    .join(' ');
  const result = encode(severity, codes, details);
  const byteLimit = Math.min(MAX_MESSAGE_BYTES, maxBytes);
  const overLimit = result.byteLength > byteLimit;
  const warnings = [...result.warnings];
  if (overLimit && byteLimit < MAX_MESSAGE_BYTES) {
    warnings.push(`Message is ${result.byteLength} bytes, exceeds ${byteLimit} byte limit`);
  }
  return { ...result, overLimit, warnings };
}

function stripExactTail(freetext: string, tail: string): string {
  const summaryWords = tail.toLowerCase().split(/\s+/);
  const words = [...freetext.matchAll(/\S+/g)];
  const suffixWords = words.slice(-summaryWords.length);
  if (
    suffixWords.length !== summaryWords.length ||
    !summaryWords.every((word, index) => suffixWords[index][0].toLowerCase() === word)
  ) {
    return freetext;
  }
  const suffixStart = suffixWords[0].index;
  return freetext.slice(0, suffixStart).trimEnd();
}

/** Remove known generated tails independently of the receiving app's display language. */
export function stripMecpReadableSummary(
  freetext: string,
  severity: number,
  codes: readonly string[],
): string {
  const withoutLink = stripExactTail(freetext, MECP_HELP_URL);
  for (const language of MECP_EXPLANATION_LANGUAGES) {
    const withoutSummary = stripExactTail(withoutLink, localizedSummary(language.id, codes));
    if (withoutSummary !== withoutLink) return withoutSummary;
  }
  return stripExactTail(withoutLink, legacyEnglishSummary(severity, codes));
}
