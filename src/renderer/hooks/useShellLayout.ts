import { SHELL_COMPACT_QUERY } from '../lib/bottomNav';
import { useMobileViewport } from '../lib/mobileViewport';
import { useMediaQuery } from './useMediaQuery';

/**
 * Whether the app shell uses the phone layout (bottom bar + More sheet) instead of the rail.
 *
 * Desktop: the unchanged `SHELL_COMPACT_QUERY` media query (under 768px).
 * Mobile app: the bottom bar stays until the usable width reaches the rail breakpoint (840px,
 * Material window size class "expanded"), so foldables such as the unfolded iPhone Duo in portrait
 * (669pt) keep the bottom bar while their content goes two-pane (see `mobileViewport.ts`).
 */
export function useShellCompact(): boolean {
  const desktopCompact = useMediaQuery(SHELL_COMPACT_QUERY);
  const viewport = useMobileViewport();
  return viewport.isMobile ? !viewport.navRail : desktopCompact;
}
