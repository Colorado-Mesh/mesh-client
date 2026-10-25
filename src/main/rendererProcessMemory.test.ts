import { describe, expect, it } from 'vitest';

import { rendererProcessMemoryBytes } from './rendererProcessMemory';

describe('renderer process physical memory', () => {
  it.each(['linux', 'darwin', 'win32'] as const)(
    'selects the requesting renderer and converts KB to bytes on %s',
    (platform) => {
      const memory = {
        workingSetSize: 1234,
        ...(platform === 'win32' ? { privateBytes: 123 } : {}),
      };
      expect(
        rendererProcessMemoryBytes(
          [
            { pid: 1, type: 'Browser', memory: { workingSetSize: 9000 } },
            { pid: 2, type: 'GPU', memory: { workingSetSize: 8000 } },
            { pid: 3, type: 'Tab', memory: { workingSetSize: 7000 } },
            { pid: 4, type: 'Tab', memory },
          ],
          4,
        ),
      ).toBe(1234 * 1024);
    },
  );

  it('does not substitute another process when the renderer metric is missing', () => {
    expect(
      rendererProcessMemoryBytes(
        [{ pid: 1, type: 'Browser', memory: { workingSetSize: 9000 } }],
        1,
      ),
    ).toBeUndefined();
    expect(rendererProcessMemoryBytes([], 4)).toBeUndefined();
  });

  it.each([0, -1, NaN, Infinity, 1.5])('rejects an unavailable renderer PID: %s', (pid) => {
    expect(
      rendererProcessMemoryBytes([{ pid, type: 'Tab', memory: { workingSetSize: 100 } }], pid),
    ).toBeUndefined();
  });

  it.each([0, -1, NaN, Infinity, Number.MAX_VALUE])(
    'rejects an unavailable or invalid working set: %s',
    (workingSetSize) => {
      expect(
        rendererProcessMemoryBytes([{ pid: 1, type: 'Tab', memory: { workingSetSize } }], 1),
      ).toBeUndefined();
    },
  );
});
