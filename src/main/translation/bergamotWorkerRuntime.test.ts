import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BergamotWorkerRuntime, type WorkerModelFiles } from './bergamotWorkerRuntime';
import type { ModuleOptions } from './wasmTypes';

const native = vi.hoisted(() => {
  const handles: { kind: string; delete: ReturnType<typeof vi.fn> }[] = [];
  class Handle {
    delete = vi.fn();
    constructor(readonly kind: string) {
      handles.push(this);
    }
  }
  class Vector<T> extends Handle {
    items: T[] = [];
    constructor() {
      super('vector');
    }
    push_back(item: T) {
      this.items.push(item);
    }
    get(index: number) {
      return this.items[index];
    }
    size() {
      return this.items.length;
    }
  }
  class Memory extends Handle {
    bytes: Uint8Array;
    constructor(size: number) {
      super('memory');
      this.bytes = new Uint8Array(size);
    }
    getByteArrayView() {
      return this.bytes;
    }
  }
  const modelArguments: unknown[][] = [];
  class Model extends Handle {
    constructor(...args: unknown[]) {
      super('model');
      modelArguments.push(args);
    }
  }
  class Response extends Handle {
    constructor() {
      super('response');
    }
    getTranslatedText() {
      return 'translated';
    }
  }
  const inference = () => {
    const responses = new Vector<Response>();
    responses.push_back(new Response());
    return responses;
  };
  class Service extends Handle {
    constructor() {
      super('service');
    }
    translate = vi.fn(inference);
    translateViaPivoting = vi.fn(inference);
  }
  const engine = {
    AlignedMemory: Memory,
    AlignedMemoryList: Vector,
    TranslationModel: Model,
    BlockingService: Service,
    VectorString: Vector,
    VectorResponseOptions: Vector,
  };
  const unlink = vi.fn();
  class Detector extends Handle {
    constructor() {
      super('detector');
    }
    loadModel = vi.fn();
    predict = vi.fn(() => {
      const guesses = new Vector<[number, string]>();
      guesses.push_back([0.99, '__label__fr']);
      return guesses;
    });
  }
  return {
    handles,
    modelArguments,
    engine,
    fasttext: { FS: { writeFile: vi.fn(), unlink }, FastText: Detector },
  };
});
vi.mock('./vendor/bergamot', () => ({
  default: (options: ModuleOptions) => {
    queueMicrotask(() => options.onRuntimeInitialized?.());
    return native.engine;
  },
}));
vi.mock('./vendor/fasttext', () => ({ default: () => Promise.resolve(native.fasttext) }));

describe('native translation resource lifetime', () => {
  let directory: string;
  beforeEach(async () => {
    native.handles.length = 0;
    native.modelArguments.length = 0;
    vi.clearAllMocks();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-worker-runtime-'));
    await fs.writeFile(path.join(directory, 'data'), 'fixture');
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('retains only the active model pair and frees temporary native handles after inference', async () => {
    const file = path.join(directory, 'data');
    const engine = { wasm: file, fasttext: file, lid: file };
    const model = (id: string): WorkerModelFiles => ({
      id,
      source: id.split('-')[0],
      target: id.split('-')[1],
      precision: 'int8shiftAlphaAll',
      model: file,
      lex: file,
      vocabs: [file],
    });
    const runtime = new BergamotWorkerRuntime();
    expect(await runtime.run({ id: 1, text: 'Bonjour', engine })).toMatchObject({
      detection: { language: 'fr', confidence: 0.99 },
    });
    expect(native.fasttext.FS.unlink).toHaveBeenCalledWith('lid.ftz');
    await runtime.run({ id: 2, text: 'Bonjour', engine, models: [model('fr-en'), model('en-de')] });
    await runtime.run({ id: 3, text: 'Encore', engine, models: [model('fr-en'), model('en-de')] });
    expect(native.modelArguments).toHaveLength(2);
    expect(native.modelArguments[0]).toHaveLength(7);
    expect(native.modelArguments[0][2]).toContain('gemm-precision: int8shiftAlphaAll');
    for (const handle of native.handles.filter((item) =>
      ['memory', 'vector', 'response'].includes(item.kind),
    ))
      expect(handle.delete).toHaveBeenCalledTimes(1);
    const oldModels = native.handles.filter((item) => item.kind === 'model');
    await runtime.run({ id: 4, text: 'Hello', engine, models: [model('en-fr')] });
    for (const handle of oldModels) expect(handle.delete).toHaveBeenCalledTimes(1);
    runtime.dispose();
    runtime.dispose();
    for (const handle of native.handles) expect(handle.delete).toHaveBeenCalledTimes(1);
  });
});
