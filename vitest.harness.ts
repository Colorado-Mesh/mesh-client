/** Minimum worker count for both jsdom and node vitest pools. */
export const MIN_VITEST_WORKERS = 2;

/** jsdom renderer-ui workers are memory-heavy; cap at half of available CPUs. */
export const RENDERER_UI_CPU_RATIO = 0.5;

/** node renderer-logic / main workers are lighter; can use more CPU. */
export const NODE_WORKER_CPU_RATIO = 0.75;

/** Effective CPU count cap so worker pools stay bounded on many-core hosts. */
export const MAX_VITEST_CPU_COUNT = 32;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function computeVitestMaxWorkers(cpuCount: number, ratio: number): number {
  if (!isFinitePositive(cpuCount) || !isFinitePositive(ratio)) {
    return MIN_VITEST_WORKERS;
  }
  const boundedCpuCount = Math.min(cpuCount, MAX_VITEST_CPU_COUNT);
  const boundedRatio = Math.min(ratio, 1);
  return Math.max(MIN_VITEST_WORKERS, Math.floor(boundedCpuCount * boundedRatio));
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
  'dompurify',
  'i18next',
  'micron-parser',
  'react-i18next',
  'leaflet',
  'react-leaflet',
  'vitest-axe',
  'js-md5',
] as const;

export const VITEST_SERVER_INLINE_DEPS = [
  ...VITEST_CORE_DEPS,
  ...VITEST_SERVER_INLINE_EXTRA_DEPS,
  'esptool-js',
  '@zip.js/zip.js',
] as const;
