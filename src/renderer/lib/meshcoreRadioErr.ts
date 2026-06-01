/** meshcore.js Constants.ErrorCodes */
export const MESHCORE_RADIO_ERR_UNSUPPORTED_CMD = 1;
export const MESHCORE_RADIO_ERR_NOT_FOUND = 2;
export const MESHCORE_RADIO_ERR_TABLE_FULL = 3;
export const MESHCORE_RADIO_ERR_BAD_STATE = 4;
export const MESHCORE_RADIO_ERR_FILE_IO = 5;
export const MESHCORE_RADIO_ERR_ILLEGAL_ARG = 6;

export function meshcoreRadioErrMessage(errCode: number | null | undefined): string {
  switch (errCode) {
    case MESHCORE_RADIO_ERR_BAD_STATE:
      return 'Room post rejected (not logged in on the radio). Log out, log in again, then retry.';
    case MESHCORE_RADIO_ERR_ILLEGAL_ARG:
      return 'Room post rejected (invalid message format).';
    case MESHCORE_RADIO_ERR_NOT_FOUND:
      return 'Room post rejected (room contact not found on the radio).';
    case MESHCORE_RADIO_ERR_UNSUPPORTED_CMD:
      return 'Room post rejected (unsupported message type on the radio). Log in to the room, then retry.';
    default:
      return 'Room post rejected by the radio. Log out, log in again, then retry.';
  }
}
