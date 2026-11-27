/**
 * Mobile replacement for `src/main/gatt-sidecar-proxy.ts` (swapped in by
 * `scripts/build-mobile-host.mjs`). Same exports and events; the LoRa GATT pipe runs on the OS
 * Bluetooth stack through `@capacitor-community/bluetooth-le` instead of the Reticulum sidecar's
 * btleplug.
 *
 * Wire behavior mirrors the sidecar (`reticulum-sidecar/src/gatt/btleplug_backend.rs`):
 * - Meshtastic: write ToRadio; FromNum notifications (and every write) request a FromRadio drain;
 *   a drain reads FromRadio until `FROM_RADIO_REQUESTED_EMPTY_STREAK` empty reads (one for the
 *   2 s fallback poll); three consecutive failed drains report `read_pump_stalled`.
 * - MeshCore / MeshCom: Nordic UART — write RX, forward TX notifications.
 * Operations on one peripheral are serialized (Android GATT allows one outstanding operation).
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

// Pure helpers and types are shared with the desktop proxy (imported from the desktop module
// directly: the mobile build only redirects imports of it that come from src/main/**).
import {
  type GattConnectResult,
  type GattDiscoveredDevice,
  type GattPairResult,
  type GattPairStateResult,
  type GattSessionProfile,
  type GattStartScanResult,
  gattWireProfileFromSession,
  isGattSessionProfile,
} from '../../../main/gatt-sidecar-proxy';
import { callNative, onNativeEvent } from '../hostChannel';

export {
  fetchErrorDetail,
  gattConnectFailureCode,
  type GattConnectResult,
  type GattDiscoveredDevice,
  type GattPairResult,
  type GattPairStateResult,
  type GattSessionProfile,
  type GattStartScanResult,
  type GattWireProfile,
  gattWireProfileFromSession,
  isGattSessionProfile,
  isPeripheralNotFoundMessage,
} from '../../../main/gatt-sidecar-proxy';

export const MESHTASTIC_UUIDS = {
  service: '6ba1b218-15a8-461f-9fa8-5dcae273eafd',
  toRadio: 'f75c76d2-129e-4dad-a1dd-7866124401e7',
  fromRadio: '2c55e69e-4993-11ed-b878-0242ac120002',
  fromNum: 'ed9da18c-a800-4f66-a670-aa7547e34453',
} as const;

export const NUS_UUIDS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

const BLE = 'BluetoothLe';
const GATT_RSSI_POLL_MS = 4_000;
const CONNECT_TIMEOUT_MS = 20_000;
const FROM_RADIO_READ_TIMEOUT_MS = 5_000;
const FROM_RADIO_POLL_INTERVAL_MS = 2_000;
const FROM_RADIO_REQUESTED_EMPTY_STREAK = 5;
const FROM_RADIO_POLL_EMPTY_STREAK = 1;
const FROM_RADIO_MAX_FAILED_DRAINS = 3;
const FROM_RADIO_EMPTY_RETRY_MS = 100;
/** Meshtastic recommends 512; Android negotiates up to 517 (iOS chooses automatically). */
const PREFERRED_MTU = 512;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function unhex(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) return new Uint8Array(0);
  return Uint8Array.from(Buffer.from(value.replace(/[^0-9a-f]/gi, ''), 'hex'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

interface Session {
  profile: GattSessionProfile;
  deviceId: string;
  seedRssi: number | null;
  queue: Promise<unknown>;
  closed: boolean;
  drainRequested: boolean;
  drainWake: (() => void) | null;
  rssiTimer: ReturnType<typeof setInterval> | null;
  unsubscribers: (() => void)[];
  writeWithoutResponse: boolean;
}

export class GattSidecarProxy extends EventEmitter {
  private readonly sessions = new Map<GattSessionProfile, Session>();
  private readonly lastScanRssi = new Map<string, number>();
  private connectionGuard: ((sessionId: GattSessionProfile, address: string) => void) | null = null;
  private rnodeBondRecoveryExclusive = false;
  private initialized: Promise<void> | null = null;
  private scanning: GattSessionProfile | null = null;
  private quitting = false;

  private ensureInit(): Promise<void> {
    this.initialized ??= callNative(BLE, 'initialize', { androidNeverForLocation: true })
      .then(() => undefined)
      .catch((e: unknown) => {
        this.initialized = null;
        throw e instanceof Error ? e : new Error(String(e));
      });
    return this.initialized;
  }

  setQuitting(): void {
    this.quitting = true;
  }

  /** Desktop wires the sidecar starter here; mobile BLE does not need the sidecar. */
  setEnsureSidecar(): void {}

  setConnectionGuard(guard: (sessionId: GattSessionProfile, address: string) => void): void {
    this.connectionGuard = guard;
  }

  setRnodeBondRecoveryExclusive(active: boolean): void {
    this.rnodeBondRecoveryExclusive = active;
  }

  isRnodeBondRecoveryExclusive(): boolean {
    return this.rnodeBondRecoveryExclusive;
  }

  getConnections(): { mac: string; owner: `gatt:${GattSessionProfile}` }[] {
    return [...this.sessions.values()].map((s) => ({
      mac: s.deviceId,
      owner: `gatt:${s.profile}` as const,
    }));
  }

  setPort(): void {}

  invalidateAfterSidecarExit(): void {}

  private emitIssue(code: string, message: string, sessionId?: GattSessionProfile): void {
    this.emit('issue', { sessionId, code, message });
  }

  async startScan(
    sessionId: GattSessionProfile,
    opts?: { timeoutSecs?: number },
  ): Promise<GattStartScanResult> {
    if (this.scanning && this.scanning !== sessionId) {
      return { ok: false, code: 'scan_busy', owner: `gatt:${this.scanning}` };
    }
    try {
      await this.ensureInit();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.emitIssue('adapter_unavailable', error, sessionId);
      return { ok: false, code: 'adapter_unavailable', error };
    }
    const wire = gattWireProfileFromSession(sessionId);
    const service = wire === 'meshtastic' ? MESHTASTIC_UUIDS.service : NUS_UUIDS.service;
    const timeoutMs = Math.max(1, Math.min(30, Math.round(opts?.timeoutSecs ?? 8))) * 1000;
    this.scanning = sessionId;
    const seen = new Set<string>();
    const off = onNativeEvent(BLE, 'onScanResult', (raw) => {
      const r = raw as {
        device?: { deviceId?: string; name?: string };
        localName?: string;
        rssi?: number;
        uuids?: string[];
      };
      const deviceId = r.device?.deviceId;
      if (!deviceId) return;
      const rssi = typeof r.rssi === 'number' ? r.rssi : null;
      if (rssi != null) this.lastScanRssi.set(deviceId.toLowerCase(), rssi);
      if (seen.has(deviceId)) return;
      seen.add(deviceId);
      const device: GattDiscoveredDevice = {
        deviceId,
        deviceName: r.localName || r.device?.name || deviceId,
        rssi,
        address: deviceId,
      };
      this.emit('deviceDiscovered', device);
    });
    try {
      await callNative(BLE, 'requestLEScan', {
        services: [service],
        allowDuplicates: false,
        scanMode: 2,
      });
      await sleep(timeoutMs);
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const code = /permission|denied|unauthori/i.test(error) ? 'permission_denied' : 'scan_failed';
      this.emitIssue(code, error, sessionId);
      return { ok: false, code, error };
    } finally {
      off();
      this.scanning = null;
      await callNative(BLE, 'stopLEScan', {}).catch(() => {});
    }
  }

  stopScan(sessionId: GattSessionProfile): Promise<void> {
    if (!isGattSessionProfile(sessionId)) {
      return Promise.reject(new Error(`gatt stopScan: invalid session ${String(sessionId)}`));
    }
    if (this.scanning === sessionId) return callNative(BLE, 'stopLEScan', {}).then(() => undefined);
    return Promise.resolve();
  }

  private enqueue<T>(s: Session, op: () => Promise<T>): Promise<T> {
    const next = s.queue.then(op, op);
    s.queue = next.catch(() => undefined);
    return next;
  }

  async connect(sessionId: GattSessionProfile, peripheralId: string): Promise<GattConnectResult> {
    if (this.rnodeBondRecoveryExclusive) {
      return {
        ok: false,
        error: 'RNode bond recovery holds the Bluetooth adapter',
        code: 'rnode_bond_recovery',
      };
    }
    try {
      this.connectionGuard?.(sessionId, peripheralId);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { ok: false, error, code: 'mac_conflict' };
    }
    if (this.sessions.has(sessionId)) await this.disconnect(sessionId);
    const deviceId = peripheralId;
    const wire = gattWireProfileFromSession(sessionId);
    const session: Session = {
      profile: sessionId,
      deviceId,
      seedRssi: this.lastScanRssi.get(deviceId.toLowerCase()) ?? null,
      queue: Promise.resolve(),
      closed: false,
      drainRequested: false,
      drainWake: null,
      rssiTimer: null,
      unsubscribers: [],
      writeWithoutResponse: false,
    };
    try {
      await this.ensureInit();
      session.unsubscribers.push(
        onNativeEvent(BLE, `disconnected|${deviceId}`, () => {
          this.handleRemoteDisconnect(session, 'peripheral_disconnected');
        }),
      );
      await callNative(BLE, 'connect', { deviceId, timeout: CONNECT_TIMEOUT_MS });
      await callNative(BLE, 'requestConnectionPriority', { deviceId, connectionPriority: 1 }).catch(
        () => {},
      );
      await this.negotiateMtu(deviceId);
      const services = await callNative<{
        services: {
          uuid: string;
          characteristics: { uuid: string; properties: Record<string, boolean> }[];
        }[];
      }>(BLE, 'getServices', { deviceId });
      const serviceUuid = wire === 'meshtastic' ? MESHTASTIC_UUIDS.service : NUS_UUIDS.service;
      const svc = services.services.find((x) => x.uuid.toLowerCase() === serviceUuid);
      if (!svc) throw new Error(`peripheral ${deviceId} does not expose the ${wire} GATT service`);
      const writeUuid = wire === 'meshtastic' ? MESHTASTIC_UUIDS.toRadio : NUS_UUIDS.rx;
      const writeChar = svc.characteristics.find((c) => c.uuid.toLowerCase() === writeUuid);
      if (!writeChar) throw new Error(`${wire} write characteristic missing`);
      // Prefer write-with-response when advertised (sidecar parity).
      session.writeWithoutResponse =
        !writeChar.properties.write && writeChar.properties.writeWithoutResponse;

      const notifyUuid = wire === 'meshtastic' ? MESHTASTIC_UUIDS.fromNum : NUS_UUIDS.tx;
      session.unsubscribers.push(
        onNativeEvent(BLE, `notification|${deviceId}|${serviceUuid}|${notifyUuid}`, (ev) => {
          if (session.closed) return;
          if (wire === 'meshtastic') this.requestDrain(session);
          else {
            const bytes = unhex((ev as { value?: string } | null)?.value);
            if (bytes.length > 0) this.emit('fromRadio', { sessionId, bytes });
          }
        }),
      );
      await callNative(BLE, 'startNotifications', {
        deviceId,
        service: serviceUuid,
        characteristic: notifyUuid,
      });
      this.sessions.set(sessionId, session);
      if (wire === 'meshtastic') {
        session.drainRequested = true;
        void this.runReadPump(session);
      }
      this.startRssiPoll(session);
      if (session.seedRssi != null) this.emit('linkRssi', { sessionId, rssi: session.seedRssi });
      this.emit('connected', { sessionId });
      return { ok: true };
    } catch (e) {
      session.closed = true;
      for (const u of session.unsubscribers) u();
      await callNative(BLE, 'disconnect', { deviceId }).catch(() => {});
      const error = e instanceof Error ? e.message : String(e);
      const code = /timed? ?out/i.test(error)
        ? 'connect_timeout'
        : /not found|no device/i.test(error)
          ? 'peripheral_not_found'
          : 'connect_failed';
      this.emit('connect-aborted', { sessionId, message: error });
      return { ok: false, error, code };
    }
  }

  private async negotiateMtu(deviceId: string): Promise<void> {
    // The community plugin requests the maximum MTU on Android connect; read it for logs.
    try {
      const r = await callNative<{ value: number }>(BLE, 'getMtu', { deviceId });
      console.debug(`[gatt-mobile] negotiated MTU ${r.value} (preferred ${PREFERRED_MTU})`);
    } catch (e) {
      console.debug(
        `[gatt-mobile] getMtu unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private requestDrain(s: Session): void {
    s.drainRequested = true;
    const wake = s.drainWake;
    s.drainWake = null;
    wake?.();
  }

  private readFromRadio(s: Session): Promise<Uint8Array> {
    return this.enqueue(s, () =>
      withTimeout(
        callNative<{ value?: string }>(BLE, 'read', {
          deviceId: s.deviceId,
          service: MESHTASTIC_UUIDS.service,
          characteristic: MESHTASTIC_UUIDS.fromRadio,
        }),
        FROM_RADIO_READ_TIMEOUT_MS,
        'fromRadio read',
      ).then((r) => unhex(r.value)),
    );
  }

  /** One drain: read until `maxEmpty` consecutive empty reads. Returns packets + whether it failed. */
  private async drain(s: Session, maxEmpty: number): Promise<{ packets: number; failed: boolean }> {
    let packets = 0;
    let empty = 0;
    for (;;) {
      if (s.closed) return { packets, failed: false };
      let bytes: Uint8Array;
      try {
        bytes = await this.readFromRadio(s);
      } catch (e) {
        console.debug(
          `[gatt-mobile] fromRadio read failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        return { packets, failed: packets === 0 };
      }
      if (bytes.length > 0) {
        empty = 0;
        packets += 1;
        this.emit('fromRadio', { sessionId: s.profile, bytes });
        continue;
      }
      empty += 1;
      if (empty >= Math.max(1, maxEmpty)) return { packets, failed: false };
      await sleep(FROM_RADIO_EMPTY_RETRY_MS);
    }
  }

  private async runReadPump(s: Session): Promise<void> {
    let failures = 0;
    while (!s.closed) {
      let polled = false;
      if (!s.drainRequested) {
        polled = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => {
            s.drainWake = null;
            resolve(true);
          }, FROM_RADIO_POLL_INTERVAL_MS);
          s.drainWake = () => {
            clearTimeout(t);
            resolve(false);
          };
        });
      }
      if (s.closed) return;
      s.drainRequested = false;
      const out = await this.drain(
        s,
        polled ? FROM_RADIO_POLL_EMPTY_STREAK : FROM_RADIO_REQUESTED_EMPTY_STREAK,
      );
      failures = out.failed ? failures + 1 : 0;
      if (failures >= FROM_RADIO_MAX_FAILED_DRAINS) {
        console.warn(
          'mcL9008 [gatt-mobile] meshtastic fromRadio read pump stalled; reporting disconnect',
        );
        this.handleRemoteDisconnect(s, 'read_pump_stalled');
        return;
      }
    }
  }

  private startRssiPoll(s: Session): void {
    s.rssiTimer = setInterval(() => {
      if (s.closed) return;
      void this.getRssi(s.profile).then((rssi) => {
        if (rssi != null && !s.closed) this.emit('linkRssi', { sessionId: s.profile, rssi });
      });
    }, GATT_RSSI_POLL_MS);
  }

  private teardown(s: Session): void {
    s.closed = true;
    if (s.rssiTimer) clearInterval(s.rssiTimer);
    s.rssiTimer = null;
    s.drainWake?.();
    for (const u of s.unsubscribers.splice(0)) u();
    if (this.sessions.get(s.profile) === s) this.sessions.delete(s.profile);
  }

  private handleRemoteDisconnect(s: Session, reason: string): void {
    if (s.closed) return;
    console.debug(`[gatt-mobile] ${s.profile} disconnected: ${reason}`);
    this.teardown(s);
    void callNative(BLE, 'disconnect', { deviceId: s.deviceId }).catch(() => {});
    this.emit('disconnected', { sessionId: s.profile });
  }

  /** Android bonding is handled by the OS pairing dialog on first encrypted access. */
  async pairState(address: string): Promise<GattPairStateResult> {
    try {
      const r = await callNative<{ value: boolean }>(BLE, 'isBonded', { deviceId: address });
      return { ok: true, paired: r.value };
    } catch (e) {
      return { ok: false, code: 'unsupported', error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Android shows the system pairing dialog (PIN entry happens there, not in-app). */
  async pair(address: string): Promise<GattPairResult> {
    try {
      await callNative(BLE, 'createBond', { deviceId: address, timeout: 60_000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, code: 'pair_failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  unpair(): Promise<GattPairResult> {
    return Promise.resolve({
      ok: false,
      code: 'unsupported',
      error: 'Remove the bond in system Bluetooth settings',
    });
  }

  disconnect(sessionId: GattSessionProfile): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return Promise.resolve();
    this.teardown(s);
    this.emit('disconnected', { sessionId });
    return callNative(BLE, 'disconnect', { deviceId: s.deviceId }).then(
      () => undefined,
      () => undefined,
    );
  }

  isConnected(sessionId: GattSessionProfile): Promise<boolean> {
    const s = this.sessions.get(sessionId);
    if (!s || s.closed) return Promise.resolve(false);
    return callNative<{ devices: { deviceId: string }[] }>(BLE, 'getConnectedDevices', {
      services: [],
    }).then(
      (r) => r.devices.some((d) => d.deviceId === s.deviceId),
      () => !s.closed,
    );
  }

  async toRadio(sessionId: GattSessionProfile, bytes: Uint8Array): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s || s.closed) throw new Error(`gatt session ${sessionId} not connected`);
    const wire = gattWireProfileFromSession(sessionId);
    const service = wire === 'meshtastic' ? MESHTASTIC_UUIDS.service : NUS_UUIDS.service;
    const characteristic = wire === 'meshtastic' ? MESHTASTIC_UUIDS.toRadio : NUS_UUIDS.rx;
    try {
      await this.enqueue(s, () =>
        callNative(BLE, s.writeWithoutResponse ? 'writeWithoutResponse' : 'write', {
          deviceId: s.deviceId,
          service,
          characteristic,
          value: hex(bytes),
        }),
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.emitIssue('write_failed', error, sessionId);
      throw new Error(error);
    }
    if (wire === 'meshtastic') this.requestDrain(s);
  }

  async getRssi(sessionId: GattSessionProfile): Promise<number | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    try {
      const r = await this.enqueue(s, () =>
        callNative<{ value: string | number }>(BLE, 'readRssi', { deviceId: s.deviceId }),
      );
      const v = Number(r.value);
      if (Number.isFinite(v)) {
        s.seedRssi = v;
        return v;
      }
    } catch (e) {
      console.debug(`[gatt-mobile] readRssi failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return this.lastScanRssi.get(s.deviceId.toLowerCase()) ?? s.seedRssi;
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((id) => this.disconnect(id)));
  }

  async releaseBleCentral(): Promise<void> {
    this.setRnodeBondRecoveryExclusive(true);
    await this.disconnectAll();
  }

  /** @internal test hook */
  _isQuitting(): boolean {
    return this.quitting;
  }
}

export const gattSidecarProxy = new GattSidecarProxy();
