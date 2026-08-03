// @vitest-environment jsdom
/**
 * Source contract tests for LXST voice WebSocket event routing.
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime voice event routing (regression)', () => {
  it('routes voice.update / incoming / terminated / error / audio', () => {
    expect(SOURCE).toMatch(/evt\.type === 'voice\.update'/);
    expect(SOURCE).toMatch(/useReticulumVoiceStore\.getState\(\)\.applyUpdate/);
    expect(SOURCE).toMatch(/evt\.type === 'voice\.incoming'/);
    expect(SOURCE).toMatch(/applyIncoming\(evt\.payload\)/);
    expect(SOURCE).toMatch(/evt\.type === 'voice\.terminated'/);
    expect(SOURCE).toMatch(/applyTerminated\(p\.link_id/);
    expect(SOURCE).toMatch(/evt\.type === 'voice\.error'/);
    expect(SOURCE).toMatch(/applyError\(p\.message/);
    expect(SOURCE).toMatch(/evt\.type === 'voice\.audio'/);
    expect(SOURCE).toMatch(/decodeF32LeBase64/);
    expect(SOURCE).toMatch(/emitAudio\(channels, samples\)/);
  });
});
