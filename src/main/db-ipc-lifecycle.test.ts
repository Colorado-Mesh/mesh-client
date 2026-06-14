// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finishDbIpcHandler, finishDbIpcReadHandler, getDbForIpc } from './db-ipc-lifecycle';

vi.mock('./database', () => ({
  DATABASE_CLOSED_MESSAGE: '[db] Database is closed',
  getDatabaseIfOpen: vi.fn(),
  isDatabaseClosed: vi.fn(),
}));

vi.mock('./sanitize-log-message', () => ({
  sanitizeLogMessage: (msg: string) => msg,
}));

import { getDatabaseIfOpen, isDatabaseClosed } from './database';

describe('getDbForIpc', () => {
  beforeEach(() => {
    vi.mocked(getDatabaseIfOpen).mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {
      /* noop */
    });
  });

  it('returns db when open', () => {
    const db = { prepareOnce: vi.fn() } as never;
    vi.mocked(getDatabaseIfOpen).mockReturnValue(db);
    expect(getDbForIpc('db:getNodes')).toBe(db);
  });

  it('returns null and logs when database is closed', () => {
    vi.mocked(getDatabaseIfOpen).mockReturnValue(null);
    expect(getDbForIpc('db:getNodes')).toBeNull();
    expect(console.debug).toHaveBeenCalledWith('[IPC] db:getNodes: skipped (database closed)');
  });
});

describe('finishDbIpcHandler', () => {
  beforeEach(() => {
    vi.mocked(isDatabaseClosed).mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {
      /* noop */
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      /* noop */
    });
  });

  it('swallows errors when database is closed', () => {
    vi.mocked(isDatabaseClosed).mockReturnValue(true);
    expect(() => {
      finishDbIpcHandler('db:saveMessage', new Error('boom'));
    }).not.toThrow();
    expect(console.debug).toHaveBeenCalledWith('[IPC] db:saveMessage: skipped (database closed)');
  });

  it('rethrows real failures', () => {
    vi.mocked(isDatabaseClosed).mockReturnValue(false);
    const err = new Error('SQLITE_BUSY');
    expect(() => {
      finishDbIpcHandler('db:saveMessage', err);
    }).toThrow(err);
  });
});

describe('finishDbIpcReadHandler', () => {
  beforeEach(() => {
    vi.mocked(isDatabaseClosed).mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => {
      /* noop */
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      /* noop */
    });
  });

  it('returns fallback when database is closed', () => {
    vi.mocked(isDatabaseClosed).mockReturnValue(true);
    expect(finishDbIpcReadHandler('db:getNodes', new Error('boom'), [])).toEqual([]);
  });

  it('rethrows real failures', () => {
    vi.mocked(isDatabaseClosed).mockReturnValue(false);
    const err = new Error('SQLITE_BUSY');
    expect(() => {
      finishDbIpcReadHandler('db:getNodes', err, []);
    }).toThrow(err);
  });
});
