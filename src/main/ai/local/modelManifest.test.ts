import { describe, expect, it } from 'vitest';

import { AI_LOCAL_MODELS } from './modelCatalogData';
import { isAppleSiliconMac, isCatalogPackAvailable, resolveAssetUrl } from './modelManifest';

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

  it('resolves hub-relative asset URLs from a single repo pin', () => {
    const pack = AI_LOCAL_MODELS.find((entry) => entry.id === 'qwen2.5-1.5b-instruct-q4');
    expect(pack?.hub).toBeDefined();
    expect(pack).toBeDefined();
    if (!pack) throw new Error('expected qwen2.5 pack');
    const asset = pack.assets[0];
    expect(asset).toBeDefined();
    if (!asset) throw new Error('expected asset');
    expect(asset.url).toBeUndefined();
    expect(resolveAssetUrl(pack, asset)).toBe(
      'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    );
  });
});
