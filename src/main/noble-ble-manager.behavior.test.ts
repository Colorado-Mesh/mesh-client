// @vitest-environment node
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CharacteristicBehavior {
  properties: string[];
  subscribeFails?: boolean;
  readResults?: Buffer[];
}

class FakeCharacteristic extends EventEmitter {
  public readonly uuid: string;
  public readonly properties: string[];
  public subscribeCalls = 0;
  public readCalls = 0;
  public writeCalls = 0;
  private readonly subscribeFails: boolean;
  private readQueue: Buffer[];

  constructor(uuid: string, behavior: CharacteristicBehavior) {
    super();
    this.uuid = uuid;
    this.properties = behavior.properties;
    this.subscribeFails = Boolean(behavior.subscribeFails);
    this.readQueue = behavior.readResults ?? [Buffer.alloc(0)];
  }

  async subscribeAsync(): Promise<void> {
    await Promise.resolve();
    this.subscribeCalls += 1;
    if (this.subscribeFails) throw new Error('subscribe failed');
  }

  async unsubscribeAsync(): Promise<void> {
    return Promise.resolve();
  }

  async readAsync(): Promise<Buffer> {
    await Promise.resolve();
    this.readCalls += 1;
    return this.readQueue.length > 0 ? this.readQueue.shift()! : Buffer.alloc(0);
  }

  async writeAsync(): Promise<void> {
    await Promise.resolve();
    this.writeCalls += 1;
  }
}

class FakePeripheral extends EventEmitter {
  public readonly id: string;
  public readonly address = '20:6e:f1:b8:8d:99';
  public readonly addressType = 'public';
  public readonly rssi = -80;
  public state: 'disconnected' | 'connected' = 'disconnected';
  public mtu = 172;
  private readonly characteristics: FakeCharacteristic[];

  constructor(id: string, characteristics: FakeCharacteristic[]) {
    super();
    this.id = id;
    this.characteristics = characteristics;
  }

  async connectAsync(): Promise<void> {
    await Promise.resolve();
    this.state = 'connected';
  }

  async disconnectAsync(): Promise<void> {
    await Promise.resolve();
    this.state = 'disconnected';
    this.emit('disconnect', 'manual');
  }

  async discoverSomeServicesAndCharacteristicsAsync(): Promise<{
    characteristics: FakeCharacteristic[];
  }> {
    await Promise.resolve();
    return { characteristics: this.characteristics };
  }

  async discoverAllServicesAndCharacteristicsAsync(): Promise<{
    characteristics: FakeCharacteristic[];
  }> {
    await Promise.resolve();
    return { characteristics: this.characteristics };
  }
}

class FakeNoble extends EventEmitter {
  public state = 'poweredOn';
  async startScanning(): Promise<void> {
    return Promise.resolve();
  }

  stopScanning(): void {
    // no-op for behavior tests
  }

  stop(): void {
    // no-op for behavior tests
  }
}

const MESHCORE_RX_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';
const MESHCORE_TX_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';

/** Matches `shouldUseFromRadioReadPump` for meshcore + notify-first: no parallel GATT reads on darwin or win32. */
const MESHCORE_NOTIFY_FIRST_SKIPS_READ_PUMP =
  process.platform === 'darwin' || process.platform === 'win32';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('NobleBleManager behavior (notify-first + fallback)', () => {
  let fakeNoble: FakeNoble;

  beforeEach(() => {
    vi.resetModules();
    fakeNoble = new FakeNoble();
    vi.doMock('@stoprocent/noble', () => fakeNoble);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupMeshcoreConnection(txBehavior: CharacteristicBehavior) {
    const mod = await import('./noble-ble-manager');
    const manager = new mod.NobleBleManager();
    // In Linux CI, NobleBleManager skips session initialization at construction time.
    // These behavior tests target Noble session logic directly, so seed sessions explicitly.
    (manager as any).sessions.set('meshtastic', (manager as any).createSessionState());
    (manager as any).sessions.set('meshcore', (manager as any).createSessionState());
    (manager as any).adapterReady = true;
    (manager as any).lastAdapterState = 'poweredOn';

    const toRadio = new FakeCharacteristic(MESHCORE_RX_UUID, { properties: ['write'] });
    const fromRadio = new FakeCharacteristic(MESHCORE_TX_UUID, txBehavior);
    const peripheral = new FakePeripheral('meshcore-peripheral', [toRadio, fromRadio]);
    (manager as any).knownPeripherals.set(peripheral.id, peripheral);

    await manager.connect('meshcore', peripheral.id);
    return { manager, toRadio, fromRadio };
  }

  it('uses notify-first for read+notify characteristics and forwards notify payloads', async () => {
    const { manager, fromRadio } = await setupMeshcoreConnection({
      properties: ['read', 'notify'],
      readResults: [Buffer.alloc(0)],
    });

    expect(fromRadio.subscribeCalls).toBe(1);
    // MeshCore + notify-first: darwin + win32 skip the read pump (CoreBluetooth / WinRT). Linux keeps
    // a read safety net alongside notify — expect at least the initial drain read on CI.
    if (MESHCORE_NOTIFY_FIRST_SKIPS_READ_PUMP) {
      expect(fromRadio.readCalls).toBe(0);
    } else {
      expect(fromRadio.readCalls).toBeGreaterThanOrEqual(1);
    }

    const received: Uint8Array[] = [];
    manager.on('fromRadio', ({ bytes }) => {
      received.push(bytes);
    });
    fromRadio.emit('data', Buffer.from([1, 2, 3]), true);

    expect(received).toHaveLength(1);
    expect(Array.from(received[0])).toEqual([1, 2, 3]);
  });

  it('falls back to read-pump when subscribe fails on read+notify characteristics', async () => {
    const mod = await import('./noble-ble-manager');
    const manager = new mod.NobleBleManager();
    (manager as any).sessions.set('meshtastic', (manager as any).createSessionState());
    (manager as any).sessions.set('meshcore', (manager as any).createSessionState());
    (manager as any).adapterReady = true;
    (manager as any).lastAdapterState = 'poweredOn';

    const toRadio = new FakeCharacteristic(MESHCORE_RX_UUID, { properties: ['write'] });
    const fromRadio = new FakeCharacteristic(MESHCORE_TX_UUID, {
      properties: ['read', 'notify'],
      subscribeFails: true,
      readResults: [Buffer.from([9]), Buffer.alloc(0)],
    });
    const peripheral = new FakePeripheral('meshcore-peripheral', [toRadio, fromRadio]);
    (manager as any).knownPeripherals.set(peripheral.id, peripheral);

    if (process.platform === 'win32') {
      await expect(manager.connect('meshcore', peripheral.id)).rejects.toThrow(
        /BLE notify subscribe failed on Windows/,
      );
      expect(fromRadio.subscribeCalls).toBe(1);
      expect(fromRadio.readCalls).toBe(0);
      return;
    }

    await manager.connect('meshcore', peripheral.id);
    expect(fromRadio.subscribeCalls).toBe(1);
    // Initial connect path triggers one read-pump burst in fallback mode (non-Windows).
    await wait(20);
    expect(fromRadio.readCalls).toBeGreaterThan(0);

    const readsAfterConnect = fromRadio.readCalls;
    await manager.writeToRadio('meshcore', Buffer.from([0xaa]));
    await wait(140);
    expect(fromRadio.readCalls).toBeGreaterThan(readsAfterConnect);
  });

  it('fails connect when fromRadio supports neither notify nor read', async () => {
    const mod = await import('./noble-ble-manager');
    const manager = new mod.NobleBleManager();
    (manager as any).sessions.set('meshtastic', (manager as any).createSessionState());
    (manager as any).sessions.set('meshcore', (manager as any).createSessionState());
    (manager as any).adapterReady = true;
    (manager as any).lastAdapterState = 'poweredOn';
    const toRadio = new FakeCharacteristic(MESHCORE_RX_UUID, { properties: ['write'] });
    const fromRadio = new FakeCharacteristic(MESHCORE_TX_UUID, { properties: [] });
    const peripheral = new FakePeripheral('meshcore-no-rx', [toRadio, fromRadio]);
    (manager as any).knownPeripherals.set(peripheral.id, peripheral);

    await expect(manager.connect('meshcore', peripheral.id)).rejects.toThrow(
      'fromRadio characteristic supports neither notify nor read',
    );
  });

  it('meshcore notify-first skips post-write read pump on darwin/win32 only', async () => {
    const { manager, fromRadio } = await setupMeshcoreConnection({
      properties: ['read', 'notify'],
      readResults: [Buffer.alloc(0)],
    });

    const readsAfterSubscribe = fromRadio.readCalls;
    if (MESHCORE_NOTIFY_FIRST_SKIPS_READ_PUMP) {
      expect(readsAfterSubscribe).toBe(0);
    } else {
      expect(readsAfterSubscribe).toBeGreaterThanOrEqual(1);
    }
    await manager.writeToRadio('meshcore', Buffer.from([0xbb]));
    // Linux early-poll fallback now backs off at 250ms between attempts.
    await wait(340);
    if (MESHCORE_NOTIFY_FIRST_SKIPS_READ_PUMP) {
      expect(fromRadio.readCalls).toBe(0);
    } else {
      expect(fromRadio.readCalls).toBeGreaterThan(readsAfterSubscribe);
    }
  });
});
