import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiFailure } from '../errors';
import { OsAiHelper } from './osAiHelper';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
let temp: string;
let helper: OsAiHelper;
let child: EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  vi.clearAllMocks();
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-ai-helper-'));
  await fs.writeFile(path.join(temp, 'helper'), 'synthetic');
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  helper = new OsAiHelper(() => path.join(temp, 'helper'), 'darwin');
});
afterEach(async () => {
  helper.kill();
  await fs.rm(temp, { recursive: true, force: true });
  vi.useRealTimers();
});
describe('OS AI helper boundary', () => {
  it('does not spawn on construction or unsupported Linux and handles missing binary', async () => {
    expect(spawn).not.toHaveBeenCalled();
    const linux = new OsAiHelper(() => path.join(temp, 'helper'), 'linux');
    expect(await linux.probe()).toMatchObject({ available: false, reason: 'unsupported-platform' });
    const missing = new OsAiHelper(() => path.join(temp, 'missing'), 'win32');
    expect(await missing.probe()).toMatchObject({ available: false });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('frames probes and reprobes explicit requests', async () => {
    const result = helper.probe();
    expect(child.stdin.read()?.toString()).toContain('"type":"probe"');
    child.stdout.write('{"type":"probe","available":true,"modelLabel":"Apple"}\n');
    expect(await result).toMatchObject({ available: true });
    const again = helper.probe(true);
    child.stdout.write('{"type":"probe","available":false}\n');
    expect(await again).toMatchObject({ available: false });
  });
  it('rejects callback failures without throwing into readline and kills the helper', async () => {
    const running = helper.generate(
      { requestId: 'id', system: 'x', user: 'x', maxTokens: 1 },
      new AbortController().signal,
      () => {
        throw new AiFailure('tooLarge');
      },
    );
    const rejection = expect(running).rejects.toThrow('tooLarge');
    expect(() =>
      child.stdout.write('{"type":"delta","requestId":"id","text":"x"}\n'),
    ).not.toThrow();
    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it('handles stdin EPIPE and unexpected exit with one terminal rejection', async () => {
    const running = helper.generate(
      { requestId: 'id', system: 'x', user: 'x', maxTokens: 1 },
      new AbortController().signal,
      vi.fn(),
    );
    const rejection = expect(running).rejects.toThrow();
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    child.emit('exit', 1);
    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it('cancels promptly, ignores later done and terminates timed out or idle processes', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const running = helper.generate(
      { requestId: 'id', system: 'x', user: 'x', maxTokens: 1 },
      controller.signal,
      vi.fn(),
    );
    const rejected = expect(running).rejects.toThrow('cancelled');
    controller.abort();
    child.stdout.write('{"type":"done","requestId":"id"}\n');
    await rejected;
    expect(child.kill).toHaveBeenCalled();
  });
  it('ignores late malformed output from a cancelled helper after replacement', async () => {
    const old = child;
    const controller = new AbortController();
    const first = helper.generate(
      { requestId: 'old', system: 'x', user: 'x', maxTokens: 1 },
      controller.signal,
      vi.fn(),
    );
    const rejection = expect(first).rejects.toThrow('cancelled');
    controller.abort();
    await rejection;
    const next = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(next as unknown as ReturnType<typeof spawn>);
    const running = helper.generate(
      { requestId: 'new', system: 'x', user: 'x', maxTokens: 1 },
      new AbortController().signal,
      vi.fn(),
    );
    old.stdout.write('not json\n');
    old.stdout.write('{"type":"probe","available":false}\n');
    expect(next.kill).not.toHaveBeenCalled();
    next.stdout.write('{"type":"done","requestId":"new"}\n');
    await running;
  });
});
