/**
 * Meshtastic Long Name budget (UTF-8 bytes, not JS string length).
 *
 * Firmware 2.8 truncates `User.long_name` to 24 bytes before storing or rebroadcasting; older
 * senders may still send up to 39 bytes, so only outbound writes are enforced.
 */
export const MESHTASTIC_LONG_NAME_MAX_UTF8_BYTES = 24;

const utf8Encoder = new TextEncoder();

export function meshtasticLongNameUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

/** Keep leading codepoints whose combined UTF-8 length fits the firmware limit. */
export function truncateMeshtasticLongName(text: string): string {
  let bytes = 0;
  let result = '';
  for (const ch of text) {
    const chBytes = utf8Encoder.encode(ch).length;
    if (bytes + chBytes > MESHTASTIC_LONG_NAME_MAX_UTF8_BYTES) break;
    bytes += chBytes;
    result += ch;
  }
  return result;
}

export type MeshtasticLongNameValidationIssue = 'tooLong';

export const MESHTASTIC_LONG_NAME_VALIDATION_I18N_KEYS: Record<
  MeshtasticLongNameValidationIssue,
  string
> = {
  tooLong: 'radioPanel.validationLongNameTooLong',
};

export function validateMeshtasticLongName(text: string): MeshtasticLongNameValidationIssue | null {
  return meshtasticLongNameUtf8ByteLength(text) > MESHTASTIC_LONG_NAME_MAX_UTF8_BYTES
    ? 'tooLong'
    : null;
}

export class MeshtasticLongNameValidationError extends Error {
  readonly i18nKey: string;

  constructor(issue: MeshtasticLongNameValidationIssue) {
    const i18nKey = MESHTASTIC_LONG_NAME_VALIDATION_I18N_KEYS[issue];
    super(i18nKey);
    this.name = 'MeshtasticLongNameValidationError';
    this.i18nKey = i18nKey;
  }
}

export function assertMeshtasticLongNameValid(text: string): void {
  const issue = validateMeshtasticLongName(text);
  if (issue) throw new MeshtasticLongNameValidationError(issue);
}
