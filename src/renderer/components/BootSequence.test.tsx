import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconMotionProvider } from '../lib/icons/iconMotionContext';
import { meshtasticProtocol } from '../lib/protocols/MeshtasticProtocol';
import { pickInclusiveOneLinerKey } from '../lib/signalPulseSplashUtils';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import type { DeviceRecord } from '../stores/deviceStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useIdentityStore } from '../stores/identityStore';
import { useNodeStore } from '../stores/nodeStore';
import BootSequence, {
  buildBootLines,
  computeBootCanvasLayout,
  computeTiming,
  REDUCED_MOTION_DURATION_MS,
} from './BootSequence';

const ID = 'test-identity';

const MINIMAL_CONNECTION: ConnectionRecord = {
  identityId: ID,
  status: 'disconnected',
  connectionType: null,
  mqttStatus: 'disconnected',
  reconnectAttempt: 0,
  myNodeNum: 0,
};

let rafId = 0;
const pendingRafs = new Map<number, FrameRequestCallback>();

function createMockCanvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    lineWidth: 1,
    fillStyle: '',
    strokeStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    globalCompositeOperation: 'source-over',
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
  } as unknown as CanvasRenderingContext2D;
}

function installRafMock(): void {
  rafId = 0;
  pendingRafs.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafId += 1;
    pendingRafs.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pendingRafs.delete(id);
  });
}

function flushRaf(timeMs: number): void {
  const callbacks = [...pendingRafs.values()];
  pendingRafs.clear();
  for (const cb of callbacks) {
    cb(timeMs);
  }
}

function advanceBootAnimation(maxMs: number): void {
  let time = 0;
  act(() => {
    flushRaf(time);
  });
  while (pendingRafs.size > 0 && time < maxMs) {
    time += 200;
    act(() => {
      flushRaf(time);
    });
  }
}

function renderBootSequence(props: ComponentProps<typeof BootSequence>): ReturnType<typeof render> {
  return render(
    <IconMotionProvider>
      <BootSequence {...props} />
    </IconMotionProvider>,
  );
}

function setDeviceData(data: Partial<DeviceRecord>): void {
  useDeviceStore.setState({
    devices: { [ID]: data as DeviceRecord },
  });
}

function oneLinerLengthForSeed(seed: number): number {
  const key = pickInclusiveOneLinerKey(seed);
  return `> ${i18next.t(key)}`.length;
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

  it('shows HTTP interface for MeshCore with http connection', () => {
    useConnectionStore.setState({
      connections: {
        [ID]: { ...MINIMAL_CONNECTION, connectionType: 'http', status: 'connected' },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[1].message).toBe('HTTP interface ready');
  });

  it('shows Radio interface for MeshCore with null connectionType', () => {
    useConnectionStore.setState({
      connections: {
        [ID]: { ...MINIMAL_CONNECTION, connectionType: null },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines[1].message).toBe('Radio interface ready');
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

  it('includes contacts and routes when both are available', () => {
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
      ],
    });
    useNodeStore.setState({
      nodes: {
        [ID]: {
          10: { nodeId: 10, longName: 'NodeA' },
        },
      },
    });
    const lines = buildBootLines('meshcore', ID);
    expect(lines).toHaveLength(7);
    expect(lines[3].message).toBe('Contacts: 1 contact loaded');
    expect(lines[4].message).toBe('Routes: 1 node in mesh');
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

  it('returns generic Meshtastic lines when identity exists but stores are empty', () => {
    useIdentityStore.setState({
      identities: {
        [ID]: {
          id: ID,
          protocol: meshtasticProtocol,
          signature: 'test',
          transports: [],
          createdAt: 0,
          lastSeenAt: 0,
        },
      },
      activeIdentityId: ID,
    });
    const lines = buildBootLines('meshtastic', ID);
    expect(lines).toHaveLength(6);
    expect(lines[1].message).toBe('LoRa: radio interface');
    expect(lines[3].message).toBe('Syncing mesh database...');
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
    expect(timing.lineEnds[0]).toBe(160 + 5 * 25);
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

  it('handles empty bootLines with finite timing values', () => {
    const timing = computeTiming([], 5);
    expect(timing.lineStarts).toHaveLength(0);
    expect(timing.lineEnds).toHaveLength(0);
    expect(timing.oneLinerStart).toBe(450);
    expect(Number.isFinite(timing.oneLinerStart)).toBe(true);
    expect(Number.isFinite(timing.oneLinerEnd)).toBe(true);
    expect(Number.isFinite(timing.cursorStart)).toBe(true);
    expect(Number.isFinite(timing.totalMs)).toBe(true);
    expect(timing.oneLinerEnd).toBe(450 + 5 * 25);
    expect(timing.cursorStart).toBe(timing.oneLinerEnd + 50);
    expect(timing.totalMs).toBe(timing.cursorStart + 2 * 400 * 2);
  });

  it('handles zero-length one-liner', () => {
    const timing = computeTiming(lines, 0);
    expect(timing.oneLinerEnd).toBe(timing.oneLinerStart);
  });
});

describe('computeBootCanvasLayout', () => {
  it('returns positive font and width metrics', () => {
    const bootLines = buildBootLines('meshtastic', null);
    const measure = (text: string) => text.length * 10;
    const layout = computeBootCanvasLayout(1024, 768, bootLines, '> Stay on the air.', measure);
    expect(layout.fontPx).toBeGreaterThan(0);
    expect(layout.prefixWidth).toBeGreaterThan(0);
    expect(layout.oneLinerWidth).toBeGreaterThan(0);
    expect(layout.startX).toBeGreaterThanOrEqual(0);
    expect(layout.startY).toBeGreaterThan(0);
  });
});

describe('BootSequence component', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useDeviceStore.setState({ devices: {} });
    useConnectionStore.setState({ connections: {} });
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    localStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
    installRafMock();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type) => {
      if (type === '2d') return createMockCanvasContext();
      return null;
    });
  });

  afterEach(() => {
    pendingRafs.clear();
    vi.restoreAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
  });

  it('renders a canvas element', () => {
    const { container } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 42,
      identityId: null,
    });
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders with MeshCore protocol', () => {
    const { container } = renderBootSequence({
      protocol: 'meshcore',
      phraseSeed: 99,
      identityId: null,
    });
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders with Reticulum protocol', () => {
    const { container } = renderBootSequence({
      protocol: 'reticulum',
      phraseSeed: 12,
      identityId: null,
    });
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders with Meshtastic identityId', () => {
    const { container } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 7,
      identityId: ID,
    });
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders with MeshCore identityId', () => {
    const { container } = renderBootSequence({
      protocol: 'meshcore',
      phraseSeed: 7,
      identityId: ID,
    });
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('is aria-hidden', () => {
    const { container } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 0,
      identityId: null,
    });
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls onComplete on unmount when animation has not finished', () => {
    let called = false;
    const { unmount } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 1,
      identityId: null,
      onComplete: () => {
        called = true;
      },
    });
    unmount();
    expect(called).toBe(true);
  });

  it('calls onComplete once when animation finishes normally', () => {
    const onComplete = vi.fn();
    const lines = buildBootLines('meshtastic', null);
    const totalMs = computeTiming(lines, oneLinerLengthForSeed(3)).totalMs;

    renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 3,
      identityId: null,
      onComplete,
    });

    advanceBootAnimation(totalMs + 500);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete twice when unmounting after animation completes', () => {
    const onComplete = vi.fn();
    const lines = buildBootLines('meshtastic', null);
    const totalMs = computeTiming(lines, oneLinerLengthForSeed(5)).totalMs;

    const { unmount } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 5,
      identityId: null,
      onComplete,
    });

    advanceBootAnimation(totalMs + 500);
    expect(onComplete).toHaveBeenCalledTimes(1);
    unmount();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('completes reduced motion path and calls onComplete once', () => {
    localStorage.setItem('mesh-client:appSettings', JSON.stringify({ reduceMotion: true }));
    document.documentElement.dataset.reduceMotion = 'true';
    const onComplete = vi.fn();

    const { container } = renderBootSequence({
      protocol: 'meshtastic',
      phraseSeed: 2,
      identityId: null,
      onComplete,
    });

    expect(container.querySelector('canvas')).toBeInTheDocument();
    advanceBootAnimation(REDUCED_MOTION_DURATION_MS + 500);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
