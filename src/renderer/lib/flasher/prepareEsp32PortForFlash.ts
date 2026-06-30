import { closeSerialPortIfOpen } from '@/renderer/lib/connection';

import { RNode } from './rnode';

const BOOTLOADER_SETTLE_MS = 800;

/** Close any open handle and reset an RNode into ESP32 ROM bootloader when possible. */
export async function prepareEsp32PortForFlash(port: SerialPort): Promise<void> {
  await closeSerialPortIfOpen(port);
  try {
    const rnode = await RNode.fromSerialPort(port);
    if (await rnode.detect()) {
      await rnode.reset();
      await rnode.close();
      await new Promise((resolve) => setTimeout(resolve, BOOTLOADER_SETTLE_MS));
    } else {
      await rnode.close();
    }
  } catch {
    // catch-no-log-ok not an RNode or port busy — esptool will attempt ROM sync
  }
  await closeSerialPortIfOpen(port);
}
