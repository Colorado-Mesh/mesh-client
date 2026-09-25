// Vendored from https://github.com/xiang-dev-1/MECP (GPLv3). Do not edit without attribution.

/**
 * MECP Engine — Mesh Emergency Communication Protocol
 *
 * Pure TypeScript encoder/decoder for MECP messages.
 * No I/O, no platform dependencies, no side effects.
 */

export { decode, getCategory, isBeacon, isBeaconAck, isBeaconCancel, isMECP } from './decoder';
export { encode, getByteLength, validate } from './encoder';
export type {
  CategoryDef,
  CategoryLetter,
  EncodeResult,
  LanguageFile,
  ParsedMessage,
  Severity,
  SeverityDef,
  ValidationResult,
} from './types';
export { CATEGORIES, CODE_REGEX, MAX_MESSAGE_BYTES, MECP_PREFIX, VALID_SEVERITIES } from './types';
