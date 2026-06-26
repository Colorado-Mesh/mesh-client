/** Minimum worker count for both jsdom and node vitest pools. */
export const MIN_VITEST_WORKERS = 2;

/** jsdom renderer-ui workers are memory-heavy; cap at half of available CPUs. */
export const RENDERER_UI_CPU_RATIO = 0.5;

/** node renderer-logic / main workers are lighter; can use more CPU. */
export const NODE_WORKER_CPU_RATIO = 0.75;

export function computeVitestMaxWorkers(cpuCount: number, ratio: number): number {
  return Math.max(MIN_VITEST_WORKERS, Math.floor(cpuCount * ratio));
}

/** Shared deps inlined for Vite SSR optimizeDeps and server.deps.inline. */
export const VITEST_CORE_DEPS = [
  '@liamcottle/meshcore.js',
  '@michaelhart/meshcore-decoder',
  '@jsr/meshtastic__core',
  'mqtt',
  'zustand',
] as const;

/** Additional deps only needed in server.deps.inline (renderer-ui / jsdom). */
export const VITEST_SERVER_INLINE_EXTRA_DEPS = [
  '@jsr/meshtastic__transport-web-serial',
  'i18next',
  'react-i18next',
  'leaflet',
  'react-leaflet',
  'vitest-axe',
] as const;

export const VITEST_SERVER_INLINE_DEPS = [
  ...VITEST_CORE_DEPS,
  ...VITEST_SERVER_INLINE_EXTRA_DEPS,
] as const;
