/** Sidebar room list marker glyph + Tailwind color for each auth state. */
export type MeshcoreRoomSidebarMarkerKind =
  'loggedIn' | 'leaving' | 'savedNotLoggedIn' | 'notSaved';

export interface MeshcoreRoomSidebarMarker {
  kind: MeshcoreRoomSidebarMarkerKind;
  glyph: string;
  colorClass: string;
}

export function resolveMeshcoreRoomSidebarMarker(opts: {
  isLoggedIn: boolean;
  hasSavedPassword: boolean;
  isLeaving: boolean;
}): MeshcoreRoomSidebarMarker {
  if (opts.isLeaving) {
    return { kind: 'leaving', glyph: '◌', colorClass: 'text-amber-300' };
  }
  if (opts.isLoggedIn) {
    return { kind: 'loggedIn', glyph: '●', colorClass: 'text-brand-green' };
  }
  if (opts.hasSavedPassword) {
    return { kind: 'savedNotLoggedIn', glyph: '◐', colorClass: 'text-sky-400' };
  }
  return { kind: 'notSaved', glyph: '○', colorClass: 'text-gray-500' };
}
