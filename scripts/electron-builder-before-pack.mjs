/**
 * electron-builder beforePack hook — copy the staged per-arch Reticulum sidecar into
 * resources/reticulum-sidecar/ so extraResources bundles the correct binary.
 * Also attaches SCHEMA-UPGRADE.txt when CI wrote a schema-bump notice.
 */
import { cpSync, rmSync, existsSync, mkdirSync } from 'fs';

import { joinUnderRoot, resolveUnderRoot } from './lib/path-under-root.mjs';

/** Stage only usable helpers, clearing any previous platform's files first. */
export function stageOptionalAiHelper(root, platform) {
  const active = resolveUnderRoot(root, 'resources/ai-helper/active');
  rmSync(active, { recursive: true, force: true });
  mkdirSync(active, { recursive: true });
  // OS-specific: Windows NSIS has no package identity/systemAIModels entitlement.
  if (platform !== 'darwin') return;
  const staged = resolveUnderRoot(root, 'resources/ai-helper/staged/darwin');
  if (!existsSync(joinUnderRoot(staged, 'mesh-ai'))) {
    console.warn(
      '[beforePack] Optional OS AI helper missing; Apple Intelligence will be unavailable.',
    );
    return;
  }
  if (!existsSync(joinUnderRoot(staged, 'mesh-ai-mlx'))) {
    console.warn(
      '[beforePack] Optional MLX helper missing; Apple Silicon MLX Catch up will be unavailable.',
    );
  } else if (!existsSync(joinUnderRoot(staged, 'mlx-swift_Cmlx.bundle'))) {
    console.warn(
      '[beforePack] mesh-ai-mlx staged without mlx-swift_Cmlx.bundle; Metal Catch up will fail to load default.metallib.',
    );
  }
  cpSync(staged, active, { recursive: true });
}

/**
 * @param {import('app-builder-lib').BeforePackContext} context
 */
