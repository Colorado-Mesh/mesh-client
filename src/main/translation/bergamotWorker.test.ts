import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BergamotWorker } from './bergamotWorker';
import type { TranslationWorkerJob } from './bergamotWorkerRuntime';

class FakeWorker extends EventEmitter {
  postMessage = vi.fn<(job: TranslationWorkerJob) => void>();
  terminate = vi.fn(() => Promise.resolve(0));
}
const job = {
  text: 'Bonjour tout le monde',
  engine: { wasm: '/engine', fasttext: '/fasttext', lid: '/lid' },
};
describe('Bergamot worker host', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('serializes requests and rejects queued work on disable', async () => {
    const fake = new FakeWorker();
    const host = new BergamotWorker({ createWorker: () => fake });
    const first = host.run(job);
    const second = host.run(job);
    const secondFailure = expect(second).rejects.toThrow();
    await vi.waitFor(() => {
      expect(fake.postMessage).toHaveBeenCalledTimes(1);
    });
    expect(fake.postMessage).toHaveBeenCalledTimes(1);
    fake.emit('message', { id: 1, detection: { language: 'fr', confidence: 0.9 } });
    host.dispose();
    await first;
    await secondFailure;
    expect(fake.terminate).toHaveBeenCalled();
  });
  it('terminates on a host deadline and restarts after failure', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const host = new BergamotWorker({
      timeoutMs: 10,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = host.run(job);
    const failed = expect(first).rejects.toThrow('failed');
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    expect(workers[0].terminate).toHaveBeenCalled();
    const next = host.run(job);
    await vi.advanceTimersByTimeAsync(0);
    workers[1].emit('message', { id: 2, text: 'Hello' });
    expect(await next).toMatchObject({ text: 'Hello' });
    host.dispose();
  });

  it('observes an idle worker crash and waits for termination before replacing it', async () => {
    const workers: FakeWorker[] = [];
    let terminated!: () => void;
    const host = new BergamotWorker({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = host.run(job);
    await vi.waitFor(() => {
      expect(workers[0]?.postMessage).toHaveBeenCalled();
    });
    workers[0].emit('message', { id: 1, text: 'Hello' });
    await first;
    workers[0].terminate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          terminated = () => {
            resolve(0);
          };
        }),
    );
    workers[0].emit('error', new Error('idle native crash'));
    const replacement = host.run(job);
    await Promise.resolve();
    await Promise.resolve();
    expect(workers).toHaveLength(1);
    terminated();
    await vi.waitFor(() => {
      expect(workers).toHaveLength(2);
    });
    workers[1].emit('message', { id: 2, text: 'Recovered' });
    expect(await replacement).toMatchObject({ text: 'Recovered' });
    host.dispose();
  });
});
