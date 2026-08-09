import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import {
  MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS,
  MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT,
} from '../lib/meshtasticContactGroupUtils';
import { OFFLINE_MESHTASTIC_IDENTITY_ID } from '../lib/offlineProtocolIdentities';
import type { MeshNode } from '../lib/types';
import { addMessage, useMessageStore } from '../stores/messageStore';
import NodeListPanel from './NodeListPanel';

const HYBRID_MQTT_PATH_ARIA = 'RF and MQTT path';

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

const diagnosticsStoreState = vi.hoisted(() => ({
  ignoreMqttEnabled: false,
}));

vi.mock('../stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
    const store = {
      diagnosticRows: [],
      ignoreMqttEnabled: diagnosticsStoreState.ignoreMqttEnabled,
      nodeRedundancy: new Map(),
    };
    return selector(store);
  },
}));

const { addToastMock } = vi.hoisted(() => ({
  addToastMock: vi.fn(),
}));

const {
  meshcoreContactCapacityState,
  offloadAndReconcileMock,
  refreshCountMock,
  cancelOffloadMock,
} = vi.hoisted(() => ({
  meshcoreContactCapacityState: {
    contactCount: null as number | null,
    loading: false,
    offloadProgress: null as {
      phase: 'saving' | 'removing' | 'reconciling';
      current: number;
      total: number;
    } | null,
    summary: {
      count: null as number | null,
      level: 'normal',
      isWarning: false,
      isCritical: false,
    },
  },
  offloadAndReconcileMock: vi.fn(),
  refreshCountMock: vi.fn(),
  cancelOffloadMock: vi.fn(),
}));

vi.mock('../hooks/useMeshcoreContactCapacity', () => ({
  useMeshcoreContactCapacity: () => ({
    contactCount: meshcoreContactCapacityState.contactCount,
    loading: meshcoreContactCapacityState.loading,
    offloadProgress: meshcoreContactCapacityState.offloadProgress,
    cancelOffload: cancelOffloadMock,
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
    diagnosticsStoreState.ignoreMqttEnabled = false;
    meshcoreContactCapacityState.contactCount = null;
    meshcoreContactCapacityState.loading = false;
    meshcoreContactCapacityState.offloadProgress = null;
    meshcoreContactCapacityState.summary = {
      count: null,
      level: 'normal',
      isWarning: false,
      isCritical: false,
    };
    offloadAndReconcileMock.mockReset();
    refreshCountMock.mockReset();
    cancelOffloadMock.mockReset();
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
    hydrateAxeThemeColors(container);
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

  it('does not fade offline, stale, or MQTT-only rows with opacity classes', () => {
    diagnosticsStoreState.ignoreMqttEnabled = true;
    const now = Date.now();
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', last_heard: now })],
      [
        2,
        makeNode({
          node_id: 2,
          long_name: 'OfflinePeer',
          last_heard: now - 8 * 24 * 3_600_000,
        }),
      ],
      [
        3,
        makeNode({
          node_id: 3,
          long_name: 'StalePeer',
          last_heard: now - 3 * 3_600_000,
        }),
      ],
      [
        4,
        makeNode({
          node_id: 4,
          long_name: 'MqttOnlyPeer',
          last_heard: now,
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
      />,
    );

    for (const name of ['OfflinePeer', 'StalePeer', 'MqttOnlyPeer'] as const) {
      const cell = screen.getByText(name);
      const row = cell.closest('tr');
      expect(row).not.toBeNull();
      expect(row!.className).not.toMatch(/opacity-(?:20|35|50)\b/);
      expect(row!.querySelector('[role="img"]')).not.toBeNull();
    }
    // MQTT-ignored peers still get a strikethrough name treatment without row fade.
    expect(screen.getByText('MqttOnlyPeer').closest('td')?.className).toContain('line-through');
  });

  it('shows Signal and SNR columns for meshcore contacts with RF data', () => {
    const nodes = new Map<number, MeshNode>([
      [
        0xabcd,
        makeNode({
          node_id: 0xabcd,
          long_name: 'Remote Peer',
          hw_model: 'Chat',
          snr: 5.5,
          rssi: -70,
          hops_away: 2,
        }),
      ],
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
    expect(screen.getByRole('columnheader', { name: /Signal/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /SNR/i })).toBeInTheDocument();
    expect(screen.getByText('5.5 dB')).toBeInTheDocument();
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
    expect(screen.getByLabelText(HYBRID_MQTT_PATH_ARIA)).toBeInTheDocument();
    expect(screen.queryByText('relay')).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
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
    expect(screen.getByLabelText(HYBRID_MQTT_PATH_ARIA)).toBeInTheDocument();
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
    expect(screen.queryByLabelText(HYBRID_MQTT_PATH_ARIA)).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText(HYBRID_MQTT_PATH_ARIA)).not.toBeInTheDocument();
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

  it('shows offload progress spinner and cancel while loading', () => {
    meshcoreContactCapacityState.contactCount = 349;
    meshcoreContactCapacityState.loading = true;
    meshcoreContactCapacityState.offloadProgress = { phase: 'removing', current: 12, total: 349 };
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
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Removing 12 of 349…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offload' })).not.toBeInTheDocument();
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

  it('drops the MeshCore ID column (no ID header, no !-prefixed id text)', () => {
    const nodeId = 0xdeadbeef;
    const nodes = new Map<number, MeshNode>([
      [nodeId, makeNode({ node_id: nodeId, long_name: 'Peer', hw_model: 'Chat' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        meshcorePublicKeyHexByNodeId={new Map([[nodeId, 'aa'.repeat(32)]])}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: /^ID$/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^!/)).not.toBeInTheDocument();
  });

  it.each(['Chat', 'Sensor', 'Repeater', 'Room'])(
    'shows the key icon for any MeshCore %s contact with a known public key',
    (hwModel) => {
      const nodeId = 0xdeadbeef;
      const nodes = new Map<number, MeshNode>([
        [nodeId, makeNode({ node_id: nodeId, long_name: 'Peer', hw_model: hwModel })],
      ]);
      render(
        <NodeListPanel
          nodes={nodes}
          myNodeNum={0}
          onNodeClick={vi.fn()}
          locationFilter={defaultFilter}
          onToggleFavorite={vi.fn()}
          mode="meshcore"
          meshcorePublicKeyHexByNodeId={new Map([[nodeId, 'aa'.repeat(32)]])}
        />,
      );
      expect(screen.getByLabelText('Has public key')).toBeInTheDocument();
    },
  );

  it('hides the key icon when the MeshCore contact has no known public key', () => {
    const nodeId = 0xdeadbeef;
    const nodes = new Map<number, MeshNode>([
      [nodeId, makeNode({ node_id: nodeId, long_name: 'Peer', hw_model: 'Chat' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
        meshcorePublicKeyHexByNodeId={new Map()}
      />,
    );
    expect(screen.queryByLabelText('Has public key')).not.toBeInTheDocument();
  });

  it('labels the first column "Health" for both Meshtastic and MeshCore', () => {
    const meshtastic = render(
      <NodeListPanel
        nodes={new Map()}
        myNodeNum={0}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(meshtastic.getByRole('columnheader', { name: /Health/ })).toBeInTheDocument();
    meshtastic.unmount();

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
    expect(screen.getByRole('columnheader', { name: /Health/ })).toBeInTheDocument();
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

describe('NodeListPanel virtualization', () => {
  it('enables row virtualization for large node lists', () => {
    const source = readFileSync(join(__dirname, 'NodeListPanel.tsx'), 'utf8');
    expect(source).toContain('useVirtualizer');
    expect(source).toContain('shouldVirtualizeNodeRows');
    expect(source).toMatch(/nodeList\.length\s*>\s*100/);
  });
});

describe('NodeListPanel History tab', () => {
  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    vi.mocked(window.electronAPI.db.listMeshtasticDmPeers).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.listMeshcoreDmPeers).mockResolvedValue([]);
  });

  it('has no axe violations on All and History list toggles', async () => {
    const user = userEvent.setup();
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'OnlyNode', last_heard: Date.now() })],
    ]);
    const { container } = render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows empty History state when there are no DMs', async () => {
    const user = userEvent.setup();
    render(
      <NodeListPanel
        nodes={new Map([[1, makeNode({ node_id: 1, long_name: 'OnlyNode' })]])}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByText('OnlyNode')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(
      screen.getByText('No direct messages yet — send or receive a DM to see peers here.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('OnlyNode')).not.toBeInTheDocument();
  });

  it('lists DM peers on History and keeps non-DM nodes on All', async () => {
    const user = userEvent.setup();
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'dm-1',
      from: 2,
      senderName: 'Alice',
      to: 1,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    });
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me' })],
      [2, makeNode({ node_id: 2, long_name: 'Alice' })],
      [3, makeNode({ node_id: 3, long_name: 'NeverMessaged' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    expect(screen.getByText('NeverMessaged')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    expect(screen.queryByText('NeverMessaged')).not.toBeInTheDocument();
  });

  it('merges SQLite DM peers into History when not in the message window', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.listMeshtasticDmPeers).mockResolvedValue([
      { node_id: 9, last_message_at: 1_700_000_100_000 },
    ]);
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me' })],
      [9, makeNode({ node_id: 9, long_name: 'FromDb' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('FromDb')).toBeInTheDocument();
    });
  });

  it('excludes MeshCore Room nodes from History even if listed by SQLite', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.listMeshcoreDmPeers).mockResolvedValue([
      { node_id: 11, last_message_at: 1_700_000_100_000 },
      { node_id: 12, last_message_at: 1_700_000_200_000 },
    ]);
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', hw_model: 'Chat' })],
      [11, makeNode({ node_id: 11, long_name: 'RoomServer', hw_model: 'Room' })],
      [12, makeNode({ node_id: 12, long_name: 'DmPeer', hw_model: 'Chat' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('DmPeer')).toBeInTheDocument();
    });
    expect(screen.queryByText('RoomServer')).not.toBeInTheDocument();
  });

  it('excludes MeshCore Repeater nodes from History even if listed by SQLite', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.listMeshcoreDmPeers).mockResolvedValue([
      { node_id: 21, last_message_at: 1_700_000_100_000 },
      { node_id: 22, last_message_at: 1_700_000_200_000 },
    ]);
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me', hw_model: 'Chat' })],
      [21, makeNode({ node_id: 21, long_name: 'RepeaterAlpha', hw_model: 'Repeater' })],
      [22, makeNode({ node_id: 22, long_name: 'DmPeer', hw_model: 'Chat' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshcore"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('DmPeer')).toBeInTheDocument();
    });
    expect(screen.queryByText('RepeaterAlpha')).not.toBeInTheDocument();
  });

  it('shows a stub History row when the DM peer is missing from NodeDB', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.listMeshtasticDmPeers).mockResolvedValue([
      { node_id: 9, last_message_at: 1_700_000_100_000 },
    ]);
    render(
      <NodeListPanel
        nodes={new Map([[1, makeNode({ node_id: 1, long_name: 'Me' })]])}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      // Stub uses hex id as both Node ID cell and display name.
      expect(screen.getAllByText('!00000009').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('sorts History peers by latest DM activity descending', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.db.listMeshtasticDmPeers).mockResolvedValue([
      { node_id: 2, last_message_at: 1_000 },
      { node_id: 3, last_message_at: 3_000 },
      { node_id: 4, last_message_at: 2_000 },
    ]);
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me' })],
      [2, makeNode({ node_id: 2, long_name: 'Oldest' })],
      [3, makeNode({ node_id: 3, long_name: 'Newest' })],
      [4, makeNode({ node_id: 4, long_name: 'Middle' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('Newest')).toBeInTheDocument();
    });
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '');
    const newestIdx = names.findIndex((t) => t.includes('Newest'));
    const middleIdx = names.findIndex((t) => t.includes('Middle'));
    const oldestIdx = names.findIndex((t) => t.includes('Oldest'));
    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(newestIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(oldestIdx);
  });

  it('filters History peers with search and restores All after switching back', async () => {
    const user = userEvent.setup();
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'dm-search-1',
      from: 2,
      senderName: 'Alice',
      to: 1,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    });
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'dm-search-2',
      from: 3,
      senderName: 'Bob',
      to: 1,
      payload: 'hi',
      channelIndex: 0,
      timestamp: 1_700_000_100_000,
      status: 'acked',
    });
    const nodes = new Map<number, MeshNode>([
      [1, makeNode({ node_id: 1, long_name: 'Me' })],
      [2, makeNode({ node_id: 2, long_name: 'Alice' })],
      [3, makeNode({ node_id: 3, long_name: 'Bob' })],
      [4, makeNode({ node_id: 4, long_name: 'NeverMessaged' })],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={defaultFilter}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Search nodes'), { target: { value: 'bob' } });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search nodes'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('NeverMessaged')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('does not apply distance filter on History (All-only)', async () => {
    const user = userEvent.setup();
    addMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'dm-far-1',
      from: 2,
      senderName: 'FarPeer',
      to: 1,
      payload: 'hello',
      channelIndex: 0,
      timestamp: 1_700_000_000_000,
      status: 'acked',
    });
    const nodes = new Map<number, MeshNode>([
      [
        1,
        makeNode({
          node_id: 1,
          long_name: 'Me',
          latitude: 40,
          longitude: -105,
        }),
      ],
      [
        2,
        makeNode({
          node_id: 2,
          long_name: 'FarPeer',
          latitude: 0,
          longitude: 0,
        }),
      ],
      [
        3,
        makeNode({
          node_id: 3,
          long_name: 'NearNoDm',
          latitude: 40.01,
          longitude: -105.01,
        }),
      ],
    ]);
    render(
      <NodeListPanel
        nodes={nodes}
        myNodeNum={1}
        onNodeClick={vi.fn()}
        locationFilter={{
          enabled: true,
          maxDistance: 1,
          unit: 'miles',
          hideMqttOnly: false,
        }}
        onToggleFavorite={vi.fn()}
        mode="meshtastic"
      />,
    );
    // FarPeer has coords at 0,0 — filtered out of All when distance filter is on
    // (nodes without GPS stay; FarPeer has GPS far away).
    expect(screen.queryByText('FarPeer')).not.toBeInTheDocument();
    expect(screen.getByText('NearNoDm')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getByText('FarPeer')).toBeInTheDocument();
    });
    expect(screen.queryByText('NearNoDm')).not.toBeInTheDocument();
  });
});
