/**
 * Tests for database schema source hygiene (pre-commit / CI guards).
 *
 *  1. js/missing-space-in-string-concatenation — SQL segments ending with a
 *     bare comma ('col TEXT,') produce 'col TEXT,nextCol' when concatenated.
 *     Every segment must carry a trailing space: 'col TEXT, '.
 *
 *  2. Schema sync stamp + init wiring — `db-schema-sync.ts` exports
 *     CURRENT_SCHEMA_VERSION; `database.ts` calls runSchemaUpgrade (no legacy
 *     runMigrations ladder).
 *
 * See scripts/check-db-migrations.mjs for the implementation.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('database migration source checks (CodeQL)', () => {
  const projectRoot = path.resolve(import.meta.dirname ?? __dirname, '..', '..', '..');
  const script = path.join(projectRoot, 'scripts', 'check-db-migrations.mjs');

  it('SQL string segments have spaces after commas (js/missing-space-in-string-concatenation)', () => {
    expect(() =>
      execFileSync('node', [script], { encoding: 'utf8', stdio: 'pipe', cwd: projectRoot }),
    ).not.toThrow();
  });

  it('schema sync exports CURRENT_SCHEMA_VERSION and database init uses runSchemaUpgrade', () => {
    expect(() =>
      execFileSync('node', [script], { encoding: 'utf8', stdio: 'pipe', cwd: projectRoot }),
    ).not.toThrow();
  });
});
