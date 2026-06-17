import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import type { DeviceRecord } from '../stores/deviceStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useIdentityStore } from '../stores/identityStore';
import { useNodeStore } from '../stores/nodeStore';
import BootSequence, { buildBootLines, computeTiming } from './BootSequence';

const ID = 'test-identity';

const MINIMAL_CONNECTION: ConnectionRecord = {
  identityId: ID,
  status: 'disconnected',
  connectionType: null,
  mqttStatus: 'disconnected',
  reconnectAttempt: 0,
  myNodeNum: 0,
};

function setDeviceData(data: Partial<DeviceRecord>): void {
  useDeviceStore.setState({
    devices: { [ID]: data as DeviceRecord },
  });
}

describe('buildBootLines', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useDeviceStore.setState({ devices: {} });
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('returns generic fallback messages for Meshtastic with no data', () => {
    const lines = buildBootLines('meshtastic', ID);
    expect(lines).toHaveLength(6);
    expect(lines[0].message).toBe('Booting mesh stack...');
    expect(lines[1].message).toBe('LoRa: radio interface');
    expect(lines[2].message).toBe('Scanning configured channels...');
    expect(lines[3].message).toBe('Syncing mesh database...');
    expect(lines[4].message).toBe('Routes established');
    expect(lines[5].message).toBe('Mesh network active');
  });

  it('returns generic fallback messages for MeshCore with no data', () => {
    const lines = buildBootLines('meshcore', ID);
    expect(lines).toHaveLength(6);
    expect(lines[0].message).toBe('Booting mesh stack...');
    expect(lines[1].message).toBe('Radio interface ready');
    expect(lines[2].message).toBe('Configuring radio parameters...');
    expect(lines[3].message).toBe('Loading contact database...');
    expect(lines[4].message).toBe('Routes established');
    expect(lines[5].message).toBe('Mesh network active');
  });

  it('includes hardware model for Meshtastic when available', () => {
    useIdentityStore.setState({
      identities: {
        [ID]: {
          id: ID,
          protocol: meshtasticProtocol,
          signature: 'test',
          transports: [],
          hardwareModel: 'T-Beam v1.2',
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: ID,
    });
    const lines = buildBootLines('meshtastic', ID);
    expect(lines[1].message).toBe('LoRa: T-Beam v1.2');
  });

  it('includes channel count for Meshtastic when available', () => {
    setDeviceData({
      channels: [
        { index: 0, name: 'LongFast' },
        { index: 1, name: 'admin' },
      ],
    });
    const lines = buildBootLines('meshtastic', ID);
    expect(lines[2].message).toBe('Scanning channels... 2');
  });

  it('includes node count for Meshtastic when available', () => {
    useNodeStore.setState({
      nodes: {
        [ID]: {
          1: { nodeId: 1, longName: 'Node1' },
          2: { nodeId: 2, longName: 'Node2' },
          3: { nodeId: 3, longName: 'Node3' },
        },
      },
    });
    const lines = buildBootLines('meshtastic', ID);
    expect(lines[3].message).toBe('Database: 3 nodes synced');
  });

  it('uses singular node for count of 1', () => {
    useNodeStore.setState({
      nodes: {
        [ID]: { 1: { nodeId: 1, longName: 'Node1' } },
      },
    });
    const lines = buildBootLines('meshtastic', ID);
    expect(lines[3].message).toBe('Database: 1 node synced');
  });

  it('shows BLE interface for MeshCore with ble connection', () => {
    useConnectionStore.setState({
      connections: {
        [ID]: { ...MINIMAL_CONNECTION, connectionType: 'ble', status: 'connected' },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[1].message).toBe('BLE interface ready');
  });

  it('shows Serial interface for MeshCore with serial connection', () => {
    useConnectionStore.setState({
      connections: {
        [ID]: { ...MINIMAL_CONNECTION, connectionType: 'serial', status: 'connected' },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[1].message).toBe('Serial interface ready');
  });

  it('includes frequency info for MeshCore when selfInfo available', () => {
    setDeviceData({
      meshcoreSelfInfo: {
        name: 'test',
        publicKey: new Uint8Array(32),
        type: 1,
        txPower: 20,
        radioFreq: 915_000_000,
        radioBw: 250_000,
        manualAddContacts: false,
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[2].message).toBe('Freq: 915 MHz | BW: 250 kHz');
  });

  it('includes contact count for MeshCore when available', () => {
    setDeviceData({
      meshcoreContacts: [
        {
          publicKey: new Uint8Array(32),
          type: 1,
          name: 'Alice',
          lastAdvert: 1000,
          advLat: 0,
          advLon: 0,
          flags: 0,
        },
        {
          publicKey: new Uint8Array(32),
          type: 1,
          name: 'Bob',
          lastAdvert: 1000,
          advLat: 0,
          advLon: 0,
          flags: 0,
        },
      ],
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[3].message).toBe('Contacts: 2 contacts loaded');
  });

  it('includes route node count for MeshCore when available', () => {
    useNodeStore.setState({
      nodes: {
        [ID]: {
          10: { nodeId: 10, longName: 'NodeA' },
          20: { nodeId: 20, longName: 'NodeB' },
        },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[4].message).toBe('Routes: 2 nodes in mesh');
  });

  it('prefix is always [ OK ]  for every line', () => {
    const lines = buildBootLines('meshtastic', ID);
    for (const line of lines) {
      expect(line.prefix).toBe('[ OK ]  ');
    }
  });

  it('handles null identityId gracefully', () => {
    const lines = buildBootLines('meshtastic', null);
    expect(lines).toHaveLength(6);
    expect(lines[0].message).toBe('Booting mesh stack...');
  });
});

describe('computeTiming', () => {
  const lines: { prefix: string; message: string }[] = [
    { prefix: '[ OK ]  ', message: 'Short' },
    { prefix: '[ OK ]  ', message: 'Longer message here' },
  ];

  it('returns all timing fields', () => {
    const timing = computeTiming(lines, 15);
    expect(timing).toHaveProperty('lineStarts');
    expect(timing).toHaveProperty('lineEnds');
    expect(timing).toHaveProperty('oneLinerStart');
    expect(timing).toHaveProperty('oneLinerEnd');
    expect(timing).toHaveProperty('cursorStart');
    expect(timing).toHaveProperty('totalMs');
  });

  it('lineStarts are staggered by LINE_GAP_MS', () => {
    const timing = computeTiming(lines, 10);
    expect(timing.lineStarts[1] - timing.lineStarts[0]).toBe(300);
  });

  it('lineEnds account for message length', () => {
    const timing = computeTiming(lines, 10);
    // line 0: start at 160, message "Short" = 5 chars * 25ms = 125ms → end at 285
    expect(timing.lineEnds[0]).toBe(160 + 5 * 25);
    // line 1: start at 460, message "Longer message here" = 19 chars * 25ms = 475ms → end at 935
    expect(timing.lineEnds[1]).toBe(460 + 19 * 25);
  });

  it('oneLinerStart is after last line end + pause', () => {
    const timing = computeTiming(lines, 10);
    expect(timing.oneLinerStart).toBe(timing.lineEnds[1] + 450);
  });

  it('oneLinerEnd accounts for one-liner length', () => {
    const timing = computeTiming(lines, 20);
    expect(timing.oneLinerEnd).toBe(timing.oneLinerStart + 20 * 25);
  });

  it('totalMs includes cursor blinks', () => {
    const timing = computeTiming(lines, 10);
    expect(timing.totalMs).toBe(timing.cursorStart + 2 * 400 * 2);
  });

  it('handles zero-length lines', () => {
    const empty: { prefix: string; message: string }[] = [];
    const timing = computeTiming(empty, 5);
    expect(timing.lineStarts).toHaveLength(0);
    expect(timing.lineEnds).toHaveLength(0);
  });
});

describe('BootSequence component', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useDeviceStore.setState({ devices: {} });
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
  });

  it('renders a canvas element', () => {
    const { container } = render(
      <BootSequence protocol="meshtastic" phraseSeed={42} identityId={null} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('renders with MeshCore protocol', () => {
    const { container } = render(
      <BootSequence protocol="meshcore" phraseSeed={99} identityId={null} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('renders with identityId', () => {
    const { container } = render(
      <BootSequence protocol="meshtastic" phraseSeed={7} identityId={ID} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('is aria-hidden', () => {
    const { container } = render(
      <BootSequence protocol="meshtastic" phraseSeed={0} identityId={null} />,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls onComplete on unmount when canvas is not available', () => {
    let called = false;
    const { unmount } = render(
      <BootSequence
        protocol="meshtastic"
        phraseSeed={1}
        identityId={null}
        onComplete={() => {
          called = true;
        }}
      />,
    );
    unmount();
    // The cleanup effect calls onComplete when no rAF was started
    expect(called).toBe(true);
  });
});
