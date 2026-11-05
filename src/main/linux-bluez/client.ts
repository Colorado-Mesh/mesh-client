/**
 * BlueZ D-Bus client for Linux BLE pairing (Flatpak-safe; no bluetoothctl).
 *
 * Talks to host org.bluez over the system bus (Flatpak: --system-talk-name=org.bluez).
 */
import dbus from 'dbus-next';

import { BLUEZ_AGENT_CAPABILITY, BLUEZ_AGENT_PATH, BluezPairingAgent } from './agent';
import { formatBluezError, isBluezAlreadyExistsOrInProgress } from './errors';
import { isMacAddress, macToDeviceSuffix } from './mac';
import { createBluezSystemBus } from './systemBus';

const { Variant } = dbus;

const BLUEZ_SERVICE = 'org.bluez';
const PAIR_TIMEOUT_MS = 45_000;
const SHORT_TIMEOUT_MS = 5_000;
const DISCOVERY_POLL_MS = 250;
const DISCOVERY_WAIT_MS = 15_000;

interface DBusVariant {
  signature?: string;
  value: unknown;
}
type InterfaceProps = Record<string, DBusVariant>;
type ManagedObjects = Record<string, Record<string, InterfaceProps>>;

export type BluezBusFactory = () => dbus.MessageBus;

export interface LinuxBluezClient {
  getDeviceInfoText(mac: string): Promise<string>;
  pairWithPin(mac: string, pin: string | undefined): Promise<void>;
  removeDevice(mac: string): Promise<void>;
  setTrusted(mac: string, trusted: boolean): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connectDevice(mac: string): Promise<void>;
}

type DbusMethod = (...args: unknown[]) => Promise<unknown>;

/** Look up a D-Bus method on a proxy interface and bind it. */
function getMethod(iface: dbus.ClientInterface, name: string): DbusMethod {
  const fn = iface[name];
  if (typeof fn !== 'function') {
    throw new Error(`BlueZ interface missing method ${name}`);
  }
  return fn.bind(iface) as DbusMethod;
}

/** Read a D-Bus property Variant value, or `fallback` when missing. */
function variantValue<T>(prop: DBusVariant | undefined, fallback: T): T {
  if (!prop) return fallback;
  return prop.value as T;
}

/** Reject `promise` if it does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Build a Linux BlueZ client. Optional `busFactory` is for tests; production uses
 * {@link createBluezSystemBus} (path-based system bus only).
 */
export function createLinuxBluezClient(busFactory?: BluezBusFactory): LinuxBluezClient {
  const createBus: BluezBusFactory = busFactory ?? (() => createBluezSystemBus());

  /**
   * Run `fn` on a MessageBus with an `error` listener that rejects in-flight work
   * via {@link formatBluezError}. The listener stays attached after settle so late
   * bus errors are handled (not uncaught) until disconnect.
   */
  async function withBus<T>(fn: (bus: dbus.MessageBus) => Promise<T>): Promise<T> {
    let bus: dbus.MessageBus;
    try {
      bus = createBus();
    } catch (err) {
      throw new Error(formatBluezError(err));
    }

    let rejectInFlight: ((err: Error) => void) | null = null;
    const busFault = new Promise<never>((_resolve, reject) => {
      rejectInFlight = reject;
    });
    const onBusError = (err: unknown): void => {
      const formatted = new Error(formatBluezError(err));
      if (rejectInFlight) {
        rejectInFlight(formatted);
        rejectInFlight = null;
        return;
      }
      // Operation already settled — absorb so the error is not an unhandled event.
      console.debug('[linux-bluez] late bus error:', formatted.message);
    };
    bus.on('error', onBusError);

    try {
      return await Promise.race([fn(bus), busFault]);
    } catch (err) {
      throw new Error(formatBluezError(err));
    } finally {
      rejectInFlight = null;
      try {
        bus.disconnect();
      } catch {
        // catch-no-log-ok — best-effort bus disconnect
      }
    }
  }

  /** Fetch the BlueZ object tree via ObjectManager.GetManagedObjects. */
  async function getManagedObjects(bus: dbus.MessageBus): Promise<ManagedObjects> {
    const root = await bus.getProxyObject(BLUEZ_SERVICE, '/');
    const manager = root.getInterface('org.freedesktop.DBus.ObjectManager');
    return (await getMethod(manager, 'GetManagedObjects')()) as ManagedObjects;
  }

  function listAdapterPaths(objects: ManagedObjects): string[] {
    return Object.keys(objects).filter((path) => Boolean(objects[path]?.['org.bluez.Adapter1']));
  }

  /** Locate a Device1 object path by MAC (path suffix or Address property). */
  function findDevicePath(objects: ManagedObjects, mac: string): string | null {
    const suffix = macToDeviceSuffix(mac);
    const exact = Object.keys(objects).find(
      (path) => path.endsWith(`/${suffix}`) && Boolean(objects[path]?.['org.bluez.Device1']),
    );
    if (exact) return exact;

    const wanted = mac.toLowerCase();
    for (const [path, ifaces] of Object.entries(objects)) {
      const device = ifaces['org.bluez.Device1'];
      if (!device) continue;
      const address = variantValue(device.Address, '').toLowerCase();
      if (address === wanted) return path;
    }
    return null;
  }

  function primaryAdapterPath(objects: ManagedObjects): string {
    const adapters = listAdapterPaths(objects);
    const first = adapters.sort()[0];
    if (!first) {
      throw new Error('No BlueZ adapter found');
    }
    return first;
  }

  async function getProps(bus: dbus.MessageBus, path: string): Promise<dbus.ClientInterface> {
    const obj = await bus.getProxyObject(BLUEZ_SERVICE, path);
    return obj.getInterface('org.freedesktop.DBus.Properties');
  }

  async function getDeviceInterface(
    bus: dbus.MessageBus,
    path: string,
  ): Promise<dbus.ClientInterface> {
    const obj = await bus.getProxyObject(BLUEZ_SERVICE, path);
    return obj.getInterface('org.bluez.Device1');
  }

  async function getAdapterInterface(
    bus: dbus.MessageBus,
    path: string,
  ): Promise<dbus.ClientInterface> {
    const obj = await bus.getProxyObject(BLUEZ_SERVICE, path);
    return obj.getInterface('org.bluez.Adapter1');
  }

  /**
   * Resolve adapter + device paths for `mac`. When `discover` is true and the
   * device is absent, start adapter discovery and poll until found or timeout.
   */
  async function resolveDevicePath(
    bus: dbus.MessageBus,
    mac: string,
    opts?: { discover?: boolean },
  ): Promise<{ devicePath: string; adapterPath: string }> {
    let objects = await getManagedObjects(bus);
    let adapterPath = primaryAdapterPath(objects);
    let devicePath = findDevicePath(objects, mac);
    if (devicePath || !opts?.discover) {
      if (!devicePath) {
        throw new Error(`Device not found: ${mac}`);
      }
      const parent = devicePath.replace(/\/[^/]+$/, '');
      if (objects[parent]?.['org.bluez.Adapter1']) {
        adapterPath = parent;
      }
      return { devicePath, adapterPath };
    }

    const adapter = await getAdapterInterface(bus, adapterPath);
    let discoveryStarted = false;
    try {
      await getMethod(adapter, 'StartDiscovery')();
      discoveryStarted = true;
    } catch (err) {
      // Already discovering is fine.
      if (!isBluezAlreadyExistsOrInProgress(err)) {
        throw err;
      }
    }

    const deadline = Date.now() + DISCOVERY_WAIT_MS;
    try {
      while (Date.now() < deadline) {
        await sleep(DISCOVERY_POLL_MS);
        objects = await getManagedObjects(bus);
        devicePath = findDevicePath(objects, mac);
        if (devicePath) {
          const parent = devicePath.replace(/\/[^/]+$/, '');
          if (objects[parent]?.['org.bluez.Adapter1']) {
            adapterPath = parent;
          }
          return { devicePath, adapterPath };
        }
      }
    } finally {
      if (discoveryStarted) {
        try {
          await getMethod(adapter, 'StopDiscovery')();
        } catch {
          // catch-no-log-ok — best-effort stop discovery
        }
      }
    }
    throw new Error(`Device not found: ${mac}`);
  }

  return {
    /** bluetoothctl-compatible info text including `Paired: yes|no` for the UI. */
    async getDeviceInfoText(mac: string): Promise<string> {
      if (!isMacAddress(mac)) throw new Error('invalid MAC address format');
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const objects = await getManagedObjects(bus);
            const devicePath = findDevicePath(objects, mac);
            if (!devicePath) {
              return `Device ${mac} not available\nPaired: no\nTrusted: no\nConnected: no`;
            }
            const props = objects[devicePath]?.['org.bluez.Device1'] ?? {};
            const name = variantValue(props.Name, variantValue(props.Alias, ''));
            const paired = variantValue(props.Paired, false);
            const trusted = variantValue(props.Trusted, false);
            const connected = variantValue(props.Connected, false);
            const lines = [
              `Device ${mac} (${name || 'unknown'})`,
              `Name: ${name || 'unknown'}`,
              `Paired: ${paired ? 'yes' : 'no'}`,
              `Trusted: ${trusted ? 'yes' : 'no'}`,
              `Connected: ${connected ? 'yes' : 'no'}`,
            ];
            return lines.join('\n');
          })(),
          SHORT_TIMEOUT_MS,
          'bluetooth-get-info',
        ),
      );
    },

    /**
     * Register a KeyboardOnly Agent1, Pair the device, then best-effort Trust.
     * Agent callbacks only accept the target device path.
     */
    async pairWithPin(mac: string, pin: string | undefined): Promise<void> {
      if (!isMacAddress(mac)) throw new Error('invalid MAC address format');
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const { devicePath } = await resolveDevicePath(bus, mac, { discover: true });
            const agent = new BluezPairingAgent(pin, devicePath);
            bus.export(BLUEZ_AGENT_PATH, agent);

            const managerObj = await bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez');
            const agentManager = managerObj.getInterface('org.bluez.AgentManager1');
            const registerAgent = getMethod(agentManager, 'RegisterAgent');
            const unregisterAgent = getMethod(agentManager, 'UnregisterAgent');
            const requestDefaultAgent = getMethod(agentManager, 'RequestDefaultAgent');
            try {
              try {
                await registerAgent(BLUEZ_AGENT_PATH, BLUEZ_AGENT_CAPABILITY);
              } catch (err) {
                if (!isBluezAlreadyExistsOrInProgress(err)) throw err;
                await unregisterAgent(BLUEZ_AGENT_PATH);
                await registerAgent(BLUEZ_AGENT_PATH, BLUEZ_AGENT_CAPABILITY);
              }
              await requestDefaultAgent(BLUEZ_AGENT_PATH);

              const device = await getDeviceInterface(bus, devicePath);
              await getMethod(device, 'Pair')();

              try {
                const props = await getProps(bus, devicePath);
                await getMethod(props, 'Set')(
                  'org.bluez.Device1',
                  'Trusted',
                  new Variant('b', true),
                );
              } catch {
                // catch-no-log-ok — trust is best-effort after successful pair
              }
            } finally {
              try {
                await unregisterAgent(BLUEZ_AGENT_PATH);
              } catch {
                // catch-no-log-ok — agent cleanup
              }
              try {
                bus.unexport(BLUEZ_AGENT_PATH, agent);
              } catch {
                // catch-no-log-ok — agent cleanup
              }
            }
          })(),
          PAIR_TIMEOUT_MS,
          'bluetooth-pair',
        ),
      );
    },

    /** Remove the OS bond via Adapter1.RemoveDevice. */
    async removeDevice(mac: string): Promise<void> {
      if (!isMacAddress(mac)) throw new Error('invalid MAC address format');
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const objects = await getManagedObjects(bus);
            const devicePath = findDevicePath(objects, mac);
            if (!devicePath) {
              throw new Error(`Device not found: ${mac}`);
            }
            const parent = devicePath.replace(/\/[^/]+$/, '');
            const adapterPath = objects[parent]?.['org.bluez.Adapter1']
              ? parent
              : primaryAdapterPath(objects);
            const adapter = await getAdapterInterface(bus, adapterPath);
            await getMethod(adapter, 'RemoveDevice')(devicePath);
          })(),
          SHORT_TIMEOUT_MS,
          'bluetooth-unpair',
        ),
      );
    },

    async setTrusted(mac: string, trusted: boolean): Promise<void> {
      if (!isMacAddress(mac)) throw new Error('invalid MAC address format');
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const objects = await getManagedObjects(bus);
            const devicePath = findDevicePath(objects, mac);
            if (!devicePath) {
              throw new Error(`Device not found: ${mac}`);
            }
            const props = await getProps(bus, devicePath);
            await getMethod(props, 'Set')(
              'org.bluez.Device1',
              'Trusted',
              new Variant('b', trusted),
            );
          })(),
          SHORT_TIMEOUT_MS,
          'bluetooth-untrust',
        ),
      );
    },

    async startDiscovery(): Promise<void> {
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const objects = await getManagedObjects(bus);
            const adapter = await getAdapterInterface(bus, primaryAdapterPath(objects));
            try {
              await getMethod(adapter, 'StartDiscovery')();
            } catch (err) {
              if (isBluezAlreadyExistsOrInProgress(err)) return;
              throw err;
            }
          })(),
          15_000,
          'bluetooth-start-scan',
        ),
      );
    },

    async stopDiscovery(): Promise<void> {
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const objects = await getManagedObjects(bus);
            const adapter = await getAdapterInterface(bus, primaryAdapterPath(objects));
            try {
              await getMethod(adapter, 'StopDiscovery')();
            } catch {
              // catch-no-log-ok — stop discovery failure is not critical
            }
          })(),
          SHORT_TIMEOUT_MS,
          'bluetooth-stop-scan',
        ),
      ).catch(() => {
        // stop-scan must not reject — match prior bluetoothctl handler
      });
    },

    async connectDevice(mac: string): Promise<void> {
      if (!isMacAddress(mac)) throw new Error('invalid MAC address format');
      return withBus(async (bus) =>
        withTimeout(
          (async () => {
            const { devicePath } = await resolveDevicePath(bus, mac, { discover: false });
            const device = await getDeviceInterface(bus, devicePath);
            await getMethod(device, 'Connect')();
          })(),
          SHORT_TIMEOUT_MS,
          'bluetooth-connect',
        ),
      );
    },
  };
}

/** Default singleton used by IPC handlers. */
export const linuxBluezClient: LinuxBluezClient = createLinuxBluezClient();
