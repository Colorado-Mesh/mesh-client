import type { MockInstance } from 'vitest';
import { vi } from 'vitest';

export interface ConsoleWarnMock {
  spy: MockInstance<(message?: unknown, ...optionalParams: unknown[]) => void>;
  restore: () => void;
}

/** Suppresses console.warn for the duration of a test; always restores on completion. */
export function mockConsoleWarn(): ConsoleWarnMock {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return {
    spy,
    restore: () => {
      spy.mockRestore();
    },
  };
}

/** Runs fn with console.warn suppressed; restores the spy even when fn throws. */
export async function withMockedConsoleWarn(fn: () => void | Promise<void>): Promise<void> {
  const { restore } = mockConsoleWarn();
  try {
    await fn();
  } finally {
    restore();
  }
}
