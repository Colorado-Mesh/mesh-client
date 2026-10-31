/** IPC channel for main-owned ~2h renderer working-set samples. */
export const RENDERER_MEMORY_AUTO_SAMPLE_CHANNEL = 'renderer-memory:auto-sample';

export interface RendererMemoryAutoSamplePayload {
  capturedAt: number;
  bytes: number;
  source: 'renderer-process';
}
