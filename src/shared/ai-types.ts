import type { AiHistoryMessage, AiHistoryQuery } from './ai-history';

export type AiWireFormat = 'openai' | 'anthropic' | 'gemini' | 'ollama';
/** The engine the user picked. `local` and `remote` both use the endpoint adapters above. */
export type AiEngine = 'os' | 'bundled' | 'local' | 'remote';
export type AiOsAiPlatform = 'apple-foundation-models' | 'windows-ai-foundry';

export interface AiSummaryMessage {
  /** epoch ms */
  at: number;
  /** display name, already truncated; may be empty */
  sender: string;
  /** message text */
  body: string;
}

export type AiSummaryScope =
  { kind: 'unread' } | { kind: 'hours'; hours: number } | { kind: 'loaded' };

export interface AiSummaryRequest {
  /** Unique per call; used to correlate stream events and cancellation. */
  requestId: string;
  /** Conversation label shown to the model, e.g. "#general", "DM with KX4ABC", "Room: NodeChat". */
  conversationLabel: string;
  protocol: 'meshtastic' | 'meshcore' | 'reticulum';
  surface: 'channel' | 'dm' | 'room' | 'rrc';
  /** UI locale (BCP-47) so the summary comes back in the user's language. */
  locale: string;
  messages: AiSummaryMessage[];
  scope: AiSummaryScope;
}

export interface AiSummaryChunk {
  requestId: string;
  delta: string;
}
export interface AiSummaryDone {
  requestId: string;
  text: string;
  provider: string;
  model: string;
  messageCount: number;
  truncated: boolean;
}
export interface AiSummaryError {
  requestId: string;
  reason: AiSummaryErrorReason;
  detail?: string;
}

export type AiSummaryErrorReason =
  | 'disabled'
  | 'noMessages'
  | 'notConfigured'
  | 'engineNotReady'
  | 'remoteNotAcknowledged'
  | 'rateLimited'
  | 'busy'
  | 'timeout'
  | 'tooLarge'
  | 'httpError'
  | 'invalidResponse'
  | 'repetitiveOutput'
  | 'cancelled'
  | 'error';

export interface AiOsAiStatus {
  /** true when this OS exposes an on-device LLM API and the probe succeeded */
  available: boolean;
  platform: AiOsAiPlatform | null;
  /** populated when available === false */
  reason?: 'unsupported-platform' | 'os-too-old' | 'not-enabled' | 'hardware' | 'probe-failed';
  /** e.g. 'Apple Intelligence' / 'Phi Silica' */
  modelLabel?: string;
}

export interface AiProviderStatus {
  enabled: boolean;
  engine: AiEngine | null;
  /** only for engine 'local' | 'remote' */
  wireFormat: AiWireFormat | null;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  allowRemote: boolean;
  /** true when the configured endpoint is non-local */
  isRemote: boolean;
  /** bundled engine state */
  localEngine: { ready: boolean; modelId: string | null; downloading: boolean };
  /** OS-AI engine state (probe result; computed only while enabled / while settings are open) */
  osAi: AiOsAiStatus;
}

export interface AiEndpointConfig {
  engine: AiEngine;
  /** required for engine 'local' | 'remote' */
  wireFormat?: AiWireFormat;
  baseUrl?: string;
  model?: string;
  /** Omit to preserve the stored key; empty string clears it. Never returned over IPC. */
  apiKey?: string;
  /** required true to use engine 'remote' */
  allowRemote?: boolean;
  /** required for engine 'bundled'; null clears the selection */
  localModelId?: string | null;
}

export interface AiModelInfo {
  id: string;
  name: string;
  paramsLabel: string;
  downloadBytes: number;
  diskBytes: number;
  license: string;
  qualityNote: 'compact' | 'multilingual' | 'english';
  installed: boolean;
}

export interface AiModelProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'queued' | 'downloading' | 'verifying' | 'installed' | 'cancelled' | 'error';
}

export interface AiLocalJob {
  modelUrl: string;
  system: string;
  user: string;
  messageCount: number;
  truncated: boolean;
  model: string;
}

export interface AiActionResult {
  localJob?: AiLocalJob;
  /** Actual prepared prompt coverage, before generation starts. */
  summaryInput?: { messageCount: number; truncated: boolean };
  ok: boolean;
  reason?: string;
}

/** Limits enforced in main before any request is made. */
export const AI_MAX_MESSAGES = 500;
export const AI_MAX_TOTAL_CHARS = 200_000;
export const AI_MAX_OUTPUT_TOKENS = 250;
export const AI_MAX_RESPONSE_BYTES = 256 * 1024;
export const AI_REQUEST_TIMEOUT_MS = 60_000;
/** CPU WASM also needs time to load and evaluate the downloaded model. */
export const AI_LOCAL_REQUEST_TIMEOUT_MS = 5 * 60_000;

export interface AiAPI {
  getHistory: (query: AiHistoryQuery) => Promise<AiHistoryMessage[]>;
  onStatusChanged: (cb: (status: AiProviderStatus) => void) => () => void;
  getStatus: () => Promise<AiProviderStatus>;
  setEnabled: (enabled: boolean) => Promise<AiProviderStatus>;
  /** Probe the OS on-device model. Called only while the AI settings section is open. */
  probeOsAi: () => Promise<AiOsAiStatus>;
  setConfig: (config: AiEndpointConfig) => Promise<AiProviderStatus>;
  testConfig: () => Promise<AiActionResult>;
  listEndpointModels: () => Promise<string[]>;
  listLocalModels: () => Promise<AiModelInfo[]>;
  installLocalModel: (id: string) => Promise<AiActionResult>;
  cancelLocalModel: (id: string) => Promise<void>;
  removeLocalModel: (id: string) => Promise<AiModelInfo[]>;
  selectLocalModel: (id: string | null) => Promise<AiProviderStatus>;
  summarize: (request: AiSummaryRequest) => Promise<AiActionResult>;
  cancel: (requestId: string) => Promise<void>;
  onSummaryChunk: (cb: (chunk: AiSummaryChunk) => void) => () => void;
  onSummaryDone: (cb: (done: AiSummaryDone) => void) => () => void;
  onSummaryError: (cb: (err: AiSummaryError) => void) => () => void;
  onModelProgress: (cb: (progress: AiModelProgress) => void) => () => void;
}
