/**
 * Mobile override of `src/renderer/components/shell/BottomNav.tsx`.
 *
 * The bar itself is unchanged (sections, More, badges, labels, accessible names). On displays
 * with a system side column (iPhone Duo outer display, Duo Split View) it stands upright in that
 * column with the tabs at the bottom, where Apple's iPhone Duo guidelines put tab bars, instead of
 * taking a strip off the bottom of an already narrow screen. `mobileShell.css` positions it from
 * the `--mobile-side-column-*` geometry. In both modes the navigation steps aside while the
 * keyboard is up, so a composer or search field gets the screen's height.
 */
import {
  BottomNav as DesktopBottomNav,
  type BottomNavProps,
} from '@/renderer/components/shell/BottomNav';

import { useMobileViewport } from '../../platform/mobileViewport';

export * from '@/renderer/components/shell/BottomNav';

export function BottomNav(props: BottomNavProps) {
  const { sideColumn } = useMobileViewport();
  // No wrapper in bar mode, so the bar's markup is exactly the desktop one; mobileShell.css finds
  // the bar by its More button.
  if (!sideColumn) return <DesktopBottomNav {...props} />;
  return (
    <div data-mobile-side-nav={sideColumn.edge}>
      <DesktopBottomNav {...props} />
    </div>
  );
}
