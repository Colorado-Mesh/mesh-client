import { beforeEach, describe, expect, it, vi } from 'vitest';

import { latchHiddenProtocolStop, releaseHiddenProtocolStop } from './hiddenProtocolStop';
import {
  isReticulumManualStackStopSuppress,
  setReticulumManualStackStopSuppress,
} from './reticulum/reticulumManualStackStopSuppress';
import { tryGetMeshcoreSession } from './sessions/meshcoreSession';
import { tryGetMeshtasticSession } from './sessions/meshtasticSession';

vi.mock('./reticulum/reticulumManualStackStopSuppress', () => ({
  isReticulumManualStackStopSuppress: vi.fn(() => false),
  setReticulumManualStackStopSuppress: vi.fn(),
}));

function fakeSession(): {
  latchExplicitDisconnect: ReturnType<typeof vi.fn>;
  clearExplicitDisconnectLatch: ReturnType<typeof vi.fn>;
} {
  return {
    latchExplicitDisconnect: vi.fn(() => true),
    clearExplicitDisconnectLatch: vi.fn(),
  };
}

vi.mock('./sessions/meshcoreSession', () => ({
  tryGetMeshcoreSession: vi.fn(),
}));

vi.mock('./sessions/meshtasticSession', () => ({
  tryGetMeshtasticSession: vi.fn(),
}));

const mockedSuppress = vi.mocked(isReticulumManualStackStopSuppress);
const mockedSetSuppress = vi.mocked(setReticulumManualStackStopSuppress);
const mockedMeshcoreSession = vi.mocked(tryGetMeshcoreSession);
const mockedMeshtasticSession = vi.mocked(tryGetMeshtasticSession);

describe('hiddenProtocolStop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSuppress.mockReturnValue(false);
    mockedMeshcoreSession.mockReturnValue(fakeSession() as never);
    mockedMeshtasticSession.mockReturnValue(fakeSession() as never);
  });

  it('latches Reticulum stop and returns true', () => {
    expect(latchHiddenProtocolStop('reticulum')).toBe(true);
    expect(mockedSetSuppress).toHaveBeenCalledWith(true);
  });

  it('returns false when Reticulum is already latched', () => {
    mockedSuppress.mockReturnValue(true);
    expect(latchHiddenProtocolStop('reticulum')).toBe(false);
    expect(mockedSetSuppress).not.toHaveBeenCalled();
  });

  it('latches MeshCore stop through the session latch', () => {
    expect(latchHiddenProtocolStop('meshcore')).toBe(true);
    expect(mockedMeshcoreSession).toHaveBeenCalled();
  });

  it('returns false when the MeshCore session is missing', () => {
    mockedMeshcoreSession.mockReturnValue(undefined as never);
    expect(latchHiddenProtocolStop('meshcore')).toBe(false);
  });

  it('latches Meshtastic stop through the session latch', () => {
    expect(latchHiddenProtocolStop('meshtastic')).toBe(true);
    expect(mockedMeshtasticSession).toHaveBeenCalled();
  });

  it('releases the Reticulum stop flag', () => {
    releaseHiddenProtocolStop('reticulum');
    expect(mockedSetSuppress).toHaveBeenCalledWith(false);
  });

  it('releases the MeshCore latch', () => {
    const session = fakeSession();
    mockedMeshcoreSession.mockReturnValue(session as never);
    releaseHiddenProtocolStop('meshcore');
    expect(session.clearExplicitDisconnectLatch).toHaveBeenCalled();
  });

  it('releases the Meshtastic latch', () => {
    const session = fakeSession();
    mockedMeshtasticSession.mockReturnValue(session as never);
    releaseHiddenProtocolStop('meshtastic');
    expect(session.clearExplicitDisconnectLatch).toHaveBeenCalled();
  });

  it('does nothing when releasing with no session', () => {
    mockedMeshcoreSession.mockReturnValue(undefined as never);
    expect(() => {
      releaseHiddenProtocolStop('meshcore');
    }).not.toThrow();
  });
});
