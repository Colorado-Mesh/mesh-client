import { closeSerialPortIfOpen } from '@/renderer/lib/connection';

import { RNode } from './rnode';

export function assertWebSerialAvailable(): void {
  if (!navigator.serial?.requestPort) {
    throw new Error('WEB_SERIAL_UNSUPPORTED');
  }
}

export async function requestFlasherSerialPort(): Promise<SerialPort> {
  assertWebSerialAvailable();
  return navigator.serial!.requestPort({ filters: [] });
}

export async function connectRNode(port: SerialPort): Promise<RNode> {
  await closeSerialPortIfOpen(port);
  const rnode = await RNode.fromSerialPort(port);
  const isRNode = await rnode.detect();
  if (!isRNode) {
    await rnode.close();
    throw new Error('NOT_RNODE');
  }
  return rnode;
}

export async function safeCloseSerialPort(port: SerialPort | null | undefined): Promise<void> {
  if (!port) return;
  try {
    await closeSerialPortIfOpen(port);
  } catch {
    // catch-no-log-ok: port may already be closed after flash
  }
}
