#!/usr/bin/env node
/**
 * Pre-commit: warn loudly when a commit adds, changes, or removes developer service
 * announcements. Every running mesh-client fetches `announcements/announcements.json` from
 * `main`, so merged text reaches all users within minutes.
 *
 * - Added / changed / removed announcements: prominent warning, commit continues.
 * - Staged feed that is not valid JSON or has the wrong top-level shape: commit blocked.
 *   (Field-level validation runs in src/shared/serviceAnnouncementFeed.file.test.ts, which
 *   scripts/precommit-tests.mjs appends whenever the feed is staged.)
 *
 * Usage: node scripts/check-service-announcements.mjs   (compares index vs HEAD)
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_ANNOUNCEMENT_FEED_PATH = 'announcements/announcements.json';

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Index feed rows by id (rows without a string id are keyed by position).
 * `null` text means the file does not exist; empty text is an empty feed.
 * @param {string | null} text
 * @returns {{ ok: true, rows: Map<string, { json: string, title: string }> } | { ok: false, reason: string }}
 */
export function readAnnouncementRows(text) {
  const rows = new Map();
  if (text == null || text.trim() === '') return { ok: true, rows };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!isPlainObject(data)) return { ok: false, reason: 'top level must be a JSON object' };
  if (!Array.isArray(data.announcements)) {
    return { ok: false, reason: '"announcements" must be an array' };
  }
  data.announcements.forEach((row, index) => {
    const id = isPlainObject(row) && typeof row.id === 'string' ? row.id : `#${index}`;
    const title = isPlainObject(row) && typeof row.title === 'string' ? row.title : '';
    rows.set(id, { json: JSON.stringify(row), title });
  });
  return { ok: true, rows };
}

/**
 * @param {string | null} previousText HEAD version (null when absent; unparsable counts as empty)
 * @param {string | null} nextText staged version
 * @returns {{ ok: true, added: string[], changed: string[], removed: string[], titles: Map<string, string> } | { ok: false, reason: string }}
 */
export function diffAnnouncements(previousText, nextText) {
  const next = readAnnouncementRows(nextText);
  if (!next.ok) return next;
  const prevParsed = readAnnouncementRows(previousText);
  const prev = prevParsed.ok ? prevParsed.rows : new Map();

  const added = [];
  const changed = [];
  const removed = [];
  const titles = new Map();
  for (const [id, row] of next.rows) {
    titles.set(id, row.title);
    const before = prev.get(id);
    if (!before) added.push(id);
    else if (before.json !== row.json) changed.push(id);
  }
  for (const [id, row] of prev) {
    if (!next.rows.has(id)) {
      removed.push(id);
      titles.set(id, row.title);
    }
  }
  return { ok: true, added, changed, removed, titles };
}

/**
 * @param {{ added: string[], changed: string[], removed: string[], titles: Map<string, string> }} diff
 * @returns {string} empty when nothing user-visible changed
 */
export function formatAnnouncementWarning(diff) {
  if (diff.added.length + diff.changed.length + diff.removed.length === 0) return '';
  const line = (id) => {
    const title = diff.titles.get(id);
    return title ? `      - ${id}: "${title}"` : `      - ${id}`;
  };
  const rule = '='.repeat(78);
  const out = [
    '',
    rule,
    '  WARNING: this commit changes developer announcements shown to EVERY mesh-client user',
    rule,
    `  File: ${SERVICE_ANNOUNCEMENT_FEED_PATH}`,
    '  Once merged to main, running apps pick this up within minutes (next feed check).',
  ];
  if (diff.added.length > 0) out.push('', '  Added:', ...diff.added.map(line));
  if (diff.changed.length > 0) out.push('', '  Changed:', ...diff.changed.map(line));
  if (diff.removed.length > 0)
    out.push('', '  Removed (retracted from users):', ...diff.removed.map(line));
  out.push(
    '',
    '  If this was not intentional, unstage it:',
    `      git restore --staged ${SERVICE_ANNOUNCEMENT_FEED_PATH}`,
    '  Authoring guide: docs/service-announcements.md',
    rule,
    '',
  );
  return out.join('\n');
}

/**
 * @param {string} spec e.g. `:path` (index) or `HEAD:path`
 * @returns {string | null}
 */
function gitShow(spec) {
  try {
    return execFileSync('git', ['show', spec], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    // catch-no-log-ok missing blob (new file / no HEAD) is a normal state
    return null;
  }
}

function main() {
  const staged = gitShow(`:${SERVICE_ANNOUNCEMENT_FEED_PATH}`);
  const head = gitShow(`HEAD:${SERVICE_ANNOUNCEMENT_FEED_PATH}`);
  if (staged == null) {
    if (head != null) {
      process.stderr.write(
        `check-service-announcements: ${SERVICE_ANNOUNCEMENT_FEED_PATH} is being deleted; ` +
          'clients will show no announcements.\n',
      );
    }
    return 0;
  }
  const diff = diffAnnouncements(head, staged);
  if (!diff.ok) {
    process.stderr.write(
      `check-service-announcements: ${SERVICE_ANNOUNCEMENT_FEED_PATH} ${diff.reason}\n`,
    );
    return 1;
  }
  const warning = formatAnnouncementWarning(diff);
  if (warning) process.stderr.write(`${warning}\n`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
