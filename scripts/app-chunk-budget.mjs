/**
 * Fail the renderer build when the App entry chunk exceeds the budget.
 * Vite's chunkSizeWarningLimit is advisory and does not fail CI.
 *
 * Size uses on-disk byte length / 1000 (decimal kB), matching Vite's
 * chunkSizeWarningLimit / vite-reporter listing. Measuring `output.code` in
 * generateBundle under-reports vs the emitted file under Rolldown/Vite 8.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** @type {number} */
export const APP_ENTRY_CHUNK_BUDGET_KB = 1000;

/**
 * @param {string} filePath
 * @returns {string}
 */
function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

/**
 * The App chunk is the Rollup/Rolldown output for `src/renderer/App.tsx` (`assets/App-*.js`).
 * Vite code-splits it out of the HTML entry. Vendor codeSplitting groups are not this budget.
 *
 * @param {{ type?: string, name?: string, facadeModuleId?: string | null }} output
 * @param {string} [fileName]
 * @returns {boolean}
 */
export function isAppEntryChunk(output, fileName = '') {
  if (!output || output.type !== 'chunk') return false;
  if (output.name === 'App') return true;
  if (/(?:^|\/)App-[^/]+\.js$/.test(fileName)) return true;
  const facade = normalizePath(output.facadeModuleId ?? '');
  return facade.endsWith('/src/renderer/App.tsx');
}

/**
 * @param {string | undefined | null} code
 * @returns {number}
 */
export function chunkSizeKbFromCode(code) {
  return Buffer.byteLength(code ?? '', 'utf8') / 1000;
}

/**
 * @param {string} absolutePath
 * @returns {number}
 */
export function chunkSizeKbFromFile(absolutePath) {
  return Buffer.byteLength(readFileSync(absolutePath)) / 1000;
}

/**
 * @param {{ fileName: string, sizeKb: number }[]} matches
 * @param {number} limitKb
 * @returns {string | null}
 */
export function formatAppEntryBudgetError(matches, limitKb = APP_ENTRY_CHUNK_BUDGET_KB) {
  if (matches.length === 0) {
    return 'App entry chunk was not found in the renderer bundle (budget check)';
  }
  const over = matches.filter((entry) => entry.sizeKb > limitKb);
  if (over.length === 0) return null;
  return over
    .map(
      (entry) =>
        `App entry chunk ${entry.fileName} is ${entry.sizeKb.toFixed(1)} kB, over the ${limitKb} kB budget`,
    )
    .join('\n');
}

/**
 * @param {Record<string, { type?: string, isEntry?: boolean, facadeModuleId?: string | null, code?: string }>} bundle
 * @param {number} [limitKb]
 * @returns {string | null} Error text when the budget is missing or exceeded.
 */
export function appEntryChunkBudgetError(bundle, limitKb = APP_ENTRY_CHUNK_BUDGET_KB) {
  /** @type {{ fileName: string, sizeKb: number }[]} */
  const matches = [];
  for (const [fileName, output] of Object.entries(bundle)) {
    if (!isAppEntryChunk(output, fileName)) continue;
    matches.push({ fileName, sizeKb: chunkSizeKbFromCode(output.code) });
  }
  return formatAppEntryBudgetError(matches, limitKb);
}

/**
 * @param {Record<string, { type?: string, name?: string, facadeModuleId?: string | null }>} bundle
 * @param {string} outDir
 * @param {number} [limitKb]
 * @returns {string | null}
 */
export function appEntryChunkBudgetErrorFromOutDir(
  bundle,
  outDir,
  limitKb = APP_ENTRY_CHUNK_BUDGET_KB,
) {
  /** @type {{ fileName: string, sizeKb: number }[]} */
  const matches = [];
  for (const [fileName, output] of Object.entries(bundle)) {
    if (!isAppEntryChunk(output, fileName)) continue;
    const absolutePath = path.resolve(outDir, fileName);
    matches.push({ fileName, sizeKb: chunkSizeKbFromFile(absolutePath) });
  }
  return formatAppEntryBudgetError(matches, limitKb);
}

/**
 * @param {number} [limitKb]
 * @returns {import('vite').Plugin}
 */
export function appChunkBudgetPlugin(limitKb = APP_ENTRY_CHUNK_BUDGET_KB) {
  /** @type {string} */
  let outDir = '';
  return {
    name: 'app-chunk-budget',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle(_options, bundle) {
      const message = appEntryChunkBudgetErrorFromOutDir(bundle, outDir, limitKb);
      if (message) this.error(message);
    },
  };
}
