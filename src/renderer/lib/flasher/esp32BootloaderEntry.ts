import { customReset, Transport } from 'esptool-js';

import { closeSerialPortIfOpen } from '@/renderer/lib/connection';

/** Same sequence esptool-js uses in ESPLoader._connectAttempt. */
const ESP32_DOWNLOAD_RESET = 'D0|R1|W100|D1|R0|W50|D0';
/** Longer post-reset wait for boards stuck in a bad application boot loop. */
const ESP32_DOWNLOAD_RESET_SLOW = 'D0|R1|W100|W2000|D1|R0|W50|D0';

/**
 * Open the port and toggle DTR/RTS so the ESP32 enters ROM download mode.
 * Used when RNode firmware is missing or corrupt and esptool sync alone fails.
 */
export async function forceEsp32DownloadMode(
  serialPort: SerialPort,
  slowReset = false,
): Promise<void> {
  await closeSerialPortIfOpen(serialPort);
  const transport = new Transport(serialPort, true);
  try {
    await transport.connect(115200);
    await customReset(transport, slowReset ? ESP32_DOWNLOAD_RESET_SLOW : ESP32_DOWNLOAD_RESET);
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // catch-no-log-ok port may already be closed
    }
    await closeSerialPortIfOpen(serialPort);
  }
}
