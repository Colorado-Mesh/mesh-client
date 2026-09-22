// Vendored from https://github.com/xiang-dev-1/MECP (GPLv3). Do not edit without attribution.

/**
 * MECP Engine — Type Definitions
 * Mesh Emergency Communication Protocol
 *
 * Pure type definitions. No runtime code.
 */

/** Severity levels: 0=MAYDAY, 1=URGENT, 2=SAFETY, 3=ROUTINE */
export type Severity = 0 | 1 | 2 | 3;

/** All valid category letters */
export type CategoryLetter = 'M' | 'T' | 'W' | 'S' | 'P' | 'C' | 'R' | 'D' | 'L' | 'X' | 'H' | 'B';

/** Result of parsing an MECP message string */
export interface ParsedMessage {
  /** Whether the message was successfully parsed as MECP */
  valid: boolean;
  /** Severity level (0-3) or null if invalid/missing */
  severity: Severity | null;
  /** Array of recognized code strings (e.g., ["M01", "M07", "P05"]) */
  codes: string[];
  /** True if D01 or D02 is present — suppresses all alerts */
  isDrill: boolean;
  /** Everything after the last recognized code, or null */
  freetext: string | null;
  /** Structured data extracted from freetext */
  extracted: {
    /** Person/casualty count from Npax pattern */
    count: number | null;
    /** GPS coordinates from lat,lon pattern */
    gps: { lat: number; lon: number } | null;
    /** ETA in minutes (bare integer after R03) */
    eta: number | null;
    /** Incident reference tag from #tag pattern */
    reference: string | null;
    /** Sender language hint from @xx pattern (ISO 639-1) */
    language: string | null;
    /** Composition timestamp from @HHMM pattern (UTC) */
    timestamp: string | null;
    /** Sender callsign from ~CALLSIGN pattern */
    callsign: string | null;
  };
  /** Parse warnings (e.g., invalid severity, unknown codes) */
  warnings: string[];
  /** Original raw input string */
  raw: string;
}

/** Result of encoding an MECP message */
export interface EncodeResult {
  /** The encoded MECP string */
  message: string;
  /** Total byte length (UTF-8) */
  byteLength: number;
  /** Whether the message exceeds 200 bytes */
  overLimit: boolean;
  /** Warnings (e.g., message too long) */
  warnings: string[];
}

/** Validation result for a raw MECP string */
export interface ValidationResult {
  /** Whether the string is valid MECP */
  valid: boolean;
  /** Array of validation errors */
  errors: string[];
  /** Array of validation warnings */
  warnings: string[];
}

/** Severity definition within a language file */
export interface SeverityDef {
  /** Localized label */
  local: string;
  /** Combined label (e.g., "URGENT / NALIEHAVÉ") */
  label: string;
}

/** Category definition within a language file */
export interface CategoryDef {
  /** Localized category name */
  name: string;
  /** Icon identifier */
  icon: string;
}

/** Complete language file structure */
export interface LanguageFile {
  /** ISO 639-1 language code */
  language: string;
  /** Language name in its own script */
  language_name: string;
  /** Language name in English */
  language_name_en: string;
  /** Language name in Latin script (for non-Latin scripts) */
  language_name_latin: string;
  /** Flag emoji */
  flag_emoji: string;
  /** Text direction: "ltr" or "rtl" */
  text_direction: 'ltr' | 'rtl';
  /** Severity level definitions */
  severities: Record<string, SeverityDef>;
  /** Category definitions */
  categories: Record<string, CategoryDef>;
  /** Code translations: code -> localized text */
  codes: Record<string, string>;
  /** UI string translations */
  ui: Record<string, string>;
  /** Deprecation notices for codes */
  deprecations: Record<string, string>;
}

/** Maximum MECP message size in bytes (UTF-8) */
export const MAX_MESSAGE_BYTES = 200;

/** MECP message prefix */
export const MECP_PREFIX = 'MECP/';

/** Code regex: one uppercase letter followed by two digits */
export const CODE_REGEX = /^[A-Z]\d{2}$/;

/** Valid severity values */
export const VALID_SEVERITIES: Severity[] = [0, 1, 2, 3];

/** Category configuration with icons */
export const CATEGORIES: Record<CategoryLetter, { icon: string; order: number }> = {
  M: { icon: 'medical', order: 0 },
  T: { icon: 'terrain', order: 1 },
  W: { icon: 'weather', order: 2 },
  S: { icon: 'supplies', order: 3 },
  P: { icon: 'position', order: 4 },
  C: { icon: 'coordination', order: 5 },
  R: { icon: 'response', order: 6 },
  D: { icon: 'drill', order: 7 },
  L: { icon: 'leisure', order: 8 },
  X: { icon: 'threat', order: 9 },
  H: { icon: 'resources', order: 10 },
  B: { icon: 'beacon', order: 11 },
};
