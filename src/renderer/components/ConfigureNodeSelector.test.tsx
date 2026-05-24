import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshNode } from '../lib/types';
import ConfigureNodeSelector from './ConfigureNodeSelector';

function emptyNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Node ${nodeId}`,
    short_name: 'N',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
  };
}

describe('ConfigureNodeSelector', () => {
  it('renders local-only message when local radio is not connected', () => {
    render(
      <ConfigureNodeSelector
        nodes={new Map()}
        myNodeNum={0x100}
        configureTargetNodeNum={null}
        onConfigureTargetChange={vi.fn()}
        remoteAdminStatus="idle"
        isLocalRadioConnected={false}
        getNodeName={(n) => `Node ${n}`}
      />,
    );
    expect(screen.getByText(/Connect a local Meshtastic radio/i)).toBeInTheDocument();
  });

  it('calls onConfigureTargetChange when selecting a remote node', () => {
    const onChange = vi.fn();
    const nodes = new Map<number, MeshNode>([[0x200, emptyNode(0x200)]]);
    render(
      <ConfigureNodeSelector
        nodes={nodes}
        myNodeNum={0x100}
        configureTargetNodeNum={null}
        onConfigureTargetChange={onChange}
        remoteAdminStatus="idle"
        isLocalRadioConnected
        getNodeName={(n) => `Node ${n}`}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Configure node/i), { target: { value: '512' } });
    expect(onChange).toHaveBeenCalledWith(512);
  });
});
