import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMeshcomSession,
  type MeshcomSessionApi,
  registerMeshcomSession,
  tryGetMeshcomSession,
} from './meshcomSession';

function stubApi(): MeshcomSessionApi {
  return {
    connect: vi.fn(async () => {}),
    prepareRfConnect: vi.fn(async () => {}),
    attachRfSession: vi.fn(async () => {}),
    handleRfConnectFailure: vi.fn(async () => {}),
    finalizeDriverDisconnect: vi.fn(async () => {}),
    connectAutomatic: vi.fn(async () => {}),
  };
}

afterEach(() => {
  registerMeshcomSession(null);
});

describe('meshcomSession', () => {
  it('registers and returns the active session', () => {
    expect(tryGetMeshcomSession()).toBeNull();
    const api = stubApi();
    registerMeshcomSession(api);
    expect(tryGetMeshcomSession()).toBe(api);
    expect(getMeshcomSession()).toBe(api);
  });

  it('throws when the runtime is not mounted', () => {
    expect(() => getMeshcomSession()).toThrow(/not mounted/);
  });
});
