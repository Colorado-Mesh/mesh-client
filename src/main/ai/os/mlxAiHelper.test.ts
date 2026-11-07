import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

import { MlxAiHelper } from './mlxAiHelper';

const mockedSpawn = vi.mocked(spawn);

describe('MlxAiHelper', () => {
  let temp: string;
  let binary: string;
  let helper: MlxAiHelper;
  let child: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-helper-'));
    binary = path.join(temp, 'mesh-ai-mlx');
    fs.writeFileSync(binary, '#!/bin/sh\n');
    // Metallib bundle required next to the binary for availableOnHost().
    fs.mkdirSync(path.join(temp, 'mlx-swift_Cmlx.bundle'), { recursive: true });
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    mockedSpawn.mockReset();
    mockedSpawn.mockReturnValue(child as never);
  });

  afterEach(() => {
    helper?.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it('is unavailable off Apple Silicon even when a binary exists', () => {
    helper = new MlxAiHelper(() => binary, 'linux', 'x64');
    expect(helper.availableOnHost()).toBe(false);
  });

  it('is unavailable on Intel Mac', () => {
    helper = new MlxAiHelper(() => binary, 'darwin', 'x64');
    expect(helper.availableOnHost()).toBe(false);
  });

  it('is unavailable when the metallib bundle is missing', () => {
    fs.rmSync(path.join(temp, 'mlx-swift_Cmlx.bundle'), { recursive: true, force: true });
    helper = new MlxAiHelper(() => binary, 'darwin', 'arm64');
    expect(helper.availableOnHost()).toBe(false);
  });

  it('probes and streams generate on Apple Silicon when the helper responds', async () => {
    helper = new MlxAiHelper(() => binary, 'darwin', 'arm64');
    expect(helper.availableOnHost()).toBe(true);

    const probe = helper.probe();
    expect(mockedSpawn).toHaveBeenCalledWith(binary, [], expect.objectContaining({ cwd: temp }));
    expect(child.stdin.read()?.toString()).toContain('"type":"probe"');
    child.stdout.write('{"type":"probe","available":true,"modelLabel":"MLX"}\n');
    await expect(probe).resolves.toBe(true);

    const deltas: string[] = [];
    const done = helper.generate(
      {
        requestId: 'r1',
        system: 'sys',
        user: 'user',
        maxTokens: 32,
        modelPath: '/tmp/model',
      },
      new AbortController().signal,
      (delta) => {
        deltas.push(delta);
      },
    );
    expect(child.stdin.read()?.toString()).toContain('"type":"generate"');
    child.stdout.write('{"type":"delta","requestId":"r1","text":"Hi"}\n');
    child.stdout.write('{"type":"done","requestId":"r1"}\n');
    await done;
    expect(deltas).toEqual(['Hi']);
  });
});
