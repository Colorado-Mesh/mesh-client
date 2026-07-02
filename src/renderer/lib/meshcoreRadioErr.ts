import type { DiagnosticTextI18n } from './types';

/** meshcore.js Constants.ErrorCodes */
export const MESHCORE_RADIO_ERR_UNSUPPORTED_CMD = 1;
export const MESHCORE_RADIO_ERR_NOT_FOUND = 2;
export const MESHCORE_RADIO_ERR_TABLE_FULL = 3;
export const MESHCORE_RADIO_ERR_BAD_STATE = 4;
export const MESHCORE_RADIO_ERR_FILE_IO = 5;
export const MESHCORE_RADIO_ERR_ILLEGAL_ARG = 6;

export function meshcoreRadioErrMessage(errCode: number | null | undefined): DiagnosticTextI18n {
  switch (errCode) {
    case MESHCORE_RADIO_ERR_BAD_STATE:
      return { key: 'meshcore.errors.roomPost.badState' };
    case MESHCORE_RADIO_ERR_ILLEGAL_ARG:
      return { key: 'meshcore.errors.roomPost.illegalArg' };
    case MESHCORE_RADIO_ERR_NOT_FOUND:
      return { key: 'meshcore.errors.roomPost.notFound' };
    case MESHCORE_RADIO_ERR_UNSUPPORTED_CMD:
      return { key: 'meshcore.errors.roomPost.unsupportedCmd' };
    default:
      return { key: 'meshcore.errors.roomPost.default' };
  }
}
