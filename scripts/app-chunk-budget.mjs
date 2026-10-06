/**
 * Fail the renderer build when the App entry chunk exceeds the budget.
 * Vite's chunkSizeWarningLimit is advisory and does not fail CI.
 *
 * Size uses decimal kB (bytes / 1000), matching Vite's chunkSizeWarningLimit.
 */

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
 * The App chunk is the Rollup output for `src/renderer/App.tsx` (`assets/App-*.js`).
 * Vite code-splits it out of the HTML entry. Vendor manualChunks are not this budget.
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
 * @param {Record<string, { type?: string, isEntry?: boolean, facadeModuleId?: string | null, code?: string }>} bundle
 * @param {number} [limitKb]
 * @returns {string | null} Error text when the budget is missing or exceeded.
 */
export function appEntryChunkBudgetError(bundle, limitKb = APP_ENTRY_CHUNK_BUDGET_KB) {
  /** @type {{ fileName: string, sizeKb: number }[]} */
  const matches = [];
  for (const [fileName, output] of Object.entries(bundle)) {
    if (!isAppEntryChunk(output, fileName)) continue;
    const bytes = Buffer.byteLength(output.code ?? '', 'utf8');
    matches.push({ fileName, sizeKb: bytes / 1000 });
  }
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
 * @param {number} [limitKb]
 * @returns {import('vite').Plugin}
 */
export function appChunkBudgetPlugin(limitKb = APP_ENTRY_CHUNK_BUDGET_KB) {
  return {
    name: 'app-chunk-budget',
    generateBundle(_options, bundle) {
      const message = appEntryChunkBudgetError(bundle, limitKb);
      if (message) this.error(message);
    },
  };
}
