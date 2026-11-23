import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./crash-report-dialog', () => ({
  showCrashReportDialog: vi.fn(),
}));

vi.mock('./log-service', async () => {
  const actual = await vi.importActual('./log-service');
  return {
    ...(actual as object),
    flushLogBeforeQuit: vi.fn(() => Promise.resolve()),
  };
});

import {
  logCaughtDebug,
  logCaughtWarn,
  reportCaughtSeriousError,
  warnWithLogId,
} from './caughtErrorPolicy';
import { showCrashReportDialog } from './crash-report-dialog';
import { flushLogBeforeQuit } from './log-service';

describe('caughtErrorPolicy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logCaughtDebug writes debug without rethrowing', () => {
    expect(() => {
      logCaughtDebug('unit', new Error('soft'));
    }).not.toThrow();
    expect(console.debug).toHaveBeenCalled();
  });

  it('logCaughtWarn embeds mcL id', () => {
    logCaughtWarn('mcL0001', 'unit', new Error('x'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('mcL0001'));
  });

  it('reportCaughtSeriousError logs, flushes, and opens dialog without throwing', () => {
    expect(() => {
      reportCaughtSeriousError('mcL0002', 'unit-test', new Error('boom'));
    }).not.toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('mcL0002'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Caught serious error'));
    expect(flushLogBeforeQuit).toHaveBeenCalled();
    expect(showCrashReportDialog).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'caught:unit-test' }),
    );
  });

  it('warnWithLogId prefixes string messages', () => {
    warnWithLogId('mcL0001', 'hello');
    expect(console.warn).toHaveBeenCalledWith('mcL0001 hello');
  });
});
