import fs from 'node:fs/promises';
import path from 'node:path';

import { isUnderCanonicalRoot } from './pathCanonical';
import { readFileUpTo } from './readFileUpTo';
import {
  assertReticulumAttachmentPathJailed,
  getReticulumAttachmentsDir,
} from './reticulum-attachment-path';

/** Maximum audio attachment size for inline read (256 KiB). */
export const RETICULUM_ATTACHMENT_AUDIO_MAX_BYTES = 256 * 1024;

/** IPC rate limit — max reads per rolling window. */
export const RETICULUM_ATTACHMENT_AUDIO_RATE_LIMIT_MAX = 60;
export const RETICULUM_ATTACHMENT_AUDIO_RATE_LIMIT_WINDOW_MS = 60_000;

/** OggS magic bytes for basic file-type validation (prevents non-Ogg reads). */
const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]);

const audioRateTimestamps: number[] = [];

/** Returns true when a new attachment audio read is allowed under the IPC rate limit. */
export function takeReticulumAttachmentAudioRateToken(now = Date.now()): boolean {
  const cutoff = now - RETICULUM_ATTACHMENT_AUDIO_RATE_LIMIT_WINDOW_MS;
  while (audioRateTimestamps.length > 0) {
    const oldest = audioRateTimestamps[0];
    if (oldest === undefined || oldest >= cutoff) break;
    audioRateTimestamps.shift();
  }
  if (audioRateTimestamps.length >= RETICULUM_ATTACHMENT_AUDIO_RATE_LIMIT_MAX) {
    return false;
  }
  audioRateTimestamps.push(now);
  return true;
}

/** Test helper — clears the rate-limit window. */
export function resetReticulumAttachmentAudioRateLimitForTests(): void {
  audioRateTimestamps.length = 0;
}

/**
 * Read a jailed Reticulum audio attachment (OggS) and return its bytes as base64.
 * Validates magic bytes so non-Ogg files are rejected before the bytes leave main.
 * Returns null when the file is empty, too large, not OggS, or out of jail.
 */
export async function readReticulumAttachmentBytes(filePath: string): Promise<string | null> {
  const jailed = assertReticulumAttachmentPathJailed(filePath);
  const realPath = await fs.realpath(path.resolve(jailed));
  if (!isUnderCanonicalRoot(realPath, getReticulumAttachmentsDir())) {
    throw new Error('audio attachment path outside reticulum attachments directory');
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error('audio attachment path is not a file');
  }
  const buf = await readFileUpTo(realPath, RETICULUM_ATTACHMENT_AUDIO_MAX_BYTES);
  if (buf.length === 0) return null;
  if (buf.length < 4 || !buf.subarray(0, 4).equals(OGG_MAGIC)) {
    return null;
  }
  return buf.toString('base64');
}
