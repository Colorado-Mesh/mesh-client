import fs from 'node:fs/promises';

import type { TranslationDetection } from '../../shared/translation-types';
import { normalizeTranslationLanguage } from '../../shared/translationLanguages';
import loadBergamot from './vendor/bergamot';
import loadFastText from './vendor/fasttext';
import type {
  AlignedMemory,
  BergamotModule,
  FastTextModule,
  NativeHandle,
  NativeResponse,
  NativeService,
  NativeVector,
} from './wasmTypes';

export interface WorkerModelFiles {
  id: string;
  source: string;
  target: string;
  precision: string;
  model: string;
  lex: string;
  vocabs: string[];
}
export interface TranslationWorkerJob {
  id: number;
  text: string;
  engine: { wasm: string; fasttext: string; lid: string };
  models?: WorkerModelFiles[];
}
export interface TranslationWorkerReply {
  id: number;
  detection?: TranslationDetection;
  text?: string;
  error?: boolean;
}

/** Lives exclusively in a terminable worker. Retains at most the active direct/pivot pair. */
export class BergamotWorkerRuntime {
  private engine?: BergamotModule;
  private detector?: InstanceType<FastTextModule['FastText']>;
  private service?: NativeService;
  private readonly models = new Map<string, NativeHandle>();

  async run(job: TranslationWorkerJob): Promise<TranslationWorkerReply> {
    if (!job.models) return { id: job.id, detection: await this.detect(job) };
    await this.loadEngine(job.engine.wasm);
    const engine = this.engine!;
    const requested = new Set(job.models.map((model) => model.id));
    for (const [id, model] of this.models) {
      if (!requested.has(id)) {
        model.delete();
        this.models.delete(id);
      }
    }
    for (const files of job.models)
      if (!this.models.has(files.id)) this.models.set(files.id, await this.loadModel(files));
    const messages = new engine.VectorString();
    const options = new engine.VectorResponseOptions();
    let responses: NativeVector<NativeResponse> | undefined;
    let response: NativeResponse | undefined;
    try {
      messages.push_back(job.text);
      options.push_back({ qualityScores: false, alignment: true, html: false });
      const first = this.models.get(job.models[0].id)!;
      responses =
        job.models.length === 2
          ? this.service!.translateViaPivoting(
              first,
              this.models.get(job.models[1].id)!,
              messages,
              options,
            )
          : this.service!.translate(first, messages, options);
      response = responses.get(0);
      return { id: job.id, text: response.getTranslatedText() };
    } finally {
      response?.delete();
      responses?.delete();
      messages.delete();
      options.delete();
    }
  }

  private async loadEngine(file: string): Promise<void> {
    if (this.engine) return;
    const wasmBinary = await fs.readFile(file);
    this.engine = await new Promise<BergamotModule>((resolve, reject) => {
      const engine = loadBergamot({
        wasmBinary,
        INITIAL_MEMORY: 41943040,
        print: () => {},
        printErr: () => {},
        onAbort: () => {
          reject(new Error('Translation engine aborted'));
        },
        onRuntimeInitialized: () => {
          resolve(engine);
        },
      });
    });
    this.service = new this.engine.BlockingService({ cacheSize: 0 });
  }

  private async loadModel(files: WorkerModelFiles): Promise<NativeHandle> {
    const engine = this.engine!;
    const allocated: AlignedMemory[] = [];
    const vocabs = new engine.AlignedMemoryList();
    const aligned = async (file: string, alignment: number) => {
      const bytes = await fs.readFile(file);
      const memory = new engine.AlignedMemory(bytes.byteLength, alignment);
      allocated.push(memory);
      memory.getByteArrayView().set(bytes);
      return memory;
    };
    try {
      const model = await aligned(files.model, 256);
      const lex = await aligned(files.lex, 64);
      for (const file of files.vocabs) vocabs.push_back(await aligned(file, 64));
      const config =
        '\n' +
        Object.entries({
          'beam-size': 1,
          normalize: '1.0',
          'word-penalty': 0,
          'max-length-break': 128,
          'mini-batch-words': 1024,
          workspace: 128,
          'max-length-factor': '2.0',
          'skip-cost': 'true',
          'cpu-threads': 0,
          quiet: 'true',
          'quiet-translation': 'true',
          'gemm-precision': files.precision,
          alignment: 'soft',
        })
          .map(([key, value]) => `  ${key}: ${value}`)
          .join('\n') +
        '\n';
      return new engine.TranslationModel(
        files.source,
        files.target,
        config,
        model,
        lex,
        vocabs,
        null,
      );
    } finally {
      // Native construction moves the storage. These handles are the moved-from wrappers.
      vocabs.delete();
      for (const memory of allocated) memory.delete();
    }
  }

  private async detect(job: TranslationWorkerJob): Promise<TranslationDetection> {
    if (!this.detector) {
      const module = await loadFastText({
        wasmBinary: await fs.readFile(job.engine.fasttext),
        print: () => {},
        printErr: () => {},
        onAbort: () => {
          throw new Error('Language detector aborted');
        },
      });
      module.FS.writeFile('lid.ftz', await fs.readFile(job.engine.lid));
      const detector = new module.FastText();
      try {
        detector.loadModel('lid.ftz');
        this.detector = detector;
      } catch (error) {
        detector.delete();
        throw error;
      } finally {
        module.FS.unlink('lid.ftz');
      }
    }
    const guesses = this.detector.predict(job.text.replace(/[\r\n]/g, ' '), 1, 0);
    try {
      const guess = guesses.get(0);
      return {
        language: normalizeTranslationLanguage(guess[1].replace(/^__label__/, '')),
        confidence: guess[0],
      };
    } finally {
      guesses.delete();
    }
  }

  dispose(): void {
    for (const model of this.models.values()) model.delete();
    this.models.clear();
    this.service?.delete();
    this.detector?.delete();
    this.service = undefined;
    this.detector = undefined;
    this.engine = undefined;
  }
}
