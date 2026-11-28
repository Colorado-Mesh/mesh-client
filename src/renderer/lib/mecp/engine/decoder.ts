// Adapted from https://github.com/mecp-org/mecp-app (GPLv3). Freetext conventions
// follow MECP 1.4.1 from https://github.com/mecp-org/MECP. Do not edit without attribution.

/**
 * MECP Decoder — Parses MECP message strings into structured data.
 *
 * Implements the decoding algorithm from the protocol specification.
 * Pure function: string in, ParsedMessage out. No I/O, no side effects.
 */

import { extractFreetextConventions, matchMessageEnvelope } from './freetextExtract';
import type { ParsedMessage, Severity } from './types';
import { MECP_PREFIX, VALID_SEVERITIES } from './types';

/**
 * Decode an MECP message string into a structured ParsedMessage.
 *
 * Validity is gated on the §6.1 message envelope (after stripping one trailing
 * CR/LF). Oversize messages that still match the envelope remain valid.
 *
 * @param input - Raw message string (may or may not be MECP)
 * @returns ParsedMessage with all fields populated
 */
export function decode(input: string): ParsedMessage {
  const result: ParsedMessage = {
    valid: false,
    severity: null,
    codes: [],
    isDrill: false,
    freetext: null,
    extracted: {
      count: null,
      gps: null,
      duration: null,
      durationToken: null,
      reference: null,
      language: null,
      timestamp: null,
      callsign: null,
      appDesignator: null,
    },
    warnings: [],
    raw: input,
  };

  const env = matchMessageEnvelope(input);
  if (!env) {
    // Envelope failed (trailing space, interior line break, etc.): not valid MECP.
    if (!input.startsWith(MECP_PREFIX)) return result;
    const severityChar = input.charAt(5);
    const severityNum = parseInt(severityChar, 10);
    if (VALID_SEVERITIES.includes(severityNum as Severity)) {
      result.severity = severityNum as Severity;
      result.warnings.push('Message does not match MECP envelope');
    }
    return result;
  }

  const severityNum = parseInt(env.severity, 10);
  if (VALID_SEVERITIES.includes(severityNum as Severity)) {
    result.severity = severityNum as Severity;
  } else {
    result.warnings.push(`Invalid severity: "${env.severity}"`);
    return result;
  }

  result.codes = env.codes;
  result.freetext = env.freetext.length > 0 ? env.freetext : null;

  // MECP 1.4.1 §6.1 freetext conventions
  result.extracted = extractFreetextConventions(env.freetext, env.codes);

  // Only D01 and D02 set isDrill. D03 and D04 do NOT.
  result.isDrill = result.codes.includes('D01') || result.codes.includes('D02');

  result.valid = true;
  return result;
}

/**
 * Get the category letter from a code string.
 * @param code - e.g., "M01"
 * @returns The category letter, e.g., "M"
 */
/**
 * Check if codes contain B01 (automated distress beacon active).
 */
export function isBeacon(codes: string[]): boolean {
  return codes.includes('B01');
}

/**
 * Check if codes contain B02 (beacon acknowledged).
 */
export function isBeaconAck(codes: string[]): boolean {
  return codes.includes('B02');
}

/**
 * Check if codes contain B03 (cancel beacon).
 */
export function isBeaconCancel(codes: string[]): boolean {
  return codes.includes('B03');
}
