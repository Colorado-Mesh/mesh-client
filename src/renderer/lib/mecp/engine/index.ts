// Adapted from https://github.com/mecp-org/mecp-app (GPLv3). Freetext conventions
// follow MECP 1.3.0 from https://github.com/mecp-org/MECP. Do not edit without attribution.

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
export {
  CATEGORIES,
  CODE_REGEX,
  MAX_MESSAGE_BYTES,
  MECP_PREFIX,
  MECP_PROTOCOL_VERSION,
  VALID_SEVERITIES,
} from './types';
