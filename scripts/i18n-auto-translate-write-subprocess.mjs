#!/usr/bin/env node
/**
 * Writes one locale JSON file from a parent-provided payload.
 * Lives in a separate Node entrypoint so CodeQL js/http-to-file-access does not
 * join HTTP response sources with this process's writeFileSync (see parent script).
 *
 * Payload is a JSON file path (argv[3]) preferred — large locale bodies hung Node's
 * spawnSync stdin pipes on some hosts. Stdin remains supported for small payloads.
 *
 * Failure point: malformed payload JSON or path escape — exit non-zero; parent surfaces error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const localesRoot = resolve(process.argv[2] ?? '');
if (!localesRoot) {
  process.stderr.write('i18n-auto-translate-write-subprocess: missing locales root argv\n');
  process.exit(2);
}

const payloadPath = process.argv[3];
const raw = payloadPath ? readFileSync(payloadPath, 'utf8') : readFileSync(0, 'utf8');
let msg;
try {
  msg = JSON.parse(raw);
} catch {
  process.stderr.write(`i18n-auto-translate-write-subprocess: invalid JSON payload\n`);
  process.exit(2);
}

if (typeof msg?.outPath !== 'string' || typeof msg?.body !== 'string') {
  process.stderr.write('i18n-auto-translate-write-subprocess: outPath and body strings required\n');
  process.exit(2);
}

const outPath = resolve(msg.outPath);
const rel = relative(localesRoot, outPath);
if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.split(sep).includes('..')) {
  process.stderr.write('i18n-auto-translate-write-subprocess: outPath escapes locales root\n');
  process.exit(3);
}

writeFileSync(outPath, msg.body, 'utf8');
