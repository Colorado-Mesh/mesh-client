import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import {
  MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT,
} from '../lib/meshtasticContactGroupUtils';
import { MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL } from '../lib/meshtasticSourceIcons';
import type { MeshNode } from '../lib/types';
import NodeListPanel from './NodeListPanel';

function makeNode(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id'>): MeshNode {
  return {
    long_name: 'N',
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    ...partial,
  };
}

const positionHistoryStoreState = {
  history: new Map<number, { t: number; lat: number; lon: number }[]>(),
};

vi.mock('../stores/positionHistoryStore', () => ({
  usePositionHistoryStore: (selector: (s: typeof positionHistoryStoreState) => unknown) =>
    selector(positionHistoryStoreState),
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: [],
      ignoreMqttEnabled: false,
      nodeRedundancy: new Map(),
    };
    return selector(store);
  },
}));

const { addToastMock } = vi.hoisted(() => ({
  addToastMock: vi.fn(),
}));

const { meshcoreContactCapacityState, offloadAndReconcileMock, refreshCountMock } = vi.hoisted(
  () => ({
    meshcoreContactCapacityState: {
      contactCount: null as number | null,
      loading: false,
      summary: {
        count: null as number | null,
        level: 'normal',
        isWarning: false,
        isCritical: false,
      },
    },
    offloadAndReconcileMock: vi.fn(),
    refreshCountMock: vi.fn(),
  }),
);

vi.mock('../hooks/useMeshcoreContactCapacity', () => ({
  useMeshcoreContactCapacity: () => ({
    contactCount: meshcoreContactCapacityState.contactCount,
    loading: meshcoreContactCapacityState.loading,
    summary: meshcoreContactCapacityState.summary,
    offloadAndReconcile: offloadAndReconcileMock,
    refreshCount: refreshCountMock,
  }),
}));

vi.mock('./Toast', () => ({
  useToast: () => ({
    addToast: addToastMock,
  }),
}));

const defaultFilter = {
  enabled: false,
  maxDistance: 500,
  unit: 'miles' as const,
  hideMqttOnly: false,
};

describe('NodeListPanel accessibility', () => {
  beforeEach(() => {
    meshcoreContactCapacityState.contactCount = null;
    meshcoreContactCapacityState.loading = false;
    meshcoreContactCapacityState.summary = {
      count: null,
      level: 'normal',
      isWarning: false,
      isCritical: false,
    };
    offloadAndReconcileMock.mockReset();
    refreshCountMock.mockReset();
  });

  it('has no axe violations with empty nodes', async () => {
    const { container } = render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows contacts title in meshcore mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Contacts (0)' })).toBeInTheDocument();
  });
});

describe('NodeListPanel import contacts', () => {
  it('shows Import Contacts button in meshcore mode when onImportContacts provided', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        onImportContacts={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Import Contacts' })).toBeInTheDocument();
  });

  it('does not show Import Contacts button in meshtastic mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        onImportContacts={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Import Contacts' })).not.toBeInTheDocument();
  });

  it('filters Meshtastic nodes by GPS built-in group', () => {
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', latitude: 40, longitude: -74 })],
      [2, makeNode({ node_id: 2, long_name: 'HasGps', latitude: 37.5, longitude: -122.4 })],
      [3, makeNode({ node_id: 3, long_name: 'NoGps', latitude: null, longitude: null })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        selectedGroupId={MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS}
        onGroupChange={vi.fn()}
        onManageGroups={vi.fn()}
        groups={[]}
        groupMemberIds={new Set()}
      />,
    );
    expect(screen.getByText('HasGps')).toBeInTheDocument();
    expect(screen.queryByText('NoGps')).not.toBeInTheDocument();
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('filters Meshtastic nodes by RF+MQTT built-in group', () => {
    const nodes = new Map<number, MeshNode>([
      [
        1,
        makeNode({ node_id: 1, long_name: 'Me', heard_via_mqtt: true, heard_via_mqtt_only: false }),
      ],
      [
        2,
        makeNode({
          node_id: 2,
          long_name: 'Hybrid',
          heard_via_mqtt: true,
          heard_via_mqtt_only: false,
        }),
      ],
      [
        3,
        makeNode({
          node_id: 3,
          long_name: 'MqttOnly',
          heard_via_mqtt: true,
          heard_via_mqtt_only: true,
        }),
      ],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        selectedGroupId={MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT}
        onGroupChange={vi.fn()}
        onManageGroups={vi.fn()}
        groups={[]}
        groupMemberIds={new Set()}
      />,
    );
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(screen.queryByText('MqttOnly')).not.toBeInTheDocument();
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('shows hybrid MQTT path icons (not relay text) when via_mqtt and not MQTT-only', async () => {
    const nodes = new Map<number, MeshNode>([
      [
        2,
        makeNode({
          node_id: 2,
          long_name: 'RelayPeer',
          heard_via_mqtt_only: false,
          heard_via_mqtt: false,
          via_mqtt: true,
        }),
      ],
    ]);
    const { container } = render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={99}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByText('RelayPeer')).toBeInTheDocument();
    expect(screen.getByLabelText(MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL)).toBeInTheDocument();
    expect(screen.queryByText('relay')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows hybrid MQTT path icons when heard_via_mqtt without via_mqtt', () => {
    const nodes = new Map<number, MeshNode>([
      [
        3,
        makeNode({
          node_id: 3,
          long_name: 'SessionHybrid',
          heard_via_mqtt_only: false,
          heard_via_mqtt: true,
          via_mqtt: false,
        }),
      ],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={99}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByText('SessionHybrid')).toBeInTheDocument();
    expect(screen.getByLabelText(MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL)).toBeInTheDocument();
  });

  it('shows hybrid path icons for self node when RF and MQTT are connected', () => {
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', heard_via_mqtt_only: false })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        mqttConnected
        radioConnected
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByLabelText('Connected via RF and MQTT')).toBeInTheDocument();
    expect(screen.queryByText('🌐')).not.toBeInTheDocument();
  });

  it('shows MQTT-only icon for self when MQTT connected without radio', () => {
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', heard_via_mqtt_only: false })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        mqttConnected
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.queryByLabelText('Connected via RF and MQTT')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Connected via MQTT')).toBeInTheDocument();
  });

  it('shows sky MQTT-only path icon centered for heard_via_mqtt_only nodes', () => {
    const nodes = new Map<number, MeshNode>([
      [
        4,
        makeNode({
          node_id: 4,
          long_name: 'MqttOnlyPeer',
          heard_via_mqtt_only: true,
          heard_via_mqtt: true,
        }),
      ],
    ]);
    const { container } = render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={99}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    const badge = screen.getByLabelText('Heard only via MQTT');
    expect(badge).toBeInTheDocument();
    expect(badge.querySelector('svg.text-sky-400')).toBeInTheDocument();
    expect(badge.querySelector(':scope > span[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(container.querySelector('svg.text-purple-400')).not.toBeInTheDocument();
  });

  it('shows dash in MQTT column for self node with RF only', () => {
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', heard_via_mqtt_only: false })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        radioConnected
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.queryByLabelText('Connected via RF and MQTT')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL)).not.toBeInTheDocument();
  });

  it('does not show Import Contacts button when onImportContacts not provided in meshcore mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Import Contacts' })).not.toBeInTheDocument();
  });

  it('shows Refresh when meshcoreShowRefreshControl and onRefreshContacts are set', async () => {
    const user = userEvent.setup();
    const onRefreshContacts = vi.fn().mockResolvedValue(undefined);
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        meshcoreShowRefreshControl
        onRefreshContacts={onRefreshContacts}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Refresh contacts from radio' });
    await user.click(btn);
    expect(onRefreshContacts).toHaveBeenCalledTimes(1);
  });

  it('shows meshcore capacity warning and offload action when near full', () => {
    meshcoreContactCapacityState.contactCount = 349;
    meshcoreContactCapacityState.summary = {
      count: 349,
      level: 'critical',
      isWarning: true,
      isCritical: true,
    };
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.getByText('Radio near capacity: 349/350')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Offload' })).toBeInTheDocument();
  });

  it('offload action reconciles via provided refresh callback', async () => {
    const user = userEvent.setup();
    const onRefreshContacts = vi.fn().mockResolvedValue(undefined);
    meshcoreContactCapacityState.contactCount = 349;
    meshcoreContactCapacityState.summary = {
      count: 349,
      level: 'critical',
      isWarning: true,
      isCritical: true,
    };
    offloadAndReconcileMock.mockResolvedValue({
      offloadedCount: 12,
      reconciledCount: 8,
      refreshFailed: false,
    });
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        onRefreshContacts={onRefreshContacts}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Offload' }));
    expect(offloadAndReconcileMock).toHaveBeenCalledWith(onRefreshContacts, undefined);
  });

  it('renders full public key under name when meshcoreShowPublicKeys and map entry exist', () => {
    const nodeId = 0xdeadbeef;
    const hex = 'aa'.repeat(32);
    const nodes = new Map<number, MeshNode>([
      [nodeId, makeNode({ node_id: nodeId, long_name: 'Peer' })],
    ]);
    const pubkeyMap = new Map<number, string>([[nodeId, hex]]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        meshcoreShowPublicKeys
        meshcorePublicKeyHexByNodeId={pubkeyMap}
      />,
    );
    expect(screen.getByText(hex)).toBeInTheDocument();
  });
});

describe('NodeListPanel flood advert (MeshCore)', () => {
  beforeEach(() => {
    addToastMock.mockClear();
  });

  it('shows Send flood advert control when meshcore and onSendAdvert provided', async () => {
    const user = userEvent.setup();
    const onSendAdvert = vi.fn().mockResolvedValue(undefined);
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        onSendAdvert={onSendAdvert}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Send flood advert' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onSendAdvert).toHaveBeenCalledTimes(1);
    expect(addToastMock).toHaveBeenCalledWith('Flood advert sent', 'success');
  });

  it('does not show flood advert in meshtastic mode even if onSendAdvert provided', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        onSendAdvert={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Send flood advert' })).not.toBeInTheDocument();
  });

  it('does not show flood advert when onSendAdvert omitted in meshcore mode', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Send flood advert' })).not.toBeInTheDocument();
  });

  it('disables flood advert when meshcoreRadioOperational is false', () => {
    render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        onSendAdvert={vi.fn()}
        meshcoreRadioOperational={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send flood advert' })).toBeDisabled();
  });
});

describe('NodeListPanel search', () => {
  beforeEach(() => {
    positionHistoryStoreState.history = new Map();
  });

  it('filters MeshCore contacts by node_id hex fragment', () => {
    const nodes = new Map<number, MeshNode>([
      [0xf6, makeNode({ node_id: 0xf6, long_name: 'Repeater Alpha', hw_model: 'Repeater' })],
      [0xab, makeNode({ node_id: 0xab, long_name: 'Other Node', hw_model: 'Repeater' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'f6' } });
    expect(screen.getByText('Repeater Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Other Node')).not.toBeInTheDocument();
  });
});

describe('NodeListPanel meshtastic node id display', () => {
  it('shows 8-digit hex id with leading zeros preserved', () => {
    const nodeId = 0x0bcd5737;
    const nodes = new Map<number, MeshNode>([
      [nodeId, makeNode({ node_id: nodeId, long_name: 'LeadingZero' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByText('!0bcd5737')).toBeInTheDocument();
  });
});

describe('NodeListPanel show on map', () => {
  beforeEach(() => {
    positionHistoryStoreState.history = new Map();
  });

  it('calls onShowOnMap for tracked-only position when DB coords are missing', async () => {
    const user = userEvent.setup();
    const onShowOnMap = vi.fn();
    positionHistoryStoreState.history = new Map([[42, [{ t: 1_000, lat: 40.1, lon: -105.1 }]]]);
    const nodes = new Map<number, MeshNode>([
      [42, makeNode({ node_id: 42, long_name: 'TrackedOnly', latitude: null, longitude: null })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        onShowOnMap={onShowOnMap}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith(42, 40.1, -105.1);
  });

  it('calls onShowOnMap when map pin is clicked for node with coordinates', async () => {
    const user = userEvent.setup();
    const onShowOnMap = vi.fn();
    const nodes = new Map<number, MeshNode>([
      [42, makeNode({ node_id: 42, long_name: 'HasPos', latitude: 39.74, longitude: -104.99 })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
        onShowOnMap={onShowOnMap}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Show on map' }));
    expect(onShowOnMap).toHaveBeenCalledWith(42, 39.74, -104.99);
  });
});
