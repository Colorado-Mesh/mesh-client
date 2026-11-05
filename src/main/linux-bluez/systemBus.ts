/**
 * System-bus address helpers for BlueZ pairing.
 *
 * `dbus-next` needs `usocket` for `unix:abstract=` addresses. We keep `usocket`
 * build scripts disabled (native optional dep), so mesh-client only supports
 * path-based system buses — the dbus-next default and typical Flatpak
 * `DBUS_SYSTEM_BUS_ADDRESS` (`unix:path=/run/dbus/system_bus_socket`).
 */
import dbus from 'dbus-next';

const DEFAULT_SYSTEM_BUS_ADDRESS = 'unix:path=/var/run/dbus/system_bus_socket';

/** True when a single D-Bus address entry uses an abstract Unix socket. */
export function isAbstractUnixBusAddress(entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed.toLowerCase().startsWith('unix:')) return false;
  return (
    /(?:^|[,;])abstract=/i.test(trimmed.slice('unix:'.length)) || /^unix:abstract=/i.test(trimmed)
  );
}

/**
 * Reject abstract system-bus addresses (unsupported without usocket).
 * Multi-address `DBUS_SYSTEM_BUS_ADDRESS` values (`;`-separated) are checked entry-wise.
 */
export function assertPathBasedSystemBusAddress(address: string): void {
  const entries = address
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (isAbstractUnixBusAddress(entry)) {
      throw new Error(
        'BlueZ D-Bus requires a path-based system bus (unix:path=…); abstract sockets are unsupported',
      );
    }
  }
}

/** Resolve the system bus address the same way dbus-next `systemBus()` does. */
export function resolveSystemBusAddress(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DBUS_SYSTEM_BUS_ADDRESS?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SYSTEM_BUS_ADDRESS;
}

/**
 * Open the system MessageBus after asserting a path-based address.
 * Callers must attach an `error` listener (see `withBus` in client.ts).
 */
export function createBluezSystemBus(): dbus.MessageBus {
  assertPathBasedSystemBusAddress(resolveSystemBusAddress());
  return dbus.systemBus();
}
