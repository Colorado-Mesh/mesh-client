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
  if (message.includes('Failed to execute') && message.includes('requestPort')) {
    return i18n.t('flasher.errors.portSelectionCancelled');
  }
  if (message.toLowerCase().includes('already open')) {
    return i18n.t('flasher.errors.portInUse');
  }

  return i18n.t('flasher.errors.generic', { message });
}
