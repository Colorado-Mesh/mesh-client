// Adapted from https://github.com/mecp-org/mecp-app (GPLv3). Do not edit without attribution.

/**
 * MECP Encoder — Composes structured data into MECP message strings.
 *
 * Pure function: structured data in, string out. No I/O, no side effects.
 */

import type { EncodeResult, Severity } from './types';
import { CODE_REGEX, MAX_MESSAGE_BYTES, MECP_PREFIX, VALID_SEVERITIES } from './types';

/**
 * Get the UTF-8 byte length of a string.
 */
export function getByteLength(str: string): number {
  // TextEncoder is available in modern browsers and Node.js
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  // Fallback: manual UTF-8 byte counting
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair (4 bytes for the pair)
      bytes += 4;
      i++; // skip next char
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Encode an MECP message from structured components.
 *
 * @param severity - Severity level (0-3)
 * @param codes - Array of code strings (e.g., ["M01", "M07"])
 * @param freetext - Optional freetext (GPS, counts, notes)
 * @returns EncodeResult with the message string and metadata
 */
export function encode(severity: Severity, codes: string[], freetext?: string): EncodeResult {
  const warnings: string[] = [];

  // Validate severity
  if (!VALID_SEVERITIES.includes(severity)) {
    warnings.push(`Invalid severity: ${severity}`);
  }

  // Validate codes
  for (const code of codes) {
    if (!CODE_REGEX.test(code)) {
      warnings.push(`Invalid code format: "${code}"`);
    }
  }

  // Build message
  let message = `${MECP_PREFIX}${severity}/${codes.join(' ')}`;

  if (freetext && freetext.trim().length > 0) {
    message += ` ${freetext.trim()}`;
  }

  // Trim trailing whitespace
  message = message.trimEnd();

  const byteLength = getByteLength(message);
  const overLimit = byteLength > MAX_MESSAGE_BYTES;

  if (overLimit) {
    warnings.push(`Message is ${byteLength} bytes, exceeds ${MAX_MESSAGE_BYTES} byte limit`);
  }

  return { message, byteLength, overLimit, warnings };
}

/**
 * Validate a raw MECP string.
 *
 * @param input - Raw MECP string to validate
 * @returns ValidationResult
 */
