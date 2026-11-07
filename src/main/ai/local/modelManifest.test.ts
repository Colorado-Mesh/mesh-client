import { describe, expect, it } from 'vitest';

import { AI_LOCAL_MODELS, isAppleSiliconMac, isCatalogPackAvailable } from './modelManifest';

describe('AI local model catalog platform gates', () => {
  it('detects Apple Silicon Mac hosts', () => {
    expect(isAppleSiliconMac('darwin', 'arm64')).toBe(true);
    expect(isAppleSiliconMac('darwin', 'x64')).toBe(false);
    expect(isAppleSiliconMac('linux', 'arm64')).toBe(false);
  });

  it('exposes MLX packs only on darwin arm64 and GGUF everywhere', () => {
    const mlx = AI_LOCAL_MODELS.filter((pack) => pack.runtime === 'mlx');
    const gguf = AI_LOCAL_MODELS.filter((pack) => pack.runtime === 'wllama');
    expect(mlx.length).toBe(2);
    expect(gguf.length).toBe(2);
    for (const pack of mlx) {
      expect(isCatalogPackAvailable(pack, 'darwin', 'arm64')).toBe(true);
      expect(isCatalogPackAvailable(pack, 'darwin', 'x64')).toBe(false);
      expect(isCatalogPackAvailable(pack, 'linux', 'x64')).toBe(false);
      expect(isCatalogPackAvailable(pack, 'win32', 'x64')).toBe(false);
    }
    for (const pack of gguf) {
      expect(isCatalogPackAvailable(pack, 'linux', 'x64')).toBe(true);
      expect(isCatalogPackAvailable(pack, 'darwin', 'arm64')).toBe(true);
    }
  });

  it('ships Qwen2.5 1.5B as the lighter pack and Llama as quality', () => {
    const qwen = AI_LOCAL_MODELS.filter((pack) => pack.id.includes('qwen'));
    const llama = AI_LOCAL_MODELS.filter((pack) => pack.id.includes('llama'));
    expect(
      qwen.every(
        (pack) => pack.id.startsWith('qwen2.5-1.5b-') && pack.recommendAs === 'fasterMachines',
      ),
    ).toBe(true);
    expect(llama.every((pack) => pack.recommendAs === 'quality')).toBe(true);
    expect(AI_LOCAL_MODELS.some((pack) => pack.id.includes('qwen3'))).toBe(false);
  });
});
