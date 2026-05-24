import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeshNode } from '../lib/types';
import ConfigureNodeSelector from './ConfigureNodeSelector';

function emptyNode(nodeId: number, overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: nodeId,
    long_name: `Node ${nodeId}`,
    short_name: 'N',
    hw_model: 'T-Echo',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function renderSelector(
  nodes: Map<number, MeshNode>,
  props: Partial<Parameters<typeof ConfigureNodeSelector>[0]> = {},
) {
  const onChange = props.onConfigureTargetChange ?? vi.fn();
  render(
    <ConfigureNodeSelector
      nodes={nodes}
      myNodeNum={0x100}
      configureTargetNodeNum={props.configureTargetNodeNum ?? null}
      onConfigureTargetChange={onChange}
      remoteAdminStatus="idle"
      isLocalRadioConnected
      getNodeName={(n) => nodes.get(n)?.long_name ?? `Node ${n}`}
      {...props}
    />,
  );
  return onChange;
}

function openNodePicker() {
  fireEvent.click(screen.getByLabelText(/Configure node/i));
  return screen.getByRole('listbox', { name: /Configure node/i });
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
    const onChange = renderSelector(new Map([[0x200, emptyNode(0x200)]]));
    const listbox = openNodePicker();
    fireEvent.click(within(listbox).getByRole('option', { name: /Node 512/i }));
    expect(onChange).toHaveBeenCalledWith(512);
  });

  it('excludes MeshCore contact-type hw_model nodes from the list', () => {
    const nodes = new Map<number, MeshNode>([
      [0x200, emptyNode(0x200)],
      [0x201, emptyNode(0x201, { hw_model: 'Repeater', long_name: 'MC Repeater' })],
      [0x202, emptyNode(0x202, { hw_model: 'Chat', long_name: 'MC Chat' })],
    ]);
    renderSelector(nodes);
    const listbox = openNodePicker();
    expect(within(listbox).getByRole('option', { name: /Node 512/i })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /MC Repeater/i })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /MC Chat/i })).not.toBeInTheDocument();
  });

  it('lists favorited nodes before non-favorited nodes', () => {
    const nodes = new Map<number, MeshNode>([
      [0x200, emptyNode(0x200, { long_name: 'Alpha', favorited: false })],
      [0x300, emptyNode(0x300, { long_name: 'Zulu Fav', favorited: true })],
    ]);
    renderSelector(nodes);
    const listbox = openNodePicker();
    const options = within(listbox).getAllByRole('option');
    const remoteLabels = options.slice(1).map((el) => el.textContent ?? '');
    expect(remoteLabels[0]).toMatch(/Zulu Fav/);
    expect(remoteLabels[1]).toMatch(/Alpha/);
  });

  it('shows remote admin error alert when fetch fails', () => {
    const nodes = new Map<number, MeshNode>([[0x200, emptyNode(0x200)]]);
    render(
      <ConfigureNodeSelector
        nodes={nodes}
        myNodeNum={0x100}
        configureTargetNodeNum={0x200}
        onConfigureTargetChange={vi.fn()}
        remoteAdminStatus="error"
        remoteAdminError="remoteAdmin.errors.publicKeyUnauthorized"
        isLocalRadioConnected
        getNodeName={(n) => `Node ${n}`}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Unauthorized/i);
  });

  it('uses a scrollable list when many remote candidates are present', () => {
    const nodes = new Map<number, MeshNode>();
    for (let i = 0; i < 16; i++) {
      const id = 0x400 + i;
      nodes.set(id, emptyNode(id, { long_name: `Remote ${i}` }));
    }
    renderSelector(nodes);
    openNodePicker();
    const listbox = screen.getByRole('listbox', { name: /Configure node/i });
    expect(listbox.className).toMatch(/overflow-y-auto/);
    expect(listbox.className).toMatch(/max-h-60/);
  });
});
