import { describe, expect, it, vi } from 'vitest';

import {
  createMeshcoreRepeaterCliQueue,
  normalizeMeshcoreCliCommand,
  redactMeshcoreCliSecrets,
} from './meshcoreRepeaterCliQueue';

describe('infrastructure CLI command queue', () => {
  it('waits for the full reply before running a different command on the same node', async () => {
    const queue = createMeshcoreRepeaterCliQueue();
    let release!: (value: string) => void;
    const first = queue(
      'identity:42',
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const next = vi.fn(() => Promise.resolve('second'));
    const second = queue('identity:42', next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    release('first');
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows other nodes to run and continues after a rejected command', async () => {
    const queue = createMeshcoreRepeaterCliQueue();
    const rejected = queue('a', () => Promise.reject(new Error('timeout')));
    const next = queue('a', () => Promise.resolve('retry'));
    const other = queue('b', () => Promise.resolve('other'));
    await expect(rejected).rejects.toThrow('timeout');
    expect(await other).toBe('other');
    expect(await next).toBe('retry');
  });

  it.each([
    'password secret',
    'set guest.password secret',
    'get guest.password',
    'get prv.key',
    'set prv.key secret',
  ])('redacts both command and reply for %s', (command) => {
    expect(redactMeshcoreCliSecrets(command)).not.toContain('secret');
    expect(redactMeshcoreCliSecrets(command, '> secret')).toBe('[redacted]');
  });

  it('preserves empty string setter delimiters while trimming normal commands', () => {
    expect(normalizeMeshcoreCliCommand(' set guest.password ')).toBe('set guest.password ');
    expect(normalizeMeshcoreCliCommand('set owner.info ')).toBe('set owner.info ');
    expect(normalizeMeshcoreCliCommand('set name Name ')).toBe('set name Name ');
    expect(normalizeMeshcoreCliCommand('  name  ')).toBe('name');
  });

  it('retains normal CLI history', () => {
    expect(redactMeshcoreCliSecrets('get name', '> Repeater')).toBe('> Repeater');
  });
});
