import { describe, expect, it } from 'vitest';

import {
  DB_SCHEMA_TOO_NEW_LOG_PATTERN,
  parseDatabaseSchemaTooNewFromMessage,
} from './databaseSchemaTooNew';

describe('parseDatabaseSchemaTooNewFromMessage', () => {
  it('parses versions from DatabaseSchemaTooNewError message', () => {
    const message = '[db] Database schema v40 is newer than this app supports (v36)';
    expect(parseDatabaseSchemaTooNewFromMessage(message)).toEqual({
      dbVersion: 40,
      appVersion: 36,
    });
  });

  it('parses when wrapped by runSchemaUpgrade failed prefix', () => {
    const message =
      'runSchemaUpgrade failed: [db] Database schema v40 is newer than this app supports (v36)';
    expect(parseDatabaseSchemaTooNewFromMessage(message)).toEqual({
      dbVersion: 40,
      appVersion: 36,
    });
  });

  it('returns null for unrelated errors', () => {
    expect(parseDatabaseSchemaTooNewFromMessage('Import failed: corrupt file')).toBeNull();
    expect(DB_SCHEMA_TOO_NEW_LOG_PATTERN.test('no match')).toBe(false);
  });
});
