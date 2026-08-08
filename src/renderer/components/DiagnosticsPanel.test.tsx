import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { setMeshtasticConnectedMyNodeNum } from '../lib/meshtasticConnectedNodeRef';
import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '../lib/radio/BaseRadioProvider';
import type { DiagnosticRow, MeshNode, RoutingDiagnosticRow } from '../lib/types';
import type { ForeignLoraDetection } from '../stores/diagnosticsStore';
import DiagnosticsPanel from './DiagnosticsPanel';

const diagnosticsStoreState: {
  diagnosticRows: DiagnosticRow[];
  packetStats: Map<number, unknown>;
  packetCache: Map<number, unknown>;
  getCuStats24h: () => null;
  foreignLoraDetections: Map<number, Map<string, ForeignLoraDetection>>;
} = {
  diagnosticRows: [],
  packetStats: new Map(),
  packetCache: new Map(),
  getCuStats24h: () => null,
  foreignLoraDetections: new Map(),
};

vi.mock('../stores/diagnosticsStore', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('../stores/diagnosticsStore')>();
  return {
    ...actual,
    useDiagnosticsStore: (selector: (s: unknown) => unknown) => {
      const store = {
        diagnosticRows: diagnosticsStoreState.diagnosticRows,
        diagnosticRowsRestoredAt: null,
        clearDiagnosticRowsSnapshot: vi.fn(),
        packetStats: diagnosticsStoreState.packetStats,
        packetCache: diagnosticsStoreState.packetCache,
        getCuStats24h: diagnosticsStoreState.getCuStats24h,
        anomalyHalosEnabled: false,
        congestionHalosEnabled: false,
        autoTracerouteEnabledMeshtastic: false,
        autoTracerouteEnabledMeshcore: false,
        setAutoTracerouteEnabled: vi.fn(),
        envMode: 'standard',
        ignoreMqttEnabled: false,
        mqttIgnoredNodes: new Set<number>(),
        setAnomalyHalosEnabled: vi.fn(),
        setCongestionHalosEnabled: vi.fn(),
        setEnvMode: vi.fn(),
        setIgnoreMqttEnabled: vi.fn(),
        setNodeMqttIgnored: vi.fn(),
        runReanalysis: vi.fn(),
        diagnosticRowsMaxAgeHours: 24,
        setDiagnosticRowsMaxAgeHours: vi.fn(),
        distanceOffsetKm: 0,
        setDistanceOffsetKm: vi.fn(),
        foreignLoraDetections: diagnosticsStoreState.foreignLoraDetections,
        cuHistory: new Map(),
      };
      return selector(store);
    },
  };
});

function minimalNode(nodeId: number): MeshNode {
  return {
    node_id: nodeId,
    long_name: 'Test Node',
    short_name: 'TN',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
  };
}

describe('DiagnosticsPanel accessibility', () => {
  it('has no axe violations with empty data', async () => {
    diagnosticsStoreState.diagnosticRows = [];
    diagnosticsStoreState.packetStats = new Map();
    const { container } = render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        protocol="meshtastic"
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders distance offset input with default 0', () => {
    diagnosticsStoreState.diagnosticRows = [];
    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        protocol="meshtastic"
      />,
    );
    const input = screen.getByLabelText(/distance offset/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(0);
  });
});

describe('DiagnosticsPanel node click', () => {
  it('calls onNodeClick when anomaly row is clicked', () => {
    const nodeId = 0x1234;
    const node = minimalNode(nodeId);
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Test anomaly',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();
    const nodes = new Map<number, MeshNode>([[nodeId, node]]);

    render(
      <DiagnosticsPanel
        nodes={nodes}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    expect(screen.getByText('Test Node')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Test Node'));
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(node);
  });

  it('does not call onNodeClick when action column is clicked', () => {
    const nodeId = 0x5678;
    const node = minimalNode(nodeId);
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Test',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();
    const nodes = new Map<number, MeshNode>([[nodeId, node]]);

    render(
      <DiagnosticsPanel
        nodes={nodes}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /ignore mqtt/i }));
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('falls back to hex id and is not clickable when node is missing', () => {
    const nodeId = 0x9abc;
    const row: RoutingDiagnosticRow = {
      kind: 'routing',
      id: `routing:${nodeId}`,
      nodeId,
      type: 'hop_goblin',
      severity: 'warning',
      description: 'Orphaned row',
      detectedAt: Date.now(),
    };
    diagnosticsStoreState.diagnosticRows = [row];
    diagnosticsStoreState.packetStats = new Map();

    const onNodeClick = vi.fn();

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        onNodeClick={onNodeClick}
        protocol="meshtastic"
      />,
    );

    const fallbackLabel = formatMeshtasticNodeId(nodeId);
    fireEvent.click(screen.getAllByText(fallbackLabel)[0]);
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});

describe('DiagnosticsPanel cross-protocol RF', () => {
  it('shows MeshCore heard-by-Meshtastic section with foreign node names', () => {
    const myId = 0xface;
    const foreignId = 0xabc12345;
    diagnosticsStoreState.diagnosticRows = [];
    diagnosticsStoreState.packetStats = new Map();
    setMeshtasticConnectedMyNodeNum(myId);
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myId,
        new Map([
          [
            `meshcore:${foreignId}`,
            {
              detectedAt: Date.now(),
              packetClass: 'meshcore',
              proximity: 'nearby',
              count: 3,
              lastSenderId: foreignId,
              longName: 'Nearby MeshCore',
              rssi: -48,
              snr: 11,
              source: 'meshtastic-rf',
            },
          ],
        ]),
      ],
    ]);
    const homeNode = minimalNode(myId);
    homeNode.long_name = 'My Meshtastic';
    const foreignNode = minimalNode(foreignId);
    foreignNode.long_name = 'Nearby MeshCore';
    const nodes = new Map<number, MeshNode>([
      [myId, homeNode],
      [foreignId, foreignNode],
    ]);

    render(
      <DiagnosticsPanel
        nodes={nodes}
        meshcoreNodes={nodes}
        myNodeNum={myId}
        meshtasticListenerNodeId={myId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
      />,
    );

    expect(
      screen.getByRole('heading', { name: /meshcore nodes heard by your meshtastic radio/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Nearby MeshCore')).toBeInTheDocument();
    expect(screen.queryByText('My Meshtastic')).not.toBeInTheDocument();
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('shows own meshcore node when overheard on meshtastic frequency', () => {
    const myMtId = 0xface;
    const myMcId = 0xabc12345;
    setMeshtasticConnectedMyNodeNum(myMtId);
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myMtId,
        new Map([
          [
            `meshcore:${myMcId}`,
            {
              detectedAt: Date.now(),
              packetClass: 'meshcore',
              proximity: 'very-close',
              count: 2,
              lastSenderId: myMcId,
              longName: 'My MeshCore Radio',
              rssi: -48,
              snr: 12,
              source: 'meshcore-radio-rf',
            },
          ],
        ]),
      ],
    ]);
    const homeNode = minimalNode(myMtId);
    const selfMc = minimalNode(myMcId);
    selfMc.long_name = 'My MeshCore Radio';
    render(
      <DiagnosticsPanel
        nodes={new Map([[myMtId, homeNode]])}
        meshcoreNodes={new Map([[myMcId, selfMc]])}
        myNodeNum={myMtId}
        meshtasticListenerNodeId={myMtId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
      />,
    );
    expect(screen.getByText('My MeshCore Radio')).toBeInTheDocument();
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('shows meshcore overhear without meshcore contacts when longName is stored', () => {
    const myId = 0xface;
    const foreignId = 0xabc12345;
    setMeshtasticConnectedMyNodeNum(myId);
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myId,
        new Map([
          [
            `meshcore:${foreignId}`,
            {
              detectedAt: Date.now(),
              packetClass: 'meshcore',
              proximity: 'nearby',
              count: 1,
              lastSenderId: foreignId,
              longName: 'RF Overheard Repeater',
              rssi: -52,
              snr: 10,
              source: 'meshtastic-rf',
            },
          ],
        ]),
      ],
    ]);
    const homeNode = minimalNode(myId);
    render(
      <DiagnosticsPanel
        nodes={new Map([[myId, homeNode]])}
        meshcoreNodes={new Map()}
        myNodeNum={myId}
        meshtasticListenerNodeId={myId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
      />,
    );
    expect(screen.getByText('RF Overheard Repeater')).toBeInTheDocument();
    setMeshtasticConnectedMyNodeNum(0);
  });

  it('shows other foreign LoRa section for meshtastic and unknown-lora classes', () => {
    const myId = 0xface;
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myId,
        new Map([
          [
            'meshtastic:0x111',
            {
              detectedAt: Date.now(),
              packetClass: 'meshtastic',
              proximity: 'distant',
              count: 2,
              lastSenderId: 0x111,
              source: 'meshtastic-rf',
            },
          ],
          [
            'unknown-lora',
            {
              detectedAt: Date.now(),
              packetClass: 'unknown-lora',
              proximity: 'nearby',
              count: 1,
              rssi: -90,
              snr: 4,
              source: 'meshtastic-rf',
            },
          ],
        ]),
      ],
    ]);

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={myId}
        meshtasticListenerNodeId={myId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: /other foreign lora overheard \(2\)/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Meshtastic Traffic')).toBeInTheDocument();
    expect(screen.getByText('Unknown LoRa Signal')).toBeInTheDocument();
  });

  it('hides foreign LoRa sections when there is no matching traffic', () => {
    const myId = 0xface;
    diagnosticsStoreState.foreignLoraDetections = new Map();

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={myId}
        meshtasticListenerNodeId={myId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /meshcore nodes heard by your meshtastic radio/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /other foreign lora overheard/i }),
    ).not.toBeInTheDocument();
  });

  it('does not show Meshtastic-keyed MeshCore-heard rows on the MeshCore tab', () => {
    const myId = 0xface;
    const foreignId = 0xabc12345;
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myId,
        new Map([
          [
            `meshcore:${foreignId}`,
            {
              detectedAt: Date.now(),
              packetClass: 'meshcore',
              proximity: 'nearby',
              count: 1,
              lastSenderId: foreignId,
              longName: 'Nearby MeshCore',
              source: 'meshtastic-rf',
            },
          ],
        ]),
      ],
    ]);

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0xbeef}
        meshtasticListenerNodeId={myId}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshcore"
      />,
    );

    expect(
      screen.queryByRole('heading', { name: /meshcore nodes heard by your meshtastic radio/i }),
    ).not.toBeInTheDocument();
  });

  it('shows other foreign LoRa on the MeshCore tab keyed by MeshCore self id', () => {
    const myMcId = 0xbeef;
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myMcId,
        new Map([
          [
            'meshtastic:0x111',
            {
              detectedAt: Date.now(),
              packetClass: 'meshtastic',
              proximity: 'nearby',
              count: 3,
              lastSenderId: 0x111,
              source: 'meshcore-radio-rf',
            },
          ],
        ]),
      ],
    ]);

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={myMcId}
        meshtasticListenerNodeId={0xface}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={true}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshcore"
      />,
    );

    expect(
      screen.getByRole('heading', { name: /other foreign lora overheard \(1\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Meshtastic Traffic')).toBeInTheDocument();
  });

  it('matches MeshCore repeater conflicts to the active foreign-LoRa listener', () => {
    const myMcId = 0xbeef;
    diagnosticsStoreState.foreignLoraDetections = new Map([
      [
        myMcId,
        new Map([
          [
            'meshcore:nearby',
            {
              detectedAt: Date.now(),
              packetClass: 'meshcore',
              proximity: 'nearby',
              count: 1,
              lastSenderId: 0x111,
              source: 'meshcore-radio-rf',
            },
          ],
        ]),
      ],
    ]);
    diagnosticsStoreState.diagnosticRows = [
      {
        kind: 'rf',
        id: 'rf:meshcore-conflict',
        nodeId: myMcId,
        condition: 'Potential MeshCore Repeater Conflict',
        cause: 'Nearby repeater conflict',
        severity: 'warning',
        detectedAt: Date.now(),
      },
    ];

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={myMcId}
        meshtasticListenerNodeId={0xface}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshcore"
        capabilities={MESHCORE_CAPABILITIES}
      />,
    );

    expect(screen.getByText(/nearby repeater may be causing collisions/i)).toBeInTheDocument();
  });
});

describe('DiagnosticsPanel reticulum scope', () => {
  it('does not surface Reticulum interface-down rows on the Meshtastic tab', () => {
    diagnosticsStoreState.diagnosticRows = [
      {
        kind: 'rf',
        id: 'rf:1:reticulum/interface-down/eth0',
        nodeId: 1,
        condition: 'reticulum/interface-down',
        cause: 'Reticulum interface Ethernet is down',
        severity: 'error',
        detectedAt: Date.now(),
      },
    ];

    render(
      <DiagnosticsPanel
        nodes={new Map([[1, minimalNode(1)]])}
        myNodeNum={1}
        meshtasticListenerNodeId={1}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Home')}
        protocol="meshtastic"
        capabilities={MESHTASTIC_CAPABILITIES}
      />,
    );

    expect(screen.queryByText('Reticulum interface Ethernet is down')).not.toBeInTheDocument();
    expect(screen.getByText(/no diagnostics detected/i)).toBeInTheDocument();
    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });

  it('does not surface Meshtastic routing rows on the Reticulum tab', () => {
    diagnosticsStoreState.diagnosticRows = [
      {
        kind: 'routing',
        id: 'routing:99',
        nodeId: 0x12345678,
        type: 'hop_goblin',
        severity: 'error',
        description: 'Ghost hop from Meshtastic',
        detectedAt: Date.now(),
      } satisfies RoutingDiagnosticRow,
    ];

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        protocol="reticulum"
        capabilities={RETICULUM_CAPABILITIES}
      />,
    );

    expect(screen.queryByText('Ghost hop from Meshtastic')).not.toBeInTheDocument();
    expect(screen.getByText(/no diagnostics detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/network health/i)).not.toBeInTheDocument();
  });

  it('shows Reticulum config diagnostics rows on the Reticulum tab', () => {
    diagnosticsStoreState.diagnosticRows = [
      {
        kind: 'rf',
        id: 'rf:1:reticulum/audit/ghost_interface/tcp-1',
        nodeId: 1,
        condition: 'reticulum/audit/ghost_interface',
        cause: 'Interface "Dublin" enabled in config but not loaded by RNS',
        severity: 'error',
        detectedAt: Date.now(),
        causeI18n: {
          key: 'diagnosticsPanel.reticulum.audit.ghost_interface',
          params: { name: 'Dublin', message: 'ghost' },
        },
        reticulumInterfaceId: 'tcp-1',
        reticulumRepairKind: 'repair_config',
      },
    ];

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={1}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected={false}
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Unknown')}
        protocol="reticulum"
        capabilities={RETICULUM_CAPABILITIES}
      />,
    );

    expect(screen.getByText('Reticulum interface config')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repair config' })).toBeInTheDocument();
  });

  it('does not list Reticulum TX-queue rows in the LoRa mesh Node/Offense table', () => {
    diagnosticsStoreState.diagnosticRows = [
      {
        kind: 'rf',
        id: 'rf:0:reticulum/tx-queue-drops/RNode 41F4',
        nodeId: 0,
        condition: 'reticulum/tx-queue-drops',
        cause: 'Interface "RNode 41F4" dropped 128 outbound packets (TX queue full)',
        severity: 'error',
        detectedAt: Date.now(),
        causeI18n: {
          key: 'diagnosticsPanel.reticulum.runtime.txQueueDropsBle',
          params: { name: 'RNode 41F4', count: '128' },
        },
        reticulumInterfaceId: 'rnode-41f4',
        reticulumRepairKind: 'edit',
      },
    ];

    render(
      <DiagnosticsPanel
        nodes={new Map()}
        myNodeNum={0xabcd}
        onTraceRoute={vi.fn().mockResolvedValue(undefined)}
        isConnected
        traceRouteResults={new Map()}
        getFullNodeLabel={vi.fn().mockReturnValue('Me')}
        protocol="reticulum"
        capabilities={RETICULUM_CAPABILITIES}
      />,
    );

    expect(screen.queryByText('Mesh diagnostics (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('!00000000')).not.toBeInTheDocument();
    expect(screen.getAllByText(/RNode 41F4/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /edit interface/i })).toBeInTheDocument();
  });
});
