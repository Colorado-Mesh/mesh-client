/**
 * Regression guard: lockdown status is module-level state, so every teardown path must
 * clear it. Radio replacement (`prepareRfConnect`) calls `cleanupSubscriptions()` and
 * removes the status listener *before* disconnecting, so clearing from the
 * DeviceDisconnected event alone would leave radio A's lock state on screen for radio B.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../sourceContractTestHelpers';
import {
  clearMeshtasticLockdownStatus,
  getMeshtasticLockdownStatus,
  recordMeshtasticLockdownStatus,
  subscribeMeshtasticLockdownStatus,
} from './meshtasticLockdown';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');
const WIRE_EFFECTS_SOURCE = readFileSync(
  join(__dirname, 'meshtasticRuntimeWireEffects.ts'),
  'utf-8',
);

/** Body of the shared `cleanupSubscriptions` callback. */
function cleanupSubscriptionsBody(): string {
  const start = RUNTIME_SOURCE.indexOf('const cleanupSubscriptions = useCallback(');
  expect(start).toBeGreaterThan(-1);
  const end = RUNTIME_SOURCE.indexOf('}, []);', start);
  expect(end).toBeGreaterThan(start);
  return RUNTIME_SOURCE.slice(start, end);
}

describe('meshtastic lockdown teardown contract', () => {
  it('clears lockdown state from the shared cleanupSubscriptions path', () => {
    expect(cleanupSubscriptionsBody()).toContain('clearMeshtasticLockdownStatus()');
  });

  it('does not rely on the DeviceDisconnected listener, which radio replacement removes first', () => {
    // prepareRfConnect tears subscriptions down before disconnecting, so a clear that
    // only lived in the wire-effects disconnect branch would never run on radio switch.
    expect(WIRE_EFFECTS_SOURCE).not.toContain('clearMeshtasticLockdownStatus');
    expect(RUNTIME_SOURCE).toContain('cleanupSubscriptions();');
  });

  it('notifies subscribers so a switched radio renders no stale status', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeMeshtasticLockdownStatus((status) => seen.push(status));

    recordMeshtasticLockdownStatus({ state: 2, lockReason: 'radio A locked' });
    expect(getMeshtasticLockdownStatus()?.lockReason).toBe('radio A locked');

    clearMeshtasticLockdownStatus();

    expect(getMeshtasticLockdownStatus()).toBeNull();
    expect(seen.at(-1)).toBeNull();
    unsubscribe();
  });
});
