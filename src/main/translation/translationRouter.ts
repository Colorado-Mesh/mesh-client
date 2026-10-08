import {
  TRANSLATION_DETECTION_CONFIDENCE,
  TRANSLATION_MIN_LETTERS,
  type TranslationDetection,
  type TranslationRequest,
  type TranslationResult,
} from '../../shared/translation-types';
import {
  isTranslationLanguage,
  normalizeTranslationLanguage,
  translationPath,
} from '../../shared/translationLanguages';
import type { BergamotWorker } from './bergamotWorker';
import type { WorkerModelFiles } from './bergamotWorkerRuntime';
import type { LibreTranslateClient } from './libreTranslateClient';
import type { TranslationPackManager } from './packManager';

export class TranslationRouter {
  private generation = 0;
  private current(generation: number): boolean {
    return generation === this.generation && this.deps.enabled();
  }
  constructor(
    private readonly deps: {
      enabled: () => boolean;
      packs: TranslationPackManager;
      worker: Pick<BergamotWorker, 'run' | 'dispose'>;
      libre: Pick<LibreTranslateClient, 'translate' | 'status' | 'dispose'>;
    },
  ) {}

  private engineFiles() {
    return {
      wasm: this.deps.packs.assetPath('engine', 'engine.wasm'),
      fasttext: this.deps.packs.assetPath('engine', 'fasttext.wasm'),
      lid: this.deps.packs.assetPath('engine', 'lid.ftz'),
    };
  }

  async detect(text: string): Promise<TranslationDetection | null> {
    const generation = this.generation;
    if (
      !this.deps.enabled() ||
      (text.match(/\p{L}/gu)?.length ?? 0) < TRANSLATION_MIN_LETTERS ||
      !(await this.deps.packs.verify('engine'))
    )
      return null;
    if (!this.current(generation)) return null;
    try {
      const result = await this.deps.worker.run({ text, engine: this.engineFiles() });
      return this.current(generation) ? (result.detection ?? null) : null;
    } catch {
      // catch-no-log-ok caller receives an unavailable detector; never log message contents
      return null;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const generation = this.generation;
    if (!this.current(generation)) return { ok: false, reason: 'disabled' };
    if (request.provider === 'libre') {
      if (request.mode !== 'manual' || !this.deps.libre.status().enabled)
        return { ok: false, reason: 'disabled' };
      try {
        const text = await this.deps.libre.translate(
          request.text,
          request.source ?? 'auto',
          request.target,
        );
        if (!this.current(generation)) return { ok: false, reason: 'disabled' };
        return { ok: true, text, detectedLang: request.source ?? 'auto', provider: 'libre' };
      } catch {
        // catch-no-log-ok return a safe error; online responses may contain private message text
        return { ok: false, reason: 'error' };
      }
    }
    if (!(await this.deps.packs.verify('engine')))
      return { ok: false, reason: 'missingPack', missingPacks: ['engine'] };
    if (!this.current(generation)) return { ok: false, reason: 'disabled' };
    const detection = request.source
      ? { language: request.source, confidence: 1 }
      : await this.detect(request.text);
    if (!this.current(generation)) return { ok: false, reason: 'disabled' };
    if (!detection || detection.confidence < TRANSLATION_DETECTION_CONFIDENCE)
      return { ok: false, reason: 'uncertain' };
    const source = normalizeTranslationLanguage(detection.language);
    if (!isTranslationLanguage(source)) return { ok: false, reason: 'unsupported' };
    if (source === request.target)
      return { ok: true, text: request.text, detectedLang: source, provider: 'offline' };
    const ids = translationPath(source, request.target);
    const missing: string[] = [];
    for (const id of ids) if (!(await this.deps.packs.verify(id))) missing.push(id);
    if (!this.current(generation)) return { ok: false, reason: 'disabled' };
    if (missing.length) return { ok: false, reason: 'missingPack', missingPacks: missing };
    if (!this.current(generation)) return { ok: false, reason: 'disabled' };
    try {
      const models: WorkerModelFiles[] = ids.map((id) => {
        const pack = this.deps.packs.pack(id);
        return {
          id,
          source: pack.source!,
          target: pack.target!,
          precision: pack.precision!,
          model: this.deps.packs.assetPath(id, 'model.bin'),
          lex: this.deps.packs.assetPath(id, 'lex.bin'),
          vocabs: pack.assets
            .filter((asset) => asset.file.endsWith('.spm'))
            .map((asset) => this.deps.packs.assetPath(id, asset.file)),
        };
      });
      const result = await this.deps.worker.run({
        text: request.text,
        engine: this.engineFiles(),
        models,
      });
      if (!this.current(generation)) return { ok: false, reason: 'disabled' };
      if (typeof result.text !== 'string' || result.text.length > 32_768)
        return { ok: false, reason: 'error' };
      return { ok: true, text: result.text, detectedLang: source, provider: 'offline' };
    } catch {
      // catch-no-log-ok worker failure is returned to the UI; the next call starts a fresh worker
      return { ok: false, reason: 'error' };
    }
  }

  dispose(): void {
    this.generation += 1;
    this.deps.worker.dispose();
    this.deps.libre.dispose();
  }
}
