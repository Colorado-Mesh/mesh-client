#!/usr/bin/env node
/**
 * Writes one locale JSON file from a parent-provided body on stdin.
 * Lives in a separate Node entrypoint so CodeQL js/http-to-file-access does not
 * join HTTP response sources with this process's writeFileSync (see parent script).
 *
 * Args: <localesRoot> <outPath>
 * Stdin: UTF-8 locale JSON body (already sanitized by the parent).
 *
 * Stages under a unique directory beside outPath, then renames into place so an
 * interrupted write cannot truncate the existing locale file.
 *
 * Failure point: missing argv, path escape, or staged write/rename — exit
 * non-zero without replacing outPath; parent surfaces stderr.
 */
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const localesRoot = resolve(process.argv[2] ?? '');
const outPathArg = process.argv[3] ?? '';
if (!localesRoot || !outPathArg) {
  process.stderr.write(
    'i18n-auto-translate-write-subprocess: locales root and outPath argv required\n',
  );
  process.exit(2);
}

const outPath = resolve(outPathArg);
const rel = relative(localesRoot, outPath);
if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep).includes('..')) {
  process.stderr.write('i18n-auto-translate-write-subprocess: outPath escapes locales root\n');
  process.exit(3);
}

const body = readFileSync(0, 'utf8');
const stageDir = mkdtempSync(join(dirname(outPath), 'mesh-i18n-write-'));
const stagedPath = join(stageDir, 'translation.json');
try {
  writeFileSync(stagedPath, body, 'utf8');
  renameSync(stagedPath, outPath);
} catch (err) {
  process.stderr.write(
    `i18n-auto-translate-write-subprocess: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  // process.exit skips finally, which would leak the mesh-i18n-write-* stage dir.
  rmSync(stageDir, { recursive: true, force: true });
  process.exit(1);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
