#!/usr/bin/env node
/**
 * Mobile log ID gate (mirrors scripts/check-log-ids.mjs for the desktop):
 * - every console.warn/console.error in mobile/src (non-test) carries an `mcM####` id;
 * - every id used is registered in mobile/src/logMessageIds.ts, and every registered id is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const REGISTRY = path.join(SRC, 'logMessageIds.ts');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && p !== REGISTRY)
      out.push(p);
  }
  return out;
}

const registry = new Set(fs.readFileSync(REGISTRY, 'utf8').match(/mcM\d{4}/g) ?? []);
const used = new Set();
const problems = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const id of text.match(/mcM\d{4}/g) ?? []) used.add(id);
  const re = /console\.(warn|error)\(/g;
  let m;
  while ((m = re.exec(text))) {
    const window = text.slice(m.index, m.index + 400);
    const close = window.indexOf(');');
    const call = close >= 0 ? window.slice(0, close) : window;
    if (!/mcM\d{4}/.test(call)) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${path.relative(ROOT, file)}:${line}: console.${m[1]} missing mcM####`);
    }
  }
}
for (const id of used) if (!registry.has(id)) problems.push(`${id} used but not registered`);
for (const id of registry) if (!used.has(id)) problems.push(`${id} registered but unused`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.info(`mobile check-log-ids: ok (${registry.size} ids)`);
