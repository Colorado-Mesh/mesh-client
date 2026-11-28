import { describe, expect, it } from 'vitest';

import config from '../capacitor.config';

describe('Capacitor config', () => {
  it('keeps logging and WebView debugging to debug builds', () => {
    // 'production' would log plugin results (including the secure-storage key) in release builds.
    expect(config.loggingBehavior ?? 'debug').toBe('debug');
    expect(config.android?.loggingBehavior ?? 'debug').toBe('debug');
    expect(config.ios?.loggingBehavior ?? 'debug').toBe('debug');
    expect(config.android?.webContentsDebuggingEnabled ?? false).toBe(false);
    expect(config.ios?.webContentsDebuggingEnabled ?? false).toBe(false);
  });

  it('draws edge to edge with light status-bar icons on the slate background', () => {
    const bars = config.plugins?.SystemBars as Record<string, unknown> | undefined;
    expect(bars).toMatchObject({ insetsHandling: 'css', style: 'DARK' });
    expect(config.ios?.contentInset).toBe('never');
  });

  it('serves the package web bundle into the package native projects', () => {
    expect(config).toMatchObject({
      webDir: 'dist',
      android: { path: 'android' },
      ios: { path: 'ios' },
    });
  });
});
