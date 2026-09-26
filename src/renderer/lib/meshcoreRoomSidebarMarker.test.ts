import { describe, expect, it } from 'vitest';

import { resolveMeshcoreRoomSidebarMarker } from './meshcoreRoomSidebarMarker';

describe('resolveMeshcoreRoomSidebarMarker', () => {
  it('uses the green dot for logged-in rooms', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: true,
      hasSavedPassword: true,
      isLeaving: false,
    });
    expect(m).toEqual({ kind: 'loggedIn', tone: 'ok', pulse: false });
  });

  it('uses the blue dot for a saved password when not logged in', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: false,
      hasSavedPassword: true,
      isLeaving: false,
    });
    expect(m).toEqual({ kind: 'savedNotLoggedIn', tone: 'info', pulse: false });
  });

  it('uses the hollow ring when no password is saved', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: false,
      hasSavedPassword: false,
      isLeaving: false,
    });
    expect(m).toEqual({ kind: 'notSaved', tone: 'idle', pulse: false });
  });

  it('prefers leaving state over logged in', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: true,
      hasSavedPassword: true,
      isLeaving: true,
    });
    expect(m).toEqual({ kind: 'leaving', tone: 'warn', pulse: true });
  });
});
