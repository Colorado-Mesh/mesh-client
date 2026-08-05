// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isAllowedReticulumReceivedVia,
  RETICULUM_SINGLE_VIA_ATOMS,
} from './reticulumMessageTransport';

describe('isAllowedReticulumReceivedVia', () => {
  it.each([...RETICULUM_SINGLE_VIA_ATOMS])('allows single atom %s', (atom) => {
    expect(isAllowedReticulumReceivedVia(atom)).toBe(true);
  });

  it('allows paper (LXMF offline handoff)', () => {
    expect(isAllowedReticulumReceivedVia('paper')).toBe(true);
  });

  it('allows multi-egress joins', () => {
    expect(isAllowedReticulumReceivedVia('rf+tcp')).toBe(true);
    expect(isAllowedReticulumReceivedVia('ble+rf+tcp')).toBe(true);
  });

  it('rejects unknown atoms and invalid joins', () => {
    expect(isAllowedReticulumReceivedVia('wifi')).toBe(false);
    expect(isAllowedReticulumReceivedVia('paper+rf')).toBe(false);
    expect(isAllowedReticulumReceivedVia('rf+')).toBe(false);
    expect(isAllowedReticulumReceivedVia('')).toBe(false);
  });
});
