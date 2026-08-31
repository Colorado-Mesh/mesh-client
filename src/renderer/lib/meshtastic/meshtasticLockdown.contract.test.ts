/**
 * Regression guard: lockdown status lives in a module-level store, so the disconnect
 * path must clear it. Otherwise radio A's LOCKED state would still be on screen after
 * switching to radio B, which has its own (possibly disabled) lockdown configuration.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  clearMeshtasticLockdownStatus,
  getMeshtasticLockdownStatus,
  recordMeshtasticLockdownStatus,
} from './meshtasticLockdown';

const WIRE_EFFECTS_SOURCE = readFileSync(
  join(__dirname, 'meshtasticRuntimeWireEffects.ts'),
  'utf-8',
);

describe('meshtastic lockdown teardown contract', () => {
  it('disconnect cleanup clears the lockdown store', () => {
    const cleanupIndex = WIRE_EFFECTS_SOURCE.indexOf('cleanupSubscriptions();');
    expect(cleanupIndex).toBeGreaterThan(-1);

    const block = WIRE_EFFECTS_SOURCE.slice(cleanupIndex, cleanupIndex + 400);
    expect(block).toContain('clearMeshtasticLockdownStatus()');
  });

  it('radio B does not inherit radio A status once cleared', () => {
    recordMeshtasticLockdownStatus({ state: 2, lockReason: 'radio A locked' });
    expect(getMeshtasticLockdownStatus()?.lockReason).toBe('radio A locked');

    clearMeshtasticLockdownStatus();

    expect(getMeshtasticLockdownStatus()).toBeNull();
  });
});
