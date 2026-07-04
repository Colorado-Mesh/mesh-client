/** meshcore.js ResponseCodes */
export const MC_RESP_OK = 0;
export const MC_RESP_ERR = 1;
export const MC_RESP_SENT = 6;

/** meshcore.js PushCodes */
export const MC_PUSH_LOGIN_SUCCESS = 0x85;
export const MC_PUSH_LOGIN_FAIL = 0x86;
export const MC_PUSH_STATUS_RESPONSE = 0x87;
export const MC_PUSH_TELEMETRY_RESPONSE = 0x8b;

/** meshcore.js CommandCodes */
export const MC_CMD_SEND_TXT_MSG = 2;
export const MC_CMD_SEND_LOGIN = 26;
export const MC_CMD_SEND_STATUS_REQ = 27;
export const MC_CMD_LOGOUT = 29;
export const MC_CMD_SEND_TELEMETRY_REQ = 39;
