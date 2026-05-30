import { describe, expect, it } from 'vitest';

import { buildDevConcurrentlyArgs, resolveDevExitCode } from './run-dev.mjs';

describe('run-dev', () => {
  it('buildDevConcurrentlyArgs kills siblings when electron exits and uses direct esbuild', () => {
    const args = buildDevConcurrentlyArgs();
    expect(args).toContain('-k');
    expect(args).toContain('command-electron');
    expect(args.some((arg) => arg.startsWith('esbuild src/main/index.ts'))).toBe(true);
    expect(args.some((arg) => arg.startsWith('esbuild src/preload/index.ts'))).toBe(true);
    expect(args).toContain('vite');
    expect(args.some((arg) => arg.includes('wait-for-dev.mjs'))).toBe(true);
    expect(args.some((arg) => arg.startsWith('pnpm run'))).toBe(false);
  });

  it('resolveDevExitCode treats intentional signals as success', () => {
    expect(resolveDevExitCode(null, 'SIGINT')).toBe(0);
    expect(resolveDevExitCode(null, 'SIGTERM')).toBe(0);
    expect(resolveDevExitCode(0, null)).toBe(0);
    expect(resolveDevExitCode(1, null)).toBe(1);
  });
});
