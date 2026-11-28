import type { Plugin } from 'vite';

export const REPO_ROOT: string;
/** Desktop module (repo-relative) → mobile wrapper file name. */
export const RENDERER_OVERRIDES: Readonly<Record<string, string>>;
export function desktopOverridesPlugin(): Plugin;
