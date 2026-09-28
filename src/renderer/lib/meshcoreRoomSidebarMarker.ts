/** Room list status marker for each auth state (rendered as a `StatusDot`). */
export type MeshcoreRoomSidebarMarkerKind =
  'loggedIn' | 'leaving' | 'savedNotLoggedIn' | 'notSaved';

export interface MeshcoreRoomSidebarMarker {
  kind: MeshcoreRoomSidebarMarkerKind;
  /** `StatusDot` tone: filled green, blue, hollow ring, or pulsing yellow while leaving. */
  tone: 'ok' | 'info' | 'idle' | 'warn';
  pulse: boolean;
}

export function resolveMeshcoreRoomSidebarMarker(opts: {
  isLoggedIn: boolean;
  hasSavedPassword: boolean;
  isLeaving: boolean;
}): MeshcoreRoomSidebarMarker {
  if (opts.isLeaving) {
    return { kind: 'leaving', tone: 'warn', pulse: true };
  }
  if (opts.isLoggedIn) {
    return { kind: 'loggedIn', tone: 'ok', pulse: false };
  }
  if (opts.hasSavedPassword) {
    return { kind: 'savedNotLoggedIn', tone: 'info', pulse: false };
  }
  return { kind: 'notSaved', tone: 'idle', pulse: false };
}
