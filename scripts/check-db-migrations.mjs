#!/usr/bin/env node
/**
 * Pre-commit / CI check for SQLite schema sources:
 *
 *  1. js/missing-space-in-string-concatenation — SQL string segments that end
 *     with a comma immediately before the closing quote (e.g. `'col INTEGER,'`)
 *     when concatenated with `+`. Every segment ending with ',' must have a
 *     trailing space: `'col INTEGER, '`.
 *
 *  2. Schema stamp hygiene — `src/main/db-schema-sync.ts` must export
 *     `CURRENT_SCHEMA_VERSION`, and `src/main/database.ts` must invoke
 *     `runSchemaUpgrade` (replacing the old linear `runMigrations` ladder).
 *
 * To suppress a false positive on rule 1, add // db-sql-space-ok with a reason
 * on the same line as the string segment.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_FILES = [
  path.join(ROOT, 'src', 'main', 'database.ts'),
  path.join(ROOT, 'src', 'main', 'db-schema-sync.ts'),
];
const SCHEMA_SYNC = path.join(ROOT, 'src', 'main', 'db-schema-sync.ts');
const DATABASE_TS = path.join(ROOT, 'src', 'main', 'database.ts');

const BARE_COMMA_SEGMENT = /'[^']*[^'\s],'\s*\+/;
const SUPPRESSED_SPACE = /\/\/\s*db-sql-space-ok\b/;
const CURRENT_SCHEMA_RE = /export const CURRENT_SCHEMA_VERSION = (\d+)\s*;/;

function checkSqlSpaces(files) {
  const violations = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const relPath = path.relative(process.cwd(), file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!BARE_COMMA_SEGMENT.test(line)) continue;
      if (SUPPRESSED_SPACE.test(line)) continue;
      violations.push({ file: relPath, lineNum: i + 1, line: line.trim() });
    }
  }
  return violations;
}

function checkSchemaSyncExport() {
  const violations = [];
  const relPath = path.relative(process.cwd(), SCHEMA_SYNC);
  if (!fs.existsSync(SCHEMA_SYNC)) {
    violations.push({
      file: relPath,
      message: 'missing file src/main/db-schema-sync.ts',
    });
    return violations;
  }
  const content = fs.readFileSync(SCHEMA_SYNC, 'utf8');
  const m = content.match(CURRENT_SCHEMA_RE);
  if (!m) {
    violations.push({
      file: relPath,
      message: 'must export exactly one `export const CURRENT_SCHEMA_VERSION = <int>;`',
    });
    return violations;
  }
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) {
    violations.push({
      file: relPath,
      message: `CURRENT_SCHEMA_VERSION must be a positive integer (got ${m[1]})`,
    });
  }
  return violations;
}

function checkDatabaseInit() {
  const violations = [];
  const relPath = path.relative(process.cwd(), DATABASE_TS);
  if (!fs.existsSync(DATABASE_TS)) {
    violations.push({ file: relPath, message: 'missing database.ts' });
    return violations;
  }
  const content = fs.readFileSync(DATABASE_TS, 'utf8');
  if (!content.includes('runSchemaUpgrade')) {
    violations.push({
      file: relPath,
      message: 'init path must call runSchemaUpgrade(db)',
    });
  }
  if (/\bfunction\s+runMigrations\s*\(/.test(content)) {
    violations.push({
      file: relPath,
      message: 'remove legacy function runMigrations — use db-schema-sync.ts',
    });
  }
  return violations;
}

function main() {
  const spaceViolations = checkSqlSpaces(DB_FILES);
  const schemaViolations = [...checkSchemaSyncExport(), ...checkDatabaseInit()];

  if (spaceViolations.length === 0 && schemaViolations.length === 0) {
    process.exit(0);
    return;
  }

  if (spaceViolations.length > 0) {
    console.error(
      'check-db-migrations: SQL string segments missing space after comma ' +
        '(CodeQL js/missing-space-in-string-concatenation):\n',
    );
    for (const v of spaceViolations) {
      console.error(`  ${v.file}:${v.lineNum}`);
      console.error(`    ${v.line}`);
      console.error("    Fix: add a trailing space before the closing quote, e.g. 'col INTEGER, '");
      console.error('');
    }
    console.error(
      'To suppress a false positive, add // db-sql-space-ok with a reason on the same line.\n',
    );
  }

  if (schemaViolations.length > 0) {
    console.error('check-db-migrations: schema upgrade source checks:\n');
    for (const v of schemaViolations) {
      console.error(`  ${v.file}`);
      console.error(`    ${v.message}`);
      console.error('');
    }
  }

  process.exit(1);
}

main();
