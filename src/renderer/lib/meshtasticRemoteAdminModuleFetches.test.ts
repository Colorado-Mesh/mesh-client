import { describe, expect, it } from 'vitest';

import { REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT } from './meshtasticRemoteAdmin';
import { REMOTE_ADMIN_MODULE_CONFIG_FETCHES } from './meshtasticRemoteAdminModuleFetches';
import { REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT as SNAPSHOT_FETCH_COUNT } from './meshtasticRemoteAdminSnapshot';

describe('meshtasticRemoteAdminModuleFetches', () => {
  it('exports a stable fetch count shared by admin client and snapshot', () => {
    expect(REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT).toBe(SNAPSHOT_FETCH_COUNT);
    expect(REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT).toBe(REMOTE_ADMIN_MODULE_CONFIG_FETCHES.length);
    expect(REMOTE_ADMIN_MODULE_CONFIG_FETCHES.map((entry) => entry.key)).toContain(
      'trafficManagement',
    );
    expect(REMOTE_ADMIN_MODULE_CONFIG_FETCHES.map((entry) => entry.key)).toContain('tak');
    expect(REMOTE_ADMIN_MODULE_CONFIG_FETCHES.map((entry) => entry.key)).not.toContain('audio');
  });
});
