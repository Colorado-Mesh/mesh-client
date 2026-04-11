import { describe, expect, it } from 'vitest';

import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';

describe('createRepeaterRemoteRpcQueue', () => {
  it('runs jobs strictly one after another', async () => {
    const order: string[] = [];
    const run = createRepeaterRemoteRpcQueue();

    const p1 = run(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('a');
      return 1;
    });
    const p2 = run(() => {
      order.push('b');
      return Promise.resolve(2);
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual(['a', 'b']);
  });

  it('continues the chain after rejection', async () => {
    const run = createRepeaterRemoteRpcQueue();
    const results: string[] = [];

    await expect(
      run(() => {
        results.push('fail');
        return Promise.reject(new Error('x'));
      }),
    ).rejects.toThrow('x');

    await run(() => {
      results.push('ok');
      return Promise.resolve();
    });

    expect(results).toEqual(['fail', 'ok']);
  });
});
