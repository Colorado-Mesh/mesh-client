import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

import { MS_PER_MINUTE } from '../../shared/timeConstants';
import type {
  TranslationActionResult,
  TranslationPack,
  TranslationProgress,
} from '../../shared/translation-types';
import { sanitizeLogMessage } from '../sanitize-log-message';
import {
  TRANSLATION_MANIFEST,
  type TranslationAsset,
  type TranslationManifestPack,
} from './translationManifest';

interface InstallJob {
  abort: AbortController;
  promise: Promise<TranslationActionResult>;
  progress: TranslationProgress;
}
export interface PackManagerDependencies {
  directory: () => string;
  enabled: () => boolean;
  fetch: typeof fetch;
  onProgress: (progress: TranslationProgress) => void;
  manifest?: TranslationManifestPack[];
  timeoutMs?: number;
}

/** No constructor I/O. Installs publish a complete verified directory in one rename. */
export class TranslationPackManager {
  private readonly manifest: TranslationManifestPack[];
  private readonly jobs = new Map<string, InstallJob>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly verified = new Map<string, { signature: string; valid: boolean }>();

  constructor(private readonly deps: PackManagerDependencies) {
    this.manifest = deps.manifest ?? TRANSLATION_MANIFEST;
  }

  pack(id: string): TranslationManifestPack {
    const pack = this.manifest.find((entry) => entry.id === id);
    if (!pack || !/^[a-z-]+$/.test(id)) throw new Error('Unknown translation pack');
    return pack;
  }

  assetPath(id: string, file: string): string {
    const pack = this.pack(id);
    if (!pack.assets.some((asset) => asset.file === file) || path.basename(file) !== file) {
      throw new Error('Unknown translation asset');
    }
    return path.join(this.deps.directory(), id, file);
  }

  async verify(id: string): Promise<boolean> {
    const pack = this.pack(id);
    try {
      const dir = await fs.lstat(path.join(this.deps.directory(), id));
      if (!dir.isDirectory() || dir.isSymbolicLink()) return false;
      const stats = await Promise.all(
        pack.assets.map((asset) => fs.lstat(this.assetPath(id, asset.file))),
      );
      if (
        stats.some(
          (stat, index) =>
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size !== (pack.assets[index].decodedSize ?? pack.assets[index].size),
        )
      )
        return false;
      const signature = stats
        .map((stat) => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`)
        .join('|');
      const cached = this.verified.get(id);
      if (cached?.signature === signature) return cached.valid;
      let valid = true;
      for (const asset of pack.assets) {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(this.assetPath(id, asset.file)))
          digest.update(chunk as Buffer);
        if (digest.digest('hex') !== (asset.decodedSha256 ?? asset.sha256)) {
          valid = false;
          break;
        }
      }
      this.verified.set(id, { signature, valid });
      return valid;
    } catch (error) {
      // catch-no-log-ok absent/unreadable packs are reported as not installed, never loaded
      if (!(error instanceof Error)) throw error;
      return false;
    }
  }

  async list(): Promise<TranslationPack[]> {
    return Promise.all(
      this.manifest.map(async (pack) => ({
        id: pack.id,
        source: pack.source,
        target: pack.target,
        license: pack.license,
        downloadBytes: pack.assets.reduce((total, asset) => total + asset.size, 0),
        diskBytes: pack.assets.reduce(
          (total, asset) => total + (asset.decodedSize ?? asset.size),
          0,
        ),
        installed: await this.verify(pack.id),
      })),
    );
  }

  progress(): TranslationProgress[] {
    return [...this.jobs.values()].map((job) => ({ ...job.progress }));
  }

  install(id: string): Promise<TranslationActionResult> {
    const pack = this.pack(id);
    if (!this.deps.enabled()) return Promise.resolve({ ok: false, reason: 'disabled' });
    const existing = this.jobs.get(id);
    if (existing) return existing.promise;
    const job: InstallJob = {
      abort: new AbortController(),
      promise: Promise.resolve({ ok: false }),
      progress: {
        packId: id,
        receivedBytes: 0,
        totalBytes: pack.assets.reduce((sum, asset) => sum + asset.size, 0),
        state: 'queued',
      },
    };
    job.promise = this.tail
      .then(() => this.runInstall(pack, job))
      .finally(() => this.jobs.delete(id));
    this.tail = job.promise.catch(() => {
      /* catch-no-log-ok install caller receives cleanup failure */
    });
    this.jobs.set(id, job);
    this.emit(job);
    return job.promise;
  }

  async cancel(id: string): Promise<void> {
    this.pack(id);
    const job = this.jobs.get(id);
    if (job) {
      job.abort.abort();
      await job.promise;
    }
  }

  async cancelAll(): Promise<void> {
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.abort.abort();
    await Promise.all(jobs.map((job) => job.promise));
  }

  async delete(id: string): Promise<void> {
    this.pack(id);
    this.jobs.get(id)?.abort.abort();
    const operation = this.tail.then(async () => {
      await fs.rm(path.join(this.deps.directory(), id), { recursive: true, force: true });
      this.verified.delete(id);
    });
    this.tail = operation.catch(() => {
      /* catch-no-log-ok caller receives destructive operation failure */
    });
    await operation;
  }

  async removeAll(): Promise<void> {
    for (const job of this.jobs.values()) job.abort.abort();
    const operation = this.tail.then(async () => {
      await fs.rm(this.deps.directory(), { recursive: true, force: true });
      this.verified.clear();
    });
    this.tail = operation.catch(() => {
      /* catch-no-log-ok caller receives destructive operation failure */
    });
    await operation;
  }

  private emit(job: InstallJob): void {
    this.deps.onProgress({ ...job.progress });
  }

  private async runInstall(
    pack: TranslationManifestPack,
    job: InstallJob,
  ): Promise<TranslationActionResult> {
    let temporary: string | undefined;
    try {
      if (!this.deps.enabled() || job.abort.signal.aborted) throw new Error('Download cancelled');
      if (await this.verify(pack.id)) {
        job.progress.state = 'installed';
        this.emit(job);
        return { ok: true };
      }
      await fs.mkdir(this.deps.directory(), { recursive: true, mode: 0o700 });
      temporary = await fs.mkdtemp(path.join(this.deps.directory(), '.install-'));
      for (const asset of pack.assets) await this.download(asset, temporary, job);
      if (!this.deps.enabled() || job.abort.signal.aborted) throw new Error('Download cancelled');
      await fs.rm(path.join(this.deps.directory(), pack.id), { recursive: true, force: true });
      if (!this.deps.enabled() || job.abort.signal.aborted) throw new Error('Download cancelled');
      await fs.rename(temporary, path.join(this.deps.directory(), pack.id));
      if (!this.deps.enabled() || job.abort.signal.aborted) {
        await fs.rm(path.join(this.deps.directory(), pack.id), { recursive: true, force: true });
        throw new Error('Download cancelled');
      }
      temporary = undefined;
      this.verified.delete(pack.id);
      job.progress.state = 'installed';
      this.emit(job);
      return { ok: true };
    } catch (error) {
      const cancelled = job.abort.signal.aborted || !this.deps.enabled();
      job.progress.state = cancelled ? 'cancelled' : 'error';
      this.emit(job);
      if (!cancelled)
        console.warn(
          '[translation] Download failed:',
          sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
        );
      return { ok: false, reason: cancelled ? 'cancelled' : 'downloadFailed' };
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  private async download(
    asset: TranslationAsset,
    directory: string,
    job: InstallJob,
  ): Promise<void> {
    const idle = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetDeadline = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => {
          idle.abort(new Error('Translation download stalled'));
        },
        this.deps.timeoutMs ?? 5 * MS_PER_MINUTE,
      );
    };
    resetDeadline();
    try {
      const signal = AbortSignal.any([job.abort.signal, idle.signal]);
      const response = await this.deps.fetch(asset.url, { signal, redirect: 'error' });
      if (!response.ok || !response.body)
        throw new Error(`Translation download HTTP ${response.status} (${asset.file})`);
      resetDeadline();
      const rawPath = path.join(directory, `${asset.file}.download`);
      const handle = await fs.open(rawPath, 'wx+', 0o600);
      let verifiedBytes: Buffer;
      try {
        const reader = response.body.getReader();
        let received = 0;
        try {
          job.progress.state = 'downloading';
          this.emit(job);
          while (true) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value.byteLength > 0) resetDeadline();
            received += chunk.value.byteLength;
            if (received > asset.size)
              throw new Error('Translation download exceeds manifest size');
            await handle.writeFile(chunk.value);
            job.progress.receivedBytes += chunk.value.byteLength;
            this.emit(job);
          }
        } finally {
          await reader.cancel();
        }
        signal.throwIfAborted();
        if (received !== asset.size) throw new Error('Translation SHA-256 mismatch');
        job.progress.state = 'verifying';
        this.emit(job);
        const raw = Buffer.alloc(received);
        let offset = 0;
        while (offset < raw.length) {
          signal.throwIfAborted();
          const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
          if (bytesRead === 0) throw new Error('Translation download truncated');
          offset += bytesRead;
        }
        if (hash(raw) !== asset.sha256) throw new Error('Translation SHA-256 mismatch');
        verifiedBytes = raw;
        if (asset.decodedSize && asset.decodedSha256) {
          verifiedBytes = zstdDecompressSync(raw, { maxOutputLength: asset.decodedSize });
          if (
            verifiedBytes.length !== asset.decodedSize ||
            hash(verifiedBytes) !== asset.decodedSha256
          )
            throw new Error('Decompressed translation SHA-256 mismatch');
        }
      } finally {
        await handle.close();
      }
      await fs.writeFile(path.join(directory, asset.file), verifiedBytes, {
        flag: 'wx',
        mode: 0o600,
      });
      await fs.rm(rawPath);
      signal.throwIfAborted();
    } finally {
      clearTimeout(idleTimer);
    }
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
