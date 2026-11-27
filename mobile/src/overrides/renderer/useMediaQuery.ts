/**
 * Mobile override of `src/renderer/hooks/useMediaQuery.ts`. Same API; layout queries the
 * desktop shell uses are answered from the mobile viewport (safe-area aware, fold aware):
 * - the shell compact sentinel (see `bottomNav.ts`) → bottom bar until the rail fits;
 * - `(min-width: 1280px)` (App's inline node-detail pane) → inline once the rail fits.
 * Every other query is the desktop hook (window.matchMedia).
 */
import { useMediaQuery as useDesktopMediaQuery } from '@/renderer/hooks/useMediaQuery';

import { useMobileViewport } from '../../platform/mobileViewport';
import { MOBILE_SHELL_COMPACT_QUERY } from './bottomNav';

/** App.tsx `NODE_DETAIL_PANE_MEDIA_QUERY` (pinned by the mobile audit). */
export const NODE_DETAIL_PANE_QUERY = '(min-width: 1280px)';

export function useMediaQuery(query: string): boolean {
  const desktop = useDesktopMediaQuery(query);
  const viewport = useMobileViewport();
  if (!viewport.isMobile) return desktop;
  if (query === MOBILE_SHELL_COMPACT_QUERY) return !viewport.navRail;
  if (query === NODE_DETAIL_PANE_QUERY) return viewport.navRail;
  return desktop;
}
