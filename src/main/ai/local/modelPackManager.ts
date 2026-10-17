import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AiActionResult, AiModelInfo, AiModelProgress } from '../../../shared/ai-types';
import { MS_PER_MINUTE } from '../../../shared/timeConstants';
import { sanitizeLogMessage } from '../../sanitize-log-message';
import { AI_LOCAL_MODELS, type AiLocalAsset, type AiLocalModel } from './modelManifest';

interface InstallJob {
  abort: AbortController;
  promise: Promise<AiActionResult>;
  progress: AiModelProgress;
  lastEmitted?: { state: AiModelProgress['state']; at: number };
}
export interface PackManagerDependencies {
  directory: () => string;
  enabled: () => boolean;
  fetch: typeof fetch;
  onProgress: (progress: AiModelProgress) => void;
  manifest?: AiLocalModel[];
  timeoutMs?: number;
  openHashStream?: (file: string) => AsyncIterable<Uint8Array>;
}

/** No constructor I/O. Installs publish a complete verified directory in one rename. */
export class AiModelPackManager {
  private readonly manifest: AiLocalModel[];
  private readonly jobs = new Map<string, InstallJob>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly verified = new Map<string, { signature: string; valid: boolean }>();
  private readonly verifying = new Map<string, Promise<boolean>>();

  constructor(private readonly deps: PackManagerDependencies) {
    this.manifest = deps.manifest ?? AI_LOCAL_MODELS;
  }

  pack(id: string): AiLocalModel {
    const pack = this.manifest.find((entry) => entry.id === id);
    if (!pack || !/^[a-z0-9.-]+$/.test(id)) throw new Error('Unknown ai pack');
    return pack;
  }

  assetPath(id: string, file: string): string {
    const pack = this.pack(id);
    if (!pack.assets.some((asset) => asset.file === file) || path.basename(file) !== file) {
      throw new Error('Unknown ai asset');
    }
    return path.join(this.deps.directory(), id, file);
  }

  async verify(id: string, advisory = false): Promise<boolean> {
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
            !stat.isFile() || stat.isSymbolicLink() || stat.size !== pack.assets[index].size,
        )
      )
        return false;
      const signature = stats
        .map(
          (stat, index) =>
            `${pack.assets[index].sha256}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
        )
        .join('|');
      const cached = this.verified.get(id);
      if (cached?.signature === signature) return cached.valid;
      // Disk metadata is advisory for the catalog only; serving always verifies SHA-256.
      if (advisory) {
        try {
          const recordPath = path.join(this.deps.directory(), id, '.verified.json');
          const handle = await fs.open(
            recordPath,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
          );
          try {
            const stat = await handle.stat();
            // Some platforms lack O_NOFOLLOW; confirm this handle still names a regular cache file.
            const link = await fs.lstat(recordPath);
            if (
              stat.isFile() &&
              !link.isSymbolicLink() &&
              link.dev === stat.dev &&
              link.ino === stat.ino &&
              stat.size < 16384
            ) {
              const bytes = Buffer.alloc(16384);
              const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
              const record: unknown = JSON.parse(bytes.toString('utf8', 0, bytesRead));
              if (
                record &&
                typeof record === 'object' &&
                'signature' in record &&
                record.signature === signature
              )
                return true;
            }
          } finally {
            await handle.close();
          }
        } catch {
          // catch-no-log-ok missing/corrupt advisory metadata falls back to hashing
        }
      }
      const key = `${id}:${signature}`;
      let pending = this.verifying.get(key);
      if (!pending) {
        pending = this.verifyFiles(pack, signature);
        this.verifying.set(key, pending);
      }
      try {
        return await pending;
      } finally {
        if (this.verifying.get(key) === pending) this.verifying.delete(key);
      }
    } catch (error) {
      // catch-no-log-ok absent/unreadable packs are reported as not installed, never loaded
      if (!(error instanceof Error)) throw error;
      return false;
    }
  }

  private async verifyFiles(pack: AiLocalModel, signature: string): Promise<boolean> {
    let valid = true;
    for (const asset of pack.assets) {
      const digest = createHash('sha256');
      const stream: AsyncIterable<Uint8Array> = (this.deps.openHashStream ?? createReadStream)(
        this.assetPath(pack.id, asset.file),
      );
      for await (const chunk of stream) digest.update(chunk);
      if (digest.digest('hex') !== asset.sha256) {
        valid = false;
        break;
      }
    }
    this.verified.set(pack.id, { signature, valid });
    if (valid) {
      let temporary: string | undefined;
      try {
        temporary = await fs.mkdtemp(path.join(this.deps.directory(), pack.id, '.verify-'));
        await fs.writeFile(path.join(temporary, 'record'), JSON.stringify({ signature }), {
          mode: 0o600,
        });
        await fs.rename(
          path.join(temporary, 'record'),
          path.join(this.deps.directory(), pack.id, '.verified.json'),
        );
      } catch {
        // catch-no-log-ok advisory cache failure does not invalidate a verified model
      } finally {
        if (temporary)
          await fs.rm(temporary, { recursive: true, force: true }).catch(() => {
            // catch-no-log-ok advisory cache cleanup cannot affect model integrity
          });
      }
    }
    return valid;
  }

  async list(): Promise<AiModelInfo[]> {
    return Promise.all(
      this.manifest.map(async (pack) => ({
        id: pack.id,
        name: pack.name,
        paramsLabel: pack.paramsLabel,
        license: pack.license,
        downloadBytes: pack.assets.reduce((total, asset) => total + asset.size, 0),
        diskBytes: pack.assets.reduce((total, asset) => total + asset.size, 0),
        installed: await this.verify(pack.id, true),
      })),
    );
  }

  progress(): AiModelProgress[] {
    return [...this.jobs.values()].map((job) => ({ ...job.progress }));
  }

  install(id: string): Promise<AiActionResult> {
    const pack = this.pack(id);
    if (!this.deps.enabled()) return Promise.resolve({ ok: false, reason: 'disabled' });
    const existing = this.jobs.get(id);
    if (existing) return existing.promise;
    const job: InstallJob = {
      abort: new AbortController(),
      promise: Promise.resolve({ ok: false }),
      progress: {
        modelId: id,
        receivedBytes: 0,
        totalBytes: pack.assets.reduce((sum, asset) => sum + asset.size, 0),
        state: 'queued',
      },
    };
    job.promise = this.tail
      .then(() => this.runInstall(pack, job))
      .finally(() => this.jobs.delete(id));
    this.tail = job.promise.catch(() => {
      // catch-no-log-ok install caller receives cleanup failure
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
      // catch-no-log-ok caller receives destructive operation failure
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
      // catch-no-log-ok caller receives destructive operation failure
    });
    await operation;
  }

  private emit(job: InstallJob): void {
    const now = Date.now();
    if (job.lastEmitted?.state === job.progress.state && now - job.lastEmitted.at < 100) return;
    job.lastEmitted = { state: job.progress.state, at: now };
    this.deps.onProgress({ ...job.progress });
  }

  private async runInstall(pack: AiLocalModel, job: InstallJob): Promise<AiActionResult> {
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
          '[ai] Download failed:',
          sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
        );
      return { ok: false, reason: cancelled ? 'cancelled' : 'downloadFailed' };
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  private async download(asset: AiLocalAsset, directory: string, job: InstallJob): Promise<void> {
    const idle = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetDeadline = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => {
          idle.abort(new Error('AI download stalled'));
        },
        this.deps.timeoutMs ?? 5 * MS_PER_MINUTE,
      );
    };
    resetDeadline();
    try {
      const signal = AbortSignal.any([job.abort.signal, idle.signal]);
      const response =
        asset.content !== undefined
          ? new Response(asset.content)
          : await this.deps.fetch(asset.url, { signal, redirect: 'follow' });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {
          // catch-no-log-ok failed download cleanup must not hide the HTTP failure
        });
        throw new Error(`AI download HTTP ${response.status} (${asset.file})`);
      }
      resetDeadline();
      const rawPath = path.join(directory, `${asset.file}.download`);
      const handle = await fs.open(rawPath, 'wx+', 0o600);
      const digest = createHash('sha256');
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
            if (received > asset.size) throw new Error('AI download exceeds manifest size');
            await handle.writeFile(chunk.value);
            digest.update(chunk.value);
            job.progress.receivedBytes += chunk.value.byteLength;
            this.emit(job);
          }
        } finally {
          await reader.cancel();
        }
        signal.throwIfAborted();
        if (received !== asset.size) throw new Error('AI SHA-256 mismatch');
        job.progress.state = 'verifying';
        this.emit(job);
        if (digest.digest('hex') !== asset.sha256) throw new Error('AI SHA-256 mismatch');
      } finally {
        await handle.close();
      }
      await fs.rename(rawPath, path.join(directory, asset.file));
      signal.throwIfAborted();
    } finally {
      clearTimeout(idleTimer);
    }
  }
}
