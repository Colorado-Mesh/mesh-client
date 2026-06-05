import { describe, expect, it } from 'vitest';

import { resolveMeshcoreRoomSidebarMarker } from './meshcoreRoomSidebarMarker';

describe('resolveMeshcoreRoomSidebarMarker', () => {
  it('uses green filled circle for logged-in rooms', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: true,
      hasSavedPassword: true,
      isLeaving: false,
    });
    expect(m.kind).toBe('loggedIn');
    expect(m.glyph).toBe('●');
    expect(m.colorClass).toContain('brand-green');
  });

  it('uses sky half-circle for saved password when not logged in', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: false,
      hasSavedPassword: true,
      isLeaving: false,
    });
    expect(m.kind).toBe('savedNotLoggedIn');
    expect(m.glyph).toBe('◐');
    expect(m.colorClass).toContain('sky-400');
    expect(m.colorClass).not.toContain('green');
  });

  it('prefers leaving state over logged in', () => {
    const m = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: true,
      hasSavedPassword: true,
      isLeaving: true,
    });
    expect(m.kind).toBe('leaving');
  });
});
