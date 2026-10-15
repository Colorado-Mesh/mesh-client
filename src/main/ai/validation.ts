import {
  AI_MAX_MESSAGES,
  AI_MAX_TOTAL_CHARS,
  type AiEndpointConfig,
  type AiSummaryRequest,
} from '../../shared/ai-types';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, cap: number): value is string =>
  typeof value === 'string' && value.length <= cap;
export function validateAiConfig(value: unknown): AiEndpointConfig {
  if (
    !record(value) ||
    typeof value.engine !== 'string' ||
    !['os', 'bundled', 'local', 'remote'].includes(value.engine)
  )
    throw new Error('Invalid AI engine');
  if (value.engine === 'local' || value.engine === 'remote') {
    if (
      typeof value.wireFormat !== 'string' ||
      !['openai', 'anthropic', 'gemini', 'ollama'].includes(value.wireFormat) ||
      !text(value.baseUrl, 2048) ||
      !text(value.model, 256)
    )
      throw new Error('Invalid AI endpoint configuration');
  }
  if (
    (value.apiKey !== undefined && !text(value.apiKey, 4096)) ||
    (value.allowRemote !== undefined && typeof value.allowRemote !== 'boolean') ||
    (value.localModelId != null && !text(value.localModelId, 128))
  )
    throw new Error('Invalid AI configuration');
  return value as unknown as AiEndpointConfig;
}
export function validateAiRequest(value: unknown): AiSummaryRequest {
  if (
    !record(value) ||
    !text(value.requestId, 128) ||
    !value.requestId ||
    !text(value.conversationLabel, 256) ||
    !text(value.locale, 64) ||
    typeof value.protocol !== 'string' ||
    !['meshtastic', 'meshcore', 'reticulum'].includes(value.protocol) ||
    typeof value.surface !== 'string' ||
    !['channel', 'dm', 'room', 'rrc'].includes(value.surface) ||
    !record(value.scope) ||
    typeof value.scope.kind !== 'string' ||
    !['unread', 'loaded', 'hours'].includes(value.scope.kind)
  )
    throw new Error('Invalid AI summary request');
  if (
    value.scope.kind === 'hours' &&
    (typeof value.scope.hours !== 'number' ||
      !Number.isFinite(value.scope.hours) ||
      value.scope.hours <= 0 ||
      value.scope.hours > 8760)
  )
    throw new Error('Invalid AI hours');
  if (!Array.isArray(value.messages) || value.messages.length > AI_MAX_MESSAGES)
    throw new Error('Invalid AI messages');
  let chars = 0;
  const messages = value.messages.map((message: unknown) => {
    if (
      !record(message) ||
      !text(message.body, AI_MAX_TOTAL_CHARS) ||
      !text(message.sender, 120) ||
      typeof message.at !== 'number' ||
      !Number.isFinite(message.at) ||
      message.at < 0 ||
      message.at > 8.64e15
    )
      throw new Error('Invalid AI message');
    chars += message.body.length;
    if (chars > AI_MAX_TOTAL_CHARS) throw new Error('Invalid AI message size');
    return {
      at: message.at,
      sender: message.sender,
      // eslint-disable-next-line no-control-regex -- strip nonprinting controls from untrusted transcript text
      body: message.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''),
    };
  });
  return { ...(value as unknown as AiSummaryRequest), messages };
}
