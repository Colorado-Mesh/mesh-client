import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  parseServiceAnnouncementFeedText,
  SERVICE_ANNOUNCEMENT_FEED_REPO_PATH,
  SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES,
} from './serviceAnnouncementFeed';

type FeedSource = { kind: 'missing' } | { kind: 'present'; bytes: Buffer };

function git(repoRoot: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * The feed as it will be committed: the index blob in a git checkout (so partial staging is
 * validated, not the working tree), the working-tree file only outside git. An absent blob or
 * file is the supported "no announcements" state (clients treat a 404 as an empty feed).
 */
function readFeedForCommit(repoRoot: string): FeedSource {
  let inGit = false;
  try {
    git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    inGit = true;
  } catch {
    // catch-no-log-ok not a git checkout (e.g. source tarball); fall back to the working tree
  }
  if (inGit) {
    try {
      return {
        kind: 'present',
        bytes: git(repoRoot, ['show', `:${SERVICE_ANNOUNCEMENT_FEED_REPO_PATH}`]),
      };
    } catch {
      // catch-no-log-ok path absent from the index (deleted or never added)
      return { kind: 'missing' };
    }
  }
  const file = join(repoRoot, SERVICE_ANNOUNCEMENT_FEED_REPO_PATH);
  return existsSync(file) ? { kind: 'present', bytes: readFileSync(file) } : { kind: 'missing' };
}

function feedProblems(source: FeedSource): string[] {
  if (source.kind === 'missing') return [];
  if (source.bytes.byteLength > SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES) {
    return [
      `feed is ${source.bytes.byteLength} bytes (cap ${SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES})`,
    ];
  }
  const result = parseServiceAnnouncementFeedText(source.bytes.toString('utf8'));
  if (!result.ok) return [result.reason];
  // Clients silently drop rejected rows, so any rejection means a notice would never show.
  return result.rejected.map((r) => `row #${r.index}: ${r.reason}`);
}

// Pre-commit appends this test whenever the feed is staged (scripts/precommit-tests.mjs).
describe(`committed ${SERVICE_ANNOUNCEMENT_FEED_REPO_PATH}`, () => {
  it('is absent or parses within the size cap with every row accepted', () => {
    expect(feedProblems(readFeedForCommit(join(__dirname, '..', '..')))).toEqual([]);
  });
});

describe('readFeedForCommit', () => {
  const repo = mkdtempSync(join(tmpdir(), 'mesh-announce-feed-'));
  const feedFile = join(repo, SERVICE_ANNOUNCEMENT_FEED_REPO_PATH);
  const valid = JSON.stringify({ schema: 1, announcements: [] });
  git(repo, ['init', '-q']);
  mkdirSync(dirname(feedFile), { recursive: true });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('treats a feed absent from the index as missing, even if the working tree has one', () => {
    writeFileSync(feedFile, '{not json');
    expect(readFeedForCommit(repo)).toEqual({ kind: 'missing' });
    expect(feedProblems(readFeedForCommit(repo))).toEqual([]);
  });

  it('validates the staged blob, not unstaged working-tree edits', () => {
    writeFileSync(feedFile, valid);
    git(repo, ['add', SERVICE_ANNOUNCEMENT_FEED_REPO_PATH]);
    writeFileSync(feedFile, '{not json');
    expect(feedProblems(readFeedForCommit(repo))).toEqual([]);

    writeFileSync(feedFile, JSON.stringify({ schema: 1, announcements: [{ id: 'BAD' }] }));
    git(repo, ['add', SERVICE_ANNOUNCEMENT_FEED_REPO_PATH]);
    writeFileSync(feedFile, valid);
    expect(feedProblems(readFeedForCommit(repo))).toEqual([expect.stringMatching(/^row #0: /)]);
  });

  it('accepts a feed deleted from both the index and working tree', () => {
    git(repo, ['rm', '-q', '-f', '--cached', SERVICE_ANNOUNCEMENT_FEED_REPO_PATH]);
    rmSync(feedFile);
    expect(readFeedForCommit(repo)).toEqual({ kind: 'missing' });
  });
});
