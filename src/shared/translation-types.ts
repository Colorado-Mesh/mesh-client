import type { TranslationLanguage } from './translationLanguages';

export const TRANSLATION_MAX_TEXT_LENGTH = 8_192;
export const TRANSLATION_MIN_LETTERS = 12;
export const TRANSLATION_DETECTION_CONFIDENCE = 0.7;

export interface TranslationDetection {
  language: string;
  confidence: number;
}
export interface TranslationRequest {
  text: string;
  target: TranslationLanguage;
  source?: TranslationLanguage;
  mode: 'manual' | 'auto';
  /** Online transmission always requires this explicit manual choice. */
  provider?: 'offline' | 'libre';
}
export type TranslationResult =
  | { ok: true; text: string; detectedLang: string; provider: 'offline' | 'libre' }
  | {
      ok: false;
      reason: 'disabled' | 'missingPack' | 'uncertain' | 'unsupported' | 'busy' | 'error';
      missingPacks?: string[];
    };

export interface TranslationPack {
  id: string;
  source?: string;
  target?: string;
  downloadBytes: number;
  diskBytes: number;
  installed: boolean;
  license: string;
}
export interface TranslationProgress {
  packId: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'queued' | 'downloading' | 'verifying' | 'installed' | 'cancelled' | 'error';
}
export interface LibreTranslationConfig {
  enabled: boolean;
  url: string;
  /** Omission preserves the saved key; an empty string removes it. Never returned by IPC. */
  apiKey?: string;
}
export interface TranslationStatus {
  enabled: boolean;
  packs: TranslationPack[];
  progress: TranslationProgress[];
  diskBytes: number;
  libre: { enabled: boolean; url: string; hasApiKey: boolean };
}
export interface TranslationActionResult {
  ok: boolean;
  reason?: string;
}
export interface TranslationAPI {
  getStatus: () => Promise<TranslationStatus>;
  setEnabled: (enabled: boolean) => Promise<TranslationStatus>;
  translate: (request: TranslationRequest) => Promise<TranslationResult>;
  detect: (text: string) => Promise<TranslationDetection | null>;
  listPacks: () => Promise<TranslationPack[]>;
  installPack: (id: string) => Promise<TranslationActionResult>;
  cancelInstall: (id: string) => Promise<void>;
  deletePack: (id: string) => Promise<void>;
  removeAll: () => Promise<TranslationStatus>;
  setLibreConfig: (config: LibreTranslationConfig) => Promise<TranslationStatus>;
  testLibreConfig: () => Promise<TranslationActionResult>;
  onPackProgress: (callback: (progress: TranslationProgress) => void) => () => void;
}
