import type { AiHistoryMessage, AiHistoryQuery } from './ai-history';
import { MS_PER_MINUTE, MS_PER_SECOND } from './timeConstants';

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

/** Prompt role for multi-pass Catch up (default final = existing five-bullet UX). */
export type AiSummaryPassMode = 'map' | 'reduce' | 'final';

/** How retained source material is framed in a follow-up prompt. */
export type AiFollowUpContextKind = 'transcript' | 'digests' | 'none';

/** One completed follow-up turn about a Catch up summary (session memory only). */
export interface AiSummaryFollowUpTurn {
  question: string;
  answer: string;
}

/** Follow-up question attached to a Catch up request. */
export interface AiSummaryFollowUp {
  /** User question; controls stripped, capped at AI_MAX_FOLLOW_UP_QUESTION_CHARS. */
  question: string;
  /** Completed Catch up text the question refers to. */
  summary: string;
  /** Prior completed turns, oldest first, capped at AI_MAX_FOLLOW_UP_TURNS. */
  turns: AiSummaryFollowUpTurn[];
  /** How `messages` should be framed in the follow-up prompt. */
  contextKind: AiFollowUpContextKind;
}

export interface AiSummaryRequest {
  /** Unique per call; used to correlate stream events and cancellation. */
  requestId: string;
  /** Unique per Catch up job; child map/reduce passes share this for rate-limit exemption. */
  jobId?: string;
  /** Prompt mode; omitted means final (single-pass compatibility). */
  mode?: AiSummaryPassMode;
  /** Conversation label shown to the model, e.g. "#general", "DM with KX4ABC", "Room: NodeChat". */
  conversationLabel: string;
  protocol: 'meshtastic' | 'meshcore' | 'reticulum';
  surface: 'channel' | 'dm' | 'room' | 'rrc';
  /** UI locale (BCP-47) so the summary comes back in the user's language. */
  locale: string;
  messages: AiSummaryMessage[];
  scope: AiSummaryScope;
  /**
   * When present, main answers a follow-up instead of producing a Catch up.
   * Follow-ups are always single-pass and may have an empty `messages` array
   * (summary-only answers).
   */
  followUp?: AiSummaryFollowUp;
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
  timeoutSeconds: number;
  /** Max messages one Catch up may collect (multi-pass); clamped to product bounds. */
  maxCollectedMessages: number;
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
  /** Summary deadline in seconds (30–1800); omitted preserves the saved value. */
  timeoutSeconds?: number;
  /** Catch up collection ceiling (100–5000); omitted preserves the saved value. */
  maxCollectedMessages?: number;
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

export type AiModelRuntime = 'wllama' | 'mlx';
/** Soft catalog badges: quality = recommended; fasterMachines = lighter/slower-host hint. */
export type AiModelRecommendation = 'quality' | 'fasterMachines';

export interface AiModelInfo {
  id: string;
  name: string;
  paramsLabel: string;
  downloadBytes: number;
  diskBytes: number;
  license: string;
  installed: boolean;
  /** Inference backend; omitted for retired on-disk orphans. */
  runtime?: AiModelRuntime;
  /**
   * Soft relative guidance for this host (MLX preferred on Apple Silicon).
   * Relative speed/resource guidance only — not an accuracy guarantee.
   */
  recommendation?: AiModelRecommendation;
  /**
   * True when a pack directory remains on disk after the catalog dropped that id
   * (e.g. after a model upgrade). Orphans can be removed but not selected/downloaded.
   */
  orphan?: boolean;
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
  /** Completion budget; map/reduce use a lower cap than final. */
  maxTokens: number;
}

export interface AiActionResult {
  localJob?: AiLocalJob;
  /** Actual prepared prompt coverage, before generation starts. */
  summaryInput?: { messageCount: number; truncated: boolean };
  ok: boolean;
  reason?: string;
}

/** Limits enforced in main before any request is made. */
/** Max messages in a single ai:summarize IPC (one map/reduce/final chunk). */
export const AI_MAX_MESSAGES = 500;
/** Body-char budget sized for the hard collection ceiling (~250 chars × 5000). */
export const AI_MAX_TOTAL_CHARS = 1_250_000;
/** Default Catch up collection ceiling (user-configurable). */
export const AI_DEFAULT_MAX_COLLECTED_MESSAGES = 2000;
export const AI_MIN_MAX_COLLECTED_MESSAGES = 100;
/** Hard product ceiling for one Catch up collection. */
export const AI_MAX_MAX_COLLECTED_MESSAGES = 5000;
/** Compact final catch-up (≤5 bullets) and default single-pass summaries. */
export const AI_MAX_OUTPUT_TOKENS = 250;
/**
 * Structured final catch-up (conversations + one-offs) for large / multi-pass jobs.
 */
export const AI_STRUCTURED_FINAL_OUTPUT_TOKENS = 512;
/**
 * Single-pass finals with more than this many messages use the structured style.
 * Multi-pass finals always use structured regardless of digest count.
 */
export const AI_COMPACT_FINAL_MAX_MESSAGES = 40;
/**
 * Map digests are intermediate; capping decode tokens cuts multi-pass wall time
 * roughly in proportion (bundled WASM decode dominates over prompt eval).
 */
export const AI_MAP_OUTPUT_TOKENS = 96;
export const AI_REDUCE_OUTPUT_TOKENS = 128;
export const AI_MAX_RESPONSE_BYTES = 256 * 1024;

/** Max characters accepted for a follow-up question. */
export const AI_MAX_FOLLOW_UP_QUESTION_CHARS = 500;
/** Max prior Q&A turns sent back to the model. */
export const AI_MAX_FOLLOW_UP_TURNS = 6;
/** Max characters of one prior answer included in the prompt. */
export const AI_MAX_FOLLOW_UP_ANSWER_CHARS = 2_000;
/** Max characters of the completed summary included in the prompt. */
export const AI_MAX_FOLLOW_UP_SUMMARY_CHARS = 4_000;
/**
 * Newest-first body-character cap for transcript retained for follow-ups
 * (renderer session memory). Over-cap ranges keep the newest window, not none.
 */
export const AI_FOLLOW_UP_CONTEXT_MAX_CHARS = 64_000;
/** Completed follow-up turns retained per summary in the renderer. */
export const AI_MAX_RETAINED_FOLLOW_UPS = 20;
/** Output token budget for one follow-up answer. */
export const AI_FOLLOW_UP_OUTPUT_TOKENS = 250;

/** Final Catch-up output shape: compact bullets vs conversation/one-off sections. */
export type AiSummaryFinalStyle = 'compact' | 'structured';

export function resolveAiSummaryFinalStyle(
  messageCount: number,
  multiPassFinal = false,
): AiSummaryFinalStyle {
  if (multiPassFinal) return 'structured';
  if (messageCount > AI_COMPACT_FINAL_MAX_MESSAGES) return 'structured';
  return 'compact';
}

export function aiSummaryOutputTokens(
  mode: AiSummaryPassMode = 'final',
  finalStyle: AiSummaryFinalStyle = 'compact',
): number {
  if (mode === 'map') return AI_MAP_OUTPUT_TOKENS;
  if (mode === 'reduce') return AI_REDUCE_OUTPUT_TOKENS;
  return finalStyle === 'structured' ? AI_STRUCTURED_FINAL_OUTPUT_TOKENS : AI_MAX_OUTPUT_TOKENS;
}
/**
 * Whole-prompt UTF-8 ceiling for OS AI and downloaded WASM.
 * ~12 KiB leaves room for chat template + structured completion within bundled n_ctx 8192.
 */
export const AI_ON_DEVICE_MAX_PROMPT_BYTES = 12_288;
/** Whole-prompt UTF-8 ceiling for local/remote HTTP engines. */
export const AI_ENDPOINT_MAX_PROMPT_BYTES = 64_000;
export const AI_OS_MAX_CHARS = 9000;
export const AI_BUNDLED_MAX_CHARS = 20_000;
export const AI_ENDPOINT_MAX_CHARS = 60_000;
/**
 * Approximate UTF-8 size of one transcript line (timestamp + callsign + short body)
 * used only for App → AI capacity estimates — not a hard limit.
 */
export const AI_TYPICAL_SUMMARY_LINE_BYTES = 120;
export const AI_REQUEST_TIMEOUT_MS = MS_PER_MINUTE;
/** CPU WASM also needs time to load and evaluate the downloaded model. */
export const AI_LOCAL_REQUEST_TIMEOUT_MS = 5 * MS_PER_MINUTE;
export const AI_MIN_TIMEOUT_SECONDS = 30;
export const AI_MAX_TIMEOUT_SECONDS = 1800;
export function aiSummaryTimeoutMs(engine: AiEngine | null, seconds?: number): number {
  return typeof seconds === 'number' &&
    Number.isInteger(seconds) &&
    seconds >= AI_MIN_TIMEOUT_SECONDS &&
    seconds <= AI_MAX_TIMEOUT_SECONDS
    ? seconds * MS_PER_SECOND
    : engine === 'bundled'
      ? AI_LOCAL_REQUEST_TIMEOUT_MS
      : AI_REQUEST_TIMEOUT_MS;
}

export function clampAiMaxCollectedMessages(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AI_MIN_MAX_COLLECTED_MESSAGES &&
    value <= AI_MAX_MAX_COLLECTED_MESSAGES
  )
    return value;
  return AI_DEFAULT_MAX_COLLECTED_MESSAGES;
}

/** Prompt char/byte budgets used by main when preparing a Catch up request. */
export function aiSummaryPromptBudget(engine: AiEngine): {
  maxChars: number;
  maxPromptBytes: number;
} {
  if (engine === 'os')
    return { maxChars: AI_OS_MAX_CHARS, maxPromptBytes: AI_ON_DEVICE_MAX_PROMPT_BYTES };
  if (engine === 'bundled')
    return { maxChars: AI_BUNDLED_MAX_CHARS, maxPromptBytes: AI_ON_DEVICE_MAX_PROMPT_BYTES };
  return { maxChars: AI_ENDPOINT_MAX_CHARS, maxPromptBytes: AI_ENDPOINT_MAX_PROMPT_BYTES };
}

/**
 * Rough count of typical mesh messages that fit one summary for this engine.
 * Clipped by AI_MAX_MESSAGES; actual inclusion depends on message length.
 */
export function estimateAiSummaryMessageCapacity(engine: AiEngine): number {
  const { maxPromptBytes } = aiSummaryPromptBudget(engine);
  return Math.min(
    AI_MAX_MESSAGES,
    Math.max(1, Math.floor(maxPromptBytes / AI_TYPICAL_SUMMARY_LINE_BYTES)),
  );
}

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
