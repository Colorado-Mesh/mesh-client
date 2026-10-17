import {
  AI_MAX_MAX_COLLECTED_MESSAGES,
  AI_MAX_MESSAGES,
  AI_MAX_TIMEOUT_SECONDS,
  AI_MAX_TOTAL_CHARS,
  AI_MIN_MAX_COLLECTED_MESSAGES,
  AI_MIN_TIMEOUT_SECONDS,
  type AiEndpointConfig,
  type AiSummaryPassMode,
  type AiSummaryRequest,
} from '../../shared/ai-types';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, cap: number): value is string =>
  typeof value === 'string' && value.length <= cap;
const PASS_MODES: AiSummaryPassMode[] = ['map', 'reduce', 'final'];
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
    (value.timeoutSeconds !== undefined &&
      (typeof value.timeoutSeconds !== 'number' ||
        !Number.isInteger(value.timeoutSeconds) ||
        value.timeoutSeconds < AI_MIN_TIMEOUT_SECONDS ||
        value.timeoutSeconds > AI_MAX_TIMEOUT_SECONDS)) ||
    (value.maxCollectedMessages !== undefined &&
      (typeof value.maxCollectedMessages !== 'number' ||
        !Number.isInteger(value.maxCollectedMessages) ||
        value.maxCollectedMessages < AI_MIN_MAX_COLLECTED_MESSAGES ||
        value.maxCollectedMessages > AI_MAX_MAX_COLLECTED_MESSAGES)) ||
    (value.apiKey !== undefined && !text(value.apiKey, 4096)) ||
    (value.allowRemote !== undefined && typeof value.allowRemote !== 'boolean') ||
    (value.localModelId != null && !text(value.localModelId, 128))
  )
    throw new Error('Invalid AI configuration');
  const endpoint = value.engine === 'local' || value.engine === 'remote';
  return {
    engine: value.engine as AiEndpointConfig['engine'],
    ...(value.timeoutSeconds !== undefined ? { timeoutSeconds: value.timeoutSeconds } : {}),
    ...(value.maxCollectedMessages !== undefined
      ? { maxCollectedMessages: value.maxCollectedMessages }
      : {}),
    ...(endpoint
      ? {
          wireFormat: value.wireFormat as AiEndpointConfig['wireFormat'],
          baseUrl: value.baseUrl as string,
          model: value.model as string,
          ...(value.apiKey !== undefined ? { apiKey: value.apiKey } : {}),
          ...(value.allowRemote !== undefined ? { allowRemote: value.allowRemote } : {}),
        }
      : {}),
    ...(value.localModelId !== undefined ? { localModelId: value.localModelId } : {}),
  };
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
  if (
    (value.jobId !== undefined && (!text(value.jobId, 128) || !value.jobId)) ||
    (value.mode !== undefined &&
      (typeof value.mode !== 'string' || !PASS_MODES.includes(value.mode as AiSummaryPassMode)))
  )
    throw new Error('Invalid AI summary request');
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
  return {
    ...(value as unknown as AiSummaryRequest),
    messages,
    ...(value.jobId !== undefined ? { jobId: value.jobId } : {}),
    ...(value.mode !== undefined ? { mode: value.mode as AiSummaryPassMode } : {}),
  };
}
