/** Meshtastic firmware Short Name field size (UTF-8 bytes, not JS string length). */
export const MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES = 4;

const utf8Encoder = new TextEncoder();

export function meshtasticShortNameUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

function takeCodepointsWithinUtf8ByteBudget(text: string, byteBudget: number): string {
  let bytes = 0;
  let result = '';
  for (const ch of text) {
    const chBytes = utf8Encoder.encode(ch).length;
    if (result.length > 0 && bytes + chBytes > byteBudget) break;
    bytes += chBytes;
    result += ch;
  }
  return result;
}

/** Keep leading codepoints whose combined UTF-8 length fits the firmware limit. */
export function truncateMeshtasticShortName(text: string): string {
  return takeCodepointsWithinUtf8ByteBudget(text, MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES);
}

export type MeshtasticShortNameValidationIssue = 'tooLong' | 'codepointTooLarge';

export const MESHTASTIC_SHORT_NAME_VALIDATION_I18N_KEYS: Record<
  MeshtasticShortNameValidationIssue,
  string
> = {
  tooLong: 'radioPanel.validationShortNameTooLong',
  codepointTooLarge: 'radioPanel.validationShortNameEmojiTooLarge',
};

export function validateMeshtasticShortName(
  text: string,
): MeshtasticShortNameValidationIssue | null {
  if (text === '') return null;

  const byteLen = meshtasticShortNameUtf8ByteLength(text);
  if (byteLen > MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES) return 'tooLong';

  for (const ch of text) {
    if (utf8Encoder.encode(ch).length > MESHTASTIC_SHORT_NAME_MAX_UTF8_BYTES) {
      return 'codepointTooLarge';
    }
  }
  return null;
}

export class MeshtasticShortNameValidationError extends Error {
  readonly i18nKey: string;

  constructor(issue: MeshtasticShortNameValidationIssue) {
    const i18nKey = MESHTASTIC_SHORT_NAME_VALIDATION_I18N_KEYS[issue];
    super(i18nKey);
    this.name = 'MeshtasticShortNameValidationError';
    this.i18nKey = i18nKey;
  }
}

export function assertMeshtasticShortNameValid(text: string): void {
  const issue = validateMeshtasticShortName(text);
  if (issue) throw new MeshtasticShortNameValidationError(issue);
}
