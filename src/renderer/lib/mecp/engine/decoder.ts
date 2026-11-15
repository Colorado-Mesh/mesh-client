// Adapted from https://github.com/mecp-org/mecp-app (GPLv3). Freetext conventions
// follow MECP 1.2.1 from https://github.com/mecp-org/MECP. Do not edit without attribution.

/**
 * MECP Decoder — Parses MECP message strings into structured data.
 *
 * Implements the decoding algorithm from the protocol specification.
 * Pure function: string in, ParsedMessage out. No I/O, no side effects.
 */

import { extractFreetextConventions } from './freetextExtract';
import type { ParsedMessage, Severity } from './types';
import { CODE_REGEX, MECP_PREFIX, VALID_SEVERITIES } from './types';

/**
 * Decode an MECP message string into a structured ParsedMessage.
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
      reference: null,
      language: null,
      timestamp: null,
      callsign: null,
    },
    warnings: [],
    raw: input,
  };

  // Step 1: Check MECP prefix (case-sensitive)
  if (!input.startsWith(MECP_PREFIX)) {
    return result;
  }

  // Step 2: Extract severity (character at index 5)
  const severityChar = input.charAt(5);
  const severityNum = parseInt(severityChar, 10);

  if (VALID_SEVERITIES.includes(severityNum as Severity)) {
    result.severity = severityNum as Severity;
  } else {
    result.warnings.push(`Invalid severity: "${severityChar}"`);
  }

  // Step 3: Check delimiter at index 6
  if (input.charAt(6) !== '/') {
    result.warnings.push('Missing "/" delimiter after severity');
    // Attempt to continue
  }

  // Step 4: Extract codes+freetext block (from index 7 onward)
  const body = input.substring(7);

  if (!body || body.trim().length === 0) {
    result.valid = result.severity !== null;
    if (result.valid) {
      result.warnings.push('No codes present');
    }
    return result;
  }

  // Step 5: Tokenize by spaces, left-to-right
  const tokens = body.split(' ').filter((t) => t.length > 0);
  let freetextStartIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (CODE_REGEX.test(token)) {
      result.codes.push(token);
    } else {
      // This token and everything after is freetext
      freetextStartIndex = i;
      break;
    }
  }

  // Collect freetext (preserve original spacing after the first non-code token)
  if (freetextStartIndex >= 0) {
    // Rebuild from the original body so punctuation/spacing in freetext is preserved
    let consumed = 0;
    for (let i = 0; i < freetextStartIndex; i++) {
      const tok = tokens[i];
      const at = body.indexOf(tok, consumed);
      consumed = at + tok.length;
      while (body.charAt(consumed) === ' ') consumed++;
    }
    result.freetext = body.slice(consumed).trimEnd();
    if (result.freetext.length === 0) result.freetext = null;
  }

  // Step 6: Extract structured patterns from freetext (MECP 1.2.1 §6.1)
  const extracted = extractFreetextConventions(result.freetext || '', result.codes);
  result.extracted = extracted;

  // Step 7: Drill detection
  // Only D01 and D02 set isDrill. D03 and D04 do NOT.
  result.isDrill = result.codes.includes('D01') || result.codes.includes('D02');

  // Mark as valid if we got at least a severity
  result.valid = result.severity !== null;

  return result;
}

/**
 * Check if a string is an MECP message (starts with "MECP/")
 */
export function isMECP(input: string): boolean {
  return input.startsWith(MECP_PREFIX);
}

/**
 * Get the category letter from a code string.
 * @param code - e.g., "M01"
 * @returns The category letter, e.g., "M"
 */
export function getCategory(code: string): string {
  return code.charAt(0);
}

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
