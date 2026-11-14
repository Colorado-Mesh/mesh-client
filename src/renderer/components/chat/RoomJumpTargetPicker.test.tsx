import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Protocol } from '@/renderer/lib/protocols/Protocol';
import { type IdentityRecord, useIdentityStore } from '@/renderer/stores/identityStore';
import { useNodeStore } from '@/renderer/stores/nodeStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import { RoomJumpTargetPicker } from './RoomJumpTargetPicker';

function identity(id: string, type: 'meshcore' | 'reticulum'): IdentityRecord {
  return {
    id,
    protocol: { type } as Protocol,
    signature: id,
    transports: [],
    createdAt: 1,
    lastSeenAt: 1,
  };
}

describe('RoomJumpTargetPicker', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useNodeStore.setState({ nodes: {} });
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      hubDestHash: null,
      focusedHubHash: null,
    });
  });

  it('renders MeshCore optgroup and calls onChange with the target', () => {
    const pub = 'ab'.repeat(32);
    useIdentityStore.setState({
      identities: { mc1: identity('mc1', 'meshcore') },
      activeIdentityId: 'mc1',
    });
    useNodeStore.setState({
      nodes: {
        mc1: {
          1: { nodeId: 1, hwModel: 'Room', publicKeyHex: pub, longName: 'Weather' },
        },
      },
    });
    const onChange = vi.fn();
    render(<RoomJumpTargetPicker value={null} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'MeshCore rooms' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Room'), {
      target: { value: `meshcore:mc1:${pub}` },
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'meshcore-room',
      identityId: 'mc1',
      roomPubKeyHex: pub,
      label: 'Weather',
    });
  });

  it('keeps a saved-but-missing value selectable', () => {
    const saved = {
      kind: 'rrc-room' as const,
      hubDestHash: 'deadbeef',
      room: '#old',
      label: 'Old room',
    };
    const onChange = vi.fn();
    render(<RoomJumpTargetPicker value={saved} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room')).toHaveValue('rrc:deadbeef:old');
  });

  it('shows empty state when no rooms exist', () => {
    render(<RoomJumpTargetPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/No rooms found/i)).toBeInTheDocument();
  });
});
