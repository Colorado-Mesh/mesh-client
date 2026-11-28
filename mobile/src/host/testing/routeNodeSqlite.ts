/**
 * Route `require('node:sqlite')` to the mobile shim for a test.
 *
 * The desktop `db-compat` layer loads SQLite with a bare `require('node:sqlite')`, which
 * `vi.mock` does not intercept, so without this a test of `db-compat` would run on Node's own
 * SQLite. The host bundle maps the same request to the shim (`scripts/build-host.mjs`), and this
 * does the same at Node's module loader. Call before importing `@/main/db-compat`.
 */
import { createRequire } from 'node:module';

type Load = (request: string, parent: unknown, isMain: boolean) => unknown;

export function routeNodeSqliteToShim(shim: unknown): () => void {
  const Module = createRequire(import.meta.url)('node:module') as { _load: Load };
  const original = Module._load;
  Module._load = function load(this: unknown, request, parent, isMain) {
    if (request === 'node:sqlite' || request === 'sqlite') return shim;
    return original.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = original;
  };
}
