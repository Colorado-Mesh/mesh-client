export type ReticulumTopologyInterfaceGlyph = 'wifi' | 'lora' | 'tcp' | 'serial';

export function normalizeReticulumInterfaceGlyphType(
  type: string | null | undefined,
): ReticulumTopologyInterfaceGlyph {
  const normalized = (type ?? '').trim().toLowerCase();
  if (normalized.includes('wifi') || normalized.includes('wlan')) return 'wifi';
  if (
    normalized.includes('lora') ||
    normalized.includes('rnode') ||
    normalized.includes('kiss') ||
    normalized.includes('radio')
  ) {
    return 'lora';
  }
  if (
    normalized.includes('serial') ||
    normalized.includes('pipe') ||
    normalized.includes('usb') ||
    normalized.includes('com')
  ) {
    return 'serial';
  }
  if (
    normalized.includes('tcp') ||
    normalized.includes('udp') ||
    normalized.includes('i2p') ||
    normalized.includes('network')
  ) {
    return 'tcp';
  }
  return 'tcp';
}
