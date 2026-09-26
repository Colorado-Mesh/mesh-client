/** Shared class strings for controls that float over Leaflet maps (style guide, Map). */

/**
 * Floating control over a map (Layers, Export GPX, Measure): 32px dark chip on a blurred backdrop.
 * `aria-expanded` / `aria-pressed` give the open or active state a green edge.
 */
export const MAP_CONTROL_CLASS =
  'bg-deep-black/90 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 shadow-md backdrop-blur-sm transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-brand-green/60 aria-pressed:border-brand-green/60 aria-pressed:text-bright-green pointer-coarse:h-10';

/** Panel that opens under a map control (layers, basemap, offline maps). */
export const MAP_OVERLAY_PANEL_CLASS =
  'bg-deep-black/95 w-56 space-y-3 rounded-lg border border-slate-700 p-3 text-slate-200 shadow-lg backdrop-blur-sm';

/** Read-only chip over a map (status legend, counts). */
export const MAP_CHIP_CLASS =
  'bg-deep-black/90 flex h-8 items-center gap-3 rounded-lg border border-slate-700 px-3 text-xs text-slate-200 shadow-md backdrop-blur-sm';
