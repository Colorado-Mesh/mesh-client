import i18n from '@/renderer/lib/i18n';

/** Map flasher serial errors to user-facing i18n keys. */
export function humanizeFlasherError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message === 'WEB_SERIAL_UNSUPPORTED') {
    return i18n.t('flasher.errors.webSerialUnsupported');
  }
  if (message === 'NOT_RNODE') {
    return i18n.t('flasher.errors.notRnode');
  }
  if (message === 'ESP32_SYNC_FAILED') {
    return i18n.t('flasher.errors.esp32SyncFailed');
  }
  if (
    message === 'Failed to connect with the device' ||
    message === 'Invalid custom reset sequence'
  ) {
    return i18n.t('flasher.errors.esp32SyncFailed');
  }
  if (message === 'FLASH_TRANSFER_TOO_SMALL') {
    return i18n.t('flasher.errors.flashTransferTooSmall');
  }
  if (message === 'FLASHER_SERIAL_PORT_SELECTION_TIMEOUT') {
    return i18n.t('flasher.errors.portSelectionTimedOut');
  }
  if (message === 'FLASHER_SERIAL_PORT_SELECTION_CANCELLED') {
    return i18n.t('flasher.errors.portSelectionCancelled');
  }
  if (message === 'FLASHER_NO_SERIAL_PORTS') {
    return i18n.t('flasher.errors.noSerialPorts');
  }
  if (message.includes('MD5 of file does not match')) {
    return i18n.t('flasher.errors.flashMd5Mismatch');
  }
  if (message.toLowerCase().includes('already open')) {
    return i18n.t('flasher.errors.portInUse');
  }

  return i18n.t('flasher.errors.generic', { message });
}
