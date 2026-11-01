import fs from 'fs';
import path from 'path';

import {
  planReticulumAttachmentStore,
  RETICULUM_QUARANTINE_DIRNAME,
} from '../shared/reticulum-attachment-types';

export interface ReticulumAttachmentWriteResult {
  path: string;
  quarantined: boolean;
}

/**
 * Safe-receive cache write for inbound/outbound LXMF attachments (no save dialog).
 *
 * - Name is sanitised (no paths, bidi, chat-marker delimiters, device names).
 * - Risky/executable names (`.exe`, `.sh`, `report.pdf.exe`, …) go to
 *   `<attachmentsDir>/quarantine/<ts>-<name>.quarantine`, mode 0600 — never directly runnable.
 * - Everything is written with mode 0600 (never the executable bit) and `wx` so an existing
 *   path is never overwritten or followed through a symlink.
 * - The app never opens/executes cached files; Chat only reads bytes for images/audio or reveals
 *   the folder.
 */
export async function writeReticulumAttachmentCacheFile(
  attachmentsDir: string,
  rawFileName: string,
  data: Buffer,
  now: number = Date.now(),
): Promise<ReticulumAttachmentWriteResult> {
  const plan = planReticulumAttachmentStore(rawFileName);
  const dir = plan.subdir
    ? path.join(attachmentsDir, RETICULUM_QUARANTINE_DIRNAME)
    : attachmentsDir;
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const targetPath = path.join(dir, `${now}-${plan.fileName}`);
  const resolved = path.resolve(targetPath);
  const root = path.resolve(attachmentsDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('attachment path escaped attachments directory');
  }
  try {
    await fs.promises.writeFile(resolved, data, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Same-millisecond twin: disambiguate rather than clobber.
    const alt = path.join(dir, `${now}-${Math.random().toString(36).slice(2, 8)}-${plan.fileName}`);
    await fs.promises.writeFile(alt, data, { flag: 'wx', mode: 0o600 });
    return { path: alt, quarantined: plan.quarantined };
  }
  return { path: resolved, quarantined: plan.quarantined };
}
