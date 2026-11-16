import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MeshNode } from '@/renderer/lib/types';

import RoomServersPanel from './RoomServersPanel';

vi.mock('@/renderer/lib/meshcoreRoomMembership', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('@/renderer/lib/meshcoreRoomMembership')>();
  return {
    ...actual,
    buildMeshcoreRoomMembershipContext: () => ({
      isLoggedIn: () => false,
      hasSavedGuestCredential: (id: number) => id === 2,
      isFavorited: () => false,
      hasLocalPosts: () => false,
      hasLastRead: () => false,
      isAutoSyncEnabled: () => false,
      isAutoLoginOnConnect: () => false,
    }),
  };
});

function room(nodeId: number, name: string): MeshNode {
  return {
    node_id: nodeId,
    long_name: name,
    short_name: name.slice(0, 4),
    hw_model: 'Room',
    favorited: false,
    last_heard: 0,
    hops_away: 1,
  } as MeshNode;
}

describe('RoomServersPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists discovered rooms only and opens Chat Rooms on click', () => {
    const onOpenRoom = vi.fn();
    const nodes = new Map<number, MeshNode>([
      [1, room(1, 'Alpha BBS')],
      [2, room(2, 'Joined BBS')],
      [3, { ...room(3, 'Repeater'), hw_model: 'Repeater' }],
    ]);
    render(<RoomServersPanel nodes={nodes} messages={[]} onOpenRoom={onOpenRoom} />);
    expect(screen.getByRole('button', { name: 'Open Alpha BBS' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Joined BBS' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha BBS' }));
    expect(onOpenRoom).toHaveBeenCalledWith(1);
  });

  it('has no axe violations', async () => {
    const nodes = new Map<number, MeshNode>([[1, room(1, 'Alpha BBS')]]);
    const { container } = render(
      <RoomServersPanel nodes={nodes} messages={[]} onOpenRoom={vi.fn()} />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
