import { describe, expect, it } from 'vitest';

import {
  getMeshtasticConnectedMyNodeNum,
  resolveForeignLoraDiagnosticsNodeId,
  setMeshtasticConnectedMyNodeNum,
} from './meshtasticConnectedNodeRef';

describe('meshtasticConnectedNodeRef', () => {
  it('returns 0 initially', () => {
    setMeshtasticConnectedMyNodeNum(0);
    expect(getMeshtasticConnectedMyNodeNum()).toBe(0);
  });

  it('returns the value that was set', () => {
    setMeshtasticConnectedMyNodeNum(0xdeadbeef);
    expect(getMeshtasticConnectedMyNodeNum()).toBe(0xdeadbeef);
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('reflects the latest set call', () => {
    setMeshtasticConnectedMyNodeNum(1);
    setMeshtasticConnectedMyNodeNum(2);
    expect(getMeshtasticConnectedMyNodeNum()).toBe(2);
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('resolveForeignLoraDiagnosticsNodeId prefers Meshtastic id when connected', () => {
    setMeshtasticConnectedMyNodeNum(649425065);
    expect(resolveForeignLoraDiagnosticsNodeId(999)).toBe(649425065);
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('resolveForeignLoraDiagnosticsNodeId falls back to panel id when Meshtastic disconnected', () => {
    setMeshtasticConnectedMyNodeNum(0);
    expect(resolveForeignLoraDiagnosticsNodeId(42)).toBe(42);
  });
});
