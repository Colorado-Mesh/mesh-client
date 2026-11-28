/**
 * `dbus-next` stand-in: BlueZ over D-Bus does not exist on mobile. Class declarations
 * (`interface.Interface` subclasses with `configureMembers`) load normally; any bus call fails.
 */
function unavailable(): never {
  throw new Error('D-Bus (BlueZ) is not available on mobile');
}
export const systemBus = unavailable;
export const sessionBus = unavailable;
export class Variant {
  constructor(
    public signature?: string,
    public value?: unknown,
  ) {}
}
export class Message {
  type = 0;
}
export class DBusError extends Error {
  constructor(
    public type: string,
    public text: string,
  ) {
    super(text);
  }
}
class Interface {
  constructor(public name?: string) {}
  static configureMembers(): void {}
}
export const interface_ = {
  Interface,
  ACCESS_READ: 'read',
  ACCESS_WRITE: 'write',
  ACCESS_READWRITE: 'readwrite',
  method: () => () => {},
  property: () => () => {},
  signal: () => () => {},
};
export default { systemBus, sessionBus, Variant, Message, DBusError, interface: interface_ };
