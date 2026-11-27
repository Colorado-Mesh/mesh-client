/**
 * Mobile override of `src/renderer/lib/bottomNav.ts`. The shell's compact query becomes a
 * sentinel that the mobile `useMediaQuery` answers from the mobile viewport (bottom bar until the
 * navigation rail fits at 840px of usable width), so the desktop and conversation queries — both
 * `'(max-width: 767px)'` on desktop — can differ on foldables.
 */
export * from '@/renderer/lib/bottomNav';

export const MOBILE_SHELL_COMPACT_QUERY = '(mesh-mobile: shell-compact)';
export const SHELL_COMPACT_QUERY = MOBILE_SHELL_COMPACT_QUERY;
