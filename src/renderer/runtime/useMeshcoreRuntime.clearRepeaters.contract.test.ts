// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

function sliceBetween(start: string, end: string): string {
  const from = SOURCE.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = SOURCE.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return SOURCE.slice(from, to);
}

describe('useMeshcoreRuntime clearAllRepeaters', () => {
  it('rethrows a DB contact lookup failure instead of clearing with no favorites list', () => {
    const body = sliceBetween(
      'const clearAllRepeaters = useCallback(',
      'await clearMeshcoreRepeaters(',
    );
    expect(body).toContain('clearAllRepeaters getMeshcoreContacts error');
    expect(body).toMatch(/throw e instanceof Error \? e : new Error\(String\(e\)\)/);
    expect(body).not.toMatch(/let dbContacts: MeshcoreContactDbRow\[\] = \[\]/);
  });
});

describe('useMeshcoreRuntime radio contacts readiness', () => {
  it('marks contacts loaded only after a radio dump is applied and resets on new dump/disconnect', () => {
    const calls = SOURCE.match(/setMeshcoreRadioContactsLoaded\((true|false)\)/g) ?? [];
    expect(calls.filter((c) => c.endsWith('(true)')).length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((c) => c.endsWith('(false)')).length).toBeGreaterThanOrEqual(2);
    expect(SOURCE).toMatch(
      /initOnRadioContactCount = contacts\.length;\s*setMeshcoreContactsForTelemetry\(contacts\);\s*setMeshcoreRadioContactsLoaded\(true\);/,
    );
    expect(SOURCE).toMatch(
      /setMeshcoreContactsForTelemetry\(\[\]\);\s*setMeshcoreRadioContactsLoaded\(false\);/,
    );
  });
});
