// Vendored from https://github.com/xiang-dev-1/MECP (GPLv3). Do not edit without attribution.

/**
 * MECP Decoder — Parses MECP message strings into structured data.
 *
 * Implements the decoding algorithm from the protocol specification.
 * Pure function: string in, ParsedMessage out. No I/O, no side effects.
 */

import type { ParsedMessage, Severity } from './types';
import { CODE_REGEX, MECP_PREFIX, VALID_SEVERITIES } from './types';

/** Regex patterns for freetext extraction */
const PATTERNS = {
  count: /(\d+)pax/,
  gps: /(-?\d+\.\d+),(-?\d+\.\d+)/,
  reference: /#([A-Za-z0-9]{1,4})/,
  languageHint: /@([a-z]{2})(?:\s|$)/,
  timestamp: /@(\d{4})(?:\s|$)/,
  callsign: /~([A-Za-z0-9]{1,9})(?:\s|$)/,
};

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
      eta: null,
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
    if (CODE_REGEX.test(tokens[i])) {
      result.codes.push(tokens[i]);
    } else {
      // This token and everything after is freetext
      freetextStartIndex = i;
      break;
    }
  }

  // Collect freetext
  if (freetextStartIndex >= 0) {
    result.freetext = tokens.slice(freetextStartIndex).join(' ');
  }

  // Step 6: Extract structured patterns from freetext
  const textToSearch = result.freetext || '';

  // 6a: Person count (Npax)
  const countMatch = PATTERNS.count.exec(textToSearch);
  if (countMatch) {
    result.extracted.count = parseInt(countMatch[1], 10);
  }

  // 6b: GPS coordinates
  const gpsMatch = PATTERNS.gps.exec(textToSearch);
  if (gpsMatch) {
    const lat = parseFloat(gpsMatch[1]);
    const lon = parseFloat(gpsMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      result.extracted.gps = { lat, lon };
    }
  }

  // 6c: ETA (bare integer after R03)
  if (result.codes.includes('R03') && result.freetext) {
    const etaMatch = /^(\d+)(?:\s|$)/.exec(result.freetext);
    if (etaMatch) {
      result.extracted.eta = parseInt(etaMatch[1], 10);
    }
  }

  // 6d: Incident reference tag (#tag)
  const refMatch = PATTERNS.reference.exec(textToSearch);
  if (refMatch) {
    result.extracted.reference = refMatch[1];
  }

  // 6e: Sender language hint (@xx — two lowercase letters)
  const langMatch = PATTERNS.languageHint.exec(textToSearch);
  if (langMatch) {
    result.extracted.language = langMatch[1];
  }

  // 6f: Composition timestamp (@HHMM — four digits)
  const tsMatch = PATTERNS.timestamp.exec(textToSearch);
  if (tsMatch) {
    const hh = parseInt(tsMatch[1].substring(0, 2), 10);
    const mm = parseInt(tsMatch[1].substring(2, 4), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      result.extracted.timestamp = tsMatch[1];
    }
  }

  // 6g: Sender callsign (~CALLSIGN)
  const csMatch = PATTERNS.callsign.exec(textToSearch);
  if (csMatch) {
    result.extracted.callsign = csMatch[1];
  }

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
