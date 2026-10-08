import { describe, expect, it, vi } from 'vitest';

import { PermissionDecisionLogger } from './permissionDecisionLog';

describe('PermissionDecisionLogger', () => {
  it('logs a grant once per handler and permission', () => {
    const sink = vi.fn();
    const logger = new PermissionDecisionLogger(sink);
    for (let i = 0; i < 5; i++) logger.log('checkHandler', 'notifications', true);
    logger.log('requestHandler', 'notifications', true);
    logger.log('checkHandler', 'geolocation', true);
    expect(sink.mock.calls).toEqual([
      ['[permissions] checkHandler: notifications → granted'],
      ['[permissions] requestHandler: notifications → granted'],
      ['[permissions] checkHandler: geolocation → granted'],
    ]);
  });

  it('always logs denials', () => {
    const sink = vi.fn();
    const logger = new PermissionDecisionLogger(sink);
    logger.log('checkHandler', 'notifications', false);
    logger.log('checkHandler', 'notifications', false);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenCalledWith('[permissions] checkHandler: notifications → denied');
  });

  it('sanitizes the permission name', () => {
    const sink = vi.fn();
    new PermissionDecisionLogger(sink).log('checkHandler', 'bad\nname', false);
    expect(sink.mock.calls[0]?.[0]).not.toContain('\n');
  });
});
