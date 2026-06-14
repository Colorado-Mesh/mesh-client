// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { DatabaseSchemaTooNewError } from './db-schema-sync';
import { formatDatabaseSchemaTooNewMessage } from './fatal-startup-dialog';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  dialog: { showErrorBox: vi.fn() },
}));

vi.mock('./log-service', () => ({
  getLogPath: () => '/tmp/mesh-client/mesh-client.log',
}));

describe('formatDatabaseSchemaTooNewMessage', () => {
  it('includes app version, schema versions, and log path', () => {
    const err = new DatabaseSchemaTooNewError(40, 36);
    const message = formatDatabaseSchemaTooNewMessage(err);
    expect(message).toContain('schema 40');
    expect(message).toContain('1.2.3-test');
    expect(message).toContain('schema version 36');
    expect(message).toContain('/tmp/mesh-client/mesh-client.log');
    expect(message).toContain('latest Mesh-Client release');
  });
});
