import { encode, type Severity } from './mecp/mecpMessages';

export interface QuickStatusPreset {
  id: string;
  /** i18n key for the button label; the wire text stays English for interop. */
  labelKey: string;
  text: string;
  mecpCodes?: string[];
}

export const QUICK_STATUS_OK_TEXT = 'OK';

export const DEFAULT_QUICK_STATUS_PRESETS: QuickStatusPreset[] = [
  { id: 'ok', labelKey: 'quickStatus.ok', text: QUICK_STATUS_OK_TEXT, mecpCodes: ['L15'] },
  { id: 'needHelp', labelKey: 'quickStatus.needHelp', text: 'Need help', mecpCodes: ['C01'] },
  {
    id: 'inPosition',
    labelKey: 'quickStatus.inPosition',
    text: 'In position',
    mecpCodes: ['P05'],
  },
  { id: 'lostComms', labelKey: 'quickStatus.lostComms', text: 'Lost comms' },
  { id: 'returning', labelKey: 'quickStatus.returning', text: 'Returning', mecpCodes: ['L14'] },
];

export interface QuickStatusFormatOptions {
  lat?: number;
  lon?: number;
  asMecp?: boolean;
  severity?: Severity;
}

const COORD_DECIMALS = 5;

function formatCoords(lat: number | undefined, lon: number | undefined): string | null {
  if (lat === undefined || lon === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return `${lat.toFixed(COORD_DECIMALS)},${lon.toFixed(COORD_DECIMALS)}`;
}

/**
 * Build the wire text for a quick-status preset. MECP output is only produced when the preset
 * carries codes; otherwise plain text is returned so presets without a code mapping still send.
 */
export function formatQuickStatusPayload(
  preset: QuickStatusPreset,
  opts: QuickStatusFormatOptions = {},
): string {
  const coords = formatCoords(opts.lat, opts.lon);
  const codes = preset.mecpCodes ?? [];
  if (opts.asMecp && codes.length > 0) {
    const freetext = coords ? `${preset.text} ${coords}` : preset.text;
    return encode(opts.severity ?? 3, codes, freetext).message;
  }
  return coords ? `${preset.text} ${coords}` : preset.text;
}
