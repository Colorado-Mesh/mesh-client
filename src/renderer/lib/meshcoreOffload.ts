export const MESHCORE_OFFLOAD_ABORT_MESSAGE = 'MeshCore offload cancelled';

export type MeshcoreOffloadPhase = 'saving' | 'removing' | 'reconciling';

export interface MeshcoreOffloadProgress {
  phase: MeshcoreOffloadPhase;
  current: number;
  total: number;
}

export interface MeshcoreOffloadFromRadioOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MeshcoreOffloadProgress) => void;
}

export class MeshcoreOffloadAbortedError extends DOMException {
  readonly removedFromRadio: number;

  constructor(removedFromRadio: number) {
    super(MESHCORE_OFFLOAD_ABORT_MESSAGE, 'AbortError');
    this.removedFromRadio = removedFromRadio;
  }
}

export function isMeshcoreOffloadAbortError(err: unknown): err is MeshcoreOffloadAbortedError {
  return (
    err instanceof MeshcoreOffloadAbortedError ||
    (err instanceof DOMException && err.name === 'AbortError')
  );
}

export function meshcoreOffloadAbortRemovedCount(err: unknown): number {
  if (err instanceof MeshcoreOffloadAbortedError) {
    return err.removedFromRadio;
  }
  return 0;
}

export function throwIfMeshcoreOffloadAborted(
  signal: AbortSignal | undefined,
  removedFromRadio = 0,
): void {
  if (signal?.aborted) {
    throw new MeshcoreOffloadAbortedError(removedFromRadio);
  }
}
