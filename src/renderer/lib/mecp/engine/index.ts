// Adapted from https://github.com/mecp-org/mecp-app (GPLv3). Freetext conventions
// follow MECP 1.4.1 from https://github.com/mecp-org/MECP. Do not edit without attribution.

/**
 * MECP Engine — Mesh Emergency Communication Protocol
 *
 * Pure TypeScript encoder/decoder for MECP messages.
 * No I/O, no platform dependencies, no side effects.
 */

export { decode, isBeacon, isBeaconAck, isBeaconCancel } from './decoder';
export { encode, getByteLength } from './encoder';
export type { CategoryLetter, EncodeResult, LanguageFile, ParsedMessage, Severity } from './types';
export { CATEGORIES, CODE_REGEX, MAX_MESSAGE_BYTES, MECP_PROTOCOL_VERSION } from './types';
