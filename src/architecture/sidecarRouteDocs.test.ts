// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: every Reticulum sidecar HTTP route registered in `api/mod.rs` has a row (or prose
 * mention) in `docs/reticulum-sidecar-ipc.md`, and every documented path still exists.
 * Paths only — methods are chained (`get(..).put(..)`) and not worth parsing.
 *
 * Neither test selector finds this file by import; `scripts/precommit-tests.mjs`
 * (`appendSidecarRouteDocsTestIfNeeded`) appends it when either input is staged or changed.
 */
const REPO_ROOT = join(__dirname, '../..');
const SIDECAR_ROUTES_SOURCE = 'reticulum-sidecar/src/api/mod.rs';
const SIDECAR_IPC_DOC = 'docs/reticulum-sidecar-ipc.md';

/** Routes deliberately left out of the IPC doc. Each entry needs a reason. */
const UNDOCUMENTED_ROUTE_ALLOWLIST: Readonly<Record<string, string>> = {};

function normalizeRoutePath(raw: string): string {
  return raw
    .replace(/[?#].*$/, '')
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}')
    .replace(/\/+$/, '');
}

function extractSidecarRoutes(rustSource: string): Set<string> {
  const out = new Set<string>();
  for (const m of rustSource.matchAll(/"(\/api\/v1\/[^"\s]+|\/ws)"/g)) {
    out.add(normalizeRoutePath(m[1]));
  }
  return out;
}

function extractDocumentedRoutes(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const span of markdown.matchAll(/`([^`\n]+)`/g)) {
    for (const m of span[1].matchAll(/(\/api\/v1\/[^\s`|,)]+)/g)) {
      const path = m[1];
      if (path.includes('*')) continue;
      out.add(normalizeRoutePath(path));
    }
    if (/(^|\s)\/ws$/.test(span[1].trim())) out.add('/ws');
  }
  return out;
}

const routes = extractSidecarRoutes(readFileSync(join(REPO_ROOT, SIDECAR_ROUTES_SOURCE), 'utf-8'));
const documented = extractDocumentedRoutes(readFileSync(join(REPO_ROOT, SIDECAR_IPC_DOC), 'utf-8'));

describe('sidecar routes vs IPC doc', () => {
  it('parses a plausible number of routes', () => {
    expect(routes.size).toBeGreaterThan(50);
    expect(documented.size).toBeGreaterThan(50);
  });

  it('every registered route is documented (or allowlisted with a reason)', () => {
    const missing = [...routes]
      .filter((r) => !documented.has(r) && !(r in UNDOCUMENTED_ROUTE_ALLOWLIST))
      .sort();
    expect(missing, `Add rows to ${SIDECAR_IPC_DOC} for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every documented route still exists in the sidecar', () => {
    const stale = [...documented].filter((r) => !routes.has(r)).sort();
    expect(stale, `Remove or fix stale rows in ${SIDECAR_IPC_DOC}: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('allowlist entries are real routes with reasons', () => {
    for (const [route, reason] of Object.entries(UNDOCUMENTED_ROUTE_ALLOWLIST)) {
      expect(routes.has(route), route).toBe(true);
      expect(reason.trim().length, route).toBeGreaterThan(0);
    }
  });
});

describe('route extraction helpers', () => {
  it('normalizes placeholders and query strings', () => {
    expect(normalizeRoutePath('/api/v1/nomadnetwork/file/{hash}?path=…')).toBe(
      '/api/v1/nomadnetwork/file/{}',
    );
    expect(normalizeRoutePath('/api/v1/games/sessions/:id/read')).toBe(
      '/api/v1/games/sessions/{}/read',
    );
  });

  it('finds paths inside prose code spans and skips wildcards', () => {
    const md = 'Use `POST /api/v1/stack/flush-state` and `/api/v1/games/*`.\n| GET | `/ws` |';
    expect([...extractDocumentedRoutes(md)].sort()).toEqual(['/api/v1/stack/flush-state', '/ws']);
  });
});
