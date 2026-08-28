/**
 * Shared fit-width preference for Micron page rendering.
 *
 * Both the NomadNet browser and the My Pages editor preview read this so the two
 * surfaces always agree. Fit-width wraps long lines, which is right for prose but
 * breaks wide box-drawing art — open width is the opt-in for those pages.
 */

export const NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY = 'mesh-client:nomadPageFitWidth';

/** Missing key defaults to fit-width (wrap); only an explicit "false" opts out. */
export function readNomadPageFitWidth(): boolean {
  try {
    return localStorage.getItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY) !== 'false';
  } catch {
    // catch-no-log-ok localStorage may throw in private mode
    return true;
  }
}

export function writeNomadPageFitWidth(fitWidth: boolean): void {
  try {
    localStorage.setItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY, String(fitWidth));
  } catch {
    // catch-no-log-ok localStorage may throw in private mode / quota
  }
}
