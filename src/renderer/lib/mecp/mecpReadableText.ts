import type { EncodeResult, Severity } from './engine';
import { encode, MAX_MESSAGE_BYTES } from './engine';
import english from './languages/en.json';

const ENGLISH_CODES: Readonly<Partial<Record<string, string>>> = english.codes;
const SEVERITY_LABELS: Readonly<Partial<Record<number, string>>> = {
  0: 'MAYDAY',
  1: 'URGENT',
  2: 'SAFETY',
  3: 'ROUTINE',
};

function readableSummary(severity: number, codes: readonly string[]): string {
  const isAck = codes.includes('R01');
  const priority = SEVERITY_LABELS[severity] ?? 'MECP';
  const label = codes.includes('D02')
    ? 'TEST ONLY'
    : codes.includes('D01')
      ? 'DRILL ONLY'
      : isAck
        ? `${priority} ACK`
        : priority;
  // Other ACK codes describe the original report, not actions by the acknowledging station.
  const summaryCodes = isAck
    ? codes.filter((code) => code === 'R01' || code === 'D01' || code === 'D02')
    : codes;
  const meanings = summaryCodes.map((code) => {
    if (code === 'R01') return 'Received';
    if (code === 'B02') return 'Beacon received';
    return ENGLISH_CODES[code] ?? code;
  });
  return meanings.length > 0 ? `[${label}: ${meanings.join('; ')}]` : `[${label}]`;
}

/** Keep the structured fields first so existing decoders retain R03's leading ETA. */
export function encodeReadableMecp(
  severity: Severity,
  codes: string[],
  freetext?: string,
  maxBytes = MAX_MESSAGE_BYTES,
): EncodeResult {
  const summary = readableSummary(severity, codes);
  const result = encode(severity, codes, [freetext?.trim(), summary].filter(Boolean).join(' '));
  const byteLimit = Math.min(MAX_MESSAGE_BYTES, maxBytes);
  const overLimit = result.byteLength > byteLimit;
  const warnings = [...result.warnings];
  if (overLimit && byteLimit < MAX_MESSAGE_BYTES) {
    warnings.push(`Message is ${result.byteLength} bytes, exceeds ${byteLimit} byte limit`);
  }
  return { ...result, overLimit, warnings };
}

/** Remove only this report's generated tail, preserving independent operator details. */
export function stripMecpReadableSummary(
  freetext: string,
  severity: number,
  codes: readonly string[],
): string {
  const summaryWords = readableSummary(severity, codes).toLowerCase().split(/\s+/);
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
