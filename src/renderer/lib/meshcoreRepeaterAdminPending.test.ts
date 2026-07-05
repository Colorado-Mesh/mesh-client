import { describe, expect, it } from 'vitest';

import {
  isRepeaterAdminRpcPending,
  type MeshcoreRepeaterRpcPendingMap,
  setRepeaterAdminRpcPending,
} from './meshcoreRepeaterAdminPending';

describe('meshcoreRepeaterAdminPending', () => {
  it('tracks and clears pending kinds per node', () => {
    let map: MeshcoreRepeaterRpcPendingMap = new Map();
    map = setRepeaterAdminRpcPending(map, 0xabc, 'ping', true);
    map = setRepeaterAdminRpcPending(map, 0xabc, 'status', true);
    expect(isRepeaterAdminRpcPending(map, 0xabc, 'ping')).toBe(true);
    expect(isRepeaterAdminRpcPending(map, 0xabc, 'status')).toBe(true);
    map = setRepeaterAdminRpcPending(map, 0xabc, 'ping', false);
    expect(isRepeaterAdminRpcPending(map, 0xabc, 'ping')).toBe(false);
    expect(isRepeaterAdminRpcPending(map, 0xabc, 'status')).toBe(true);
    map = setRepeaterAdminRpcPending(map, 0xabc, 'status', false);
    expect(map.has(0xabc)).toBe(false);
  });
});
