import { https } from './http';

export const {
  request,
  get,
  Agent,
  globalAgent,
  createServer,
  IncomingMessage,
  ClientRequest,
  STATUS_CODES,
  METHODS,
} = https;
export default https;
