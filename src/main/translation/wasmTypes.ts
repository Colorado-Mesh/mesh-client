export interface NativeHandle {
  delete(): void;
}
export interface NativeVector<T> extends NativeHandle {
  push_back(value: T): void;
  get(index: number): T;
  size(): number;
}
export interface AlignedMemory extends NativeHandle {
  getByteArrayView(): Uint8Array;
}
export interface NativeResponse extends NativeHandle {
  getTranslatedText(): string;
}
export interface ResponseOptions {
  qualityScores: boolean;
  alignment: boolean;
  html: boolean;
}
export interface NativeService extends NativeHandle {
  translate(
    model: NativeHandle,
    messages: NativeVector<string>,
    options: NativeVector<ResponseOptions>,
  ): NativeVector<NativeResponse>;
  translateViaPivoting(
    first: NativeHandle,
    second: NativeHandle,
    messages: NativeVector<string>,
    options: NativeVector<ResponseOptions>,
  ): NativeVector<NativeResponse>;
}
export interface ModuleOptions {
  wasmBinary: Uint8Array;
  INITIAL_MEMORY?: number;
  print: (message: string) => void;
  printErr: (message: string) => void;
  onAbort: (reason: unknown) => void;
  onRuntimeInitialized?: () => void;
}
export interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => NativeVector<AlignedMemory>;
  TranslationModel: new (
    source: string,
    target: string,
    config: string,
    model: AlignedMemory,
    lex: AlignedMemory,
    vocabs: NativeVector<AlignedMemory>,
    quality: null,
  ) => NativeHandle;
  BlockingService: new (options: { cacheSize: number }) => NativeService;
  VectorString: new () => NativeVector<string>;
  VectorResponseOptions: new () => NativeVector<ResponseOptions>;
}
export interface FastTextModule {
  FS: { writeFile(file: string, bytes: Uint8Array): void; unlink(file: string): void };
  FastText: new () => NativeHandle & {
    loadModel(file: string): void;
    predict(text: string, count: number, threshold: number): NativeVector<[number, string]>;
  };
}
