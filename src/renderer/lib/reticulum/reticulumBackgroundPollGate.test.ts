/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';

import {
  resetVisibleMeshProtocolForTests,
  setVisibleMeshProtocol,
} from '../visibleMeshProtocolStore';
import {
  RETICULUM_OFF_PROTOCOL_POLL_SCALE,
  scaleReticulumBackgroundIntervalMs,
  shouldRunReticulumExpensiveBackgroundWork,
} from './reticulumBackgroundPollGate';

describe('reticulumBackgroundPollGate', () => {
  afterEach(() => {
    resetVisibleMeshProtocolForTests();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('skips expensive work while document.hidden', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(shouldRunReticulumExpensiveBackgroundWork()).toBe(false);
    expect(scaleReticulumBackgroundIntervalMs(30_000)).toBe(
      30_000 * RETICULUM_OFF_PROTOCOL_POLL_SCALE,
    );
  });

  it('slows polls when another protocol is visible', () => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    setVisibleMeshProtocol('meshtastic');
    expect(shouldRunReticulumExpensiveBackgroundWork()).toBe(true);
    expect(scaleReticulumBackgroundIntervalMs(5_000)).toBe(
      5_000 * RETICULUM_OFF_PROTOCOL_POLL_SCALE,
    );
    setVisibleMeshProtocol('reticulum');
    expect(scaleReticulumBackgroundIntervalMs(5_000)).toBe(5_000);
  });
});
