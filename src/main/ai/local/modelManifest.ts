import type { AiModelRecommendation } from '../../../shared/ai-types';

/**
 * Catalog asset: inline `content`, absolute `url`, or hub-relative `file` when the pack
 * sets `hub` (HF repo+rev). Prefer hub-relative entries so long resolve URLs are not
 * duplicated in the measured main bundle.
 */
export type AiLocalAsset = {
  file: string;
  size: number;
  sha256: string;
} & ({ content: string; url?: never } | { url?: string; content?: never });

export type AiLocalRuntime = 'wllama' | 'mlx';
export type { AiModelRecommendation };

export interface AiLocalHub {
  repo: string;
  rev: string;
}

export interface AiLocalModel {
  id: string;
  name: string;
  paramsLabel: string;
  license: string;
  /** Inference backend for this pack. */
  runtime: AiLocalRuntime;
  /**
   * Soft relative guidance when this runtime is preferred on the host
   * (MLX on Apple Silicon; GGUF elsewhere).
   */
  recommendAs?: AiModelRecommendation;
  /** When set, pack is omitted from the catalog outside these Node platforms. */
  platforms?: NodeJS.Platform[];
  /** When set with platforms, also require one of these arches (e.g. MLX arm64). */
  archs?: NodeJS.Architecture[];
  /** Hugging Face immutable pin; hub-relative assets resolve under this repo/rev. */
  hub?: AiLocalHub;
  assets: AiLocalAsset[];
}

const hfResolve = (repo: string, rev: string, file: string): string =>
  `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

/** Resolve download URL for a catalog asset (inline content has none). */
export function resolveAssetUrl(pack: AiLocalModel, asset: AiLocalAsset): string {
  if (asset.content !== undefined) throw new Error(`Inline AI asset has no URL (${asset.file})`);
  if (asset.url) return asset.url;
  if (!pack.hub) throw new Error(`AI pack ${pack.id} missing hub for ${asset.file}`);
  return hfResolve(pack.hub.repo, pack.hub.rev, asset.file);
}

/** True when MLX catalog packs and the mesh-ai-mlx helper are offered. */
export function isAppleSiliconMac(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): boolean {
  return platform === 'darwin' && arch === 'arm64';
}

export function isCatalogPackAvailable(
  pack: AiLocalModel,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): boolean {
  if (pack.platforms && !pack.platforms.includes(platform)) return false;
  if (pack.archs && !pack.archs.includes(arch)) return false;
  return true;
}
