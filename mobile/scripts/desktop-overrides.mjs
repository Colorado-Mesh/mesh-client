/**
 * Build-time module overrides: the mobile app swaps a small, pinned set of desktop renderer
 * modules for mobile wrappers WITHOUT editing the desktop sources. Each wrapper re-exports the
 * original (`export * from '@/…'`) and replaces only what mobile needs; imports made by the
 * wrappers themselves are never redirected, so they still reach the original module.
 *
 * `pnpm -C mobile run audit` pins a sha256 for every original here and fails when upstream
 * changes, so the wrapper can be reviewed against the new desktop code.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');
const OVERRIDES_DIR = path.join(MOBILE_ROOT, 'src/overrides/renderer');

/** Desktop module (repo-relative) → mobile wrapper (relative to src/overrides/renderer). */
export const RENDERER_OVERRIDES = {
  'src/renderer/components/shell/QuitButton.tsx': 'QuitButton.tsx',
  'src/renderer/lib/locationTrust.ts': 'locationTrust.ts',
  'src/renderer/components/SetLocationCard.tsx': 'SetLocationCard.tsx',
  'src/renderer/components/chat/ConversationLayout.tsx': 'ConversationLayout.tsx',
  'src/renderer/lib/bottomNav.ts': 'bottomNav.ts',
  'src/renderer/hooks/useMediaQuery.ts': 'useMediaQuery.ts',
};

const byAbsolute = new Map(
  Object.entries(RENDERER_OVERRIDES).map(([from, to]) => [
    path.join(REPO_ROOT, from),
    path.join(OVERRIDES_DIR, to),
  ]),
);
/** The wrappers themselves import the originals, so their imports are never redirected. */
const wrapperFiles = new Set(byAbsolute.values());

/** Vite/Rollup plugin (also used by the mobile Vitest config). */
export function desktopOverridesPlugin() {
  return {
    name: 'mesh-mobile-desktop-overrides',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || wrapperFiles.has(importer.split('?')[0])) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const target = byAbsolute.get(resolved.id.split('?')[0]);
      return target ?? null;
    },
  };
}
