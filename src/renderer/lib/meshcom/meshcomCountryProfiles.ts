/**
 * MeshCom `--setctry` / Country Setting profiles (worldwide ham LoRa bands).
 * Codes and names from firmware `strCountry[]` / `country_profile.cpp`.
 * Frequencies are UI display MHz (ESP32 stored unit); MAN has no fixed freq.
 */

export interface MeshcomCountryProfile {
  /** Firmware country id (`--setctry 0-99`). */
  id: number;
  /** Firmware short code (`EU`, `UK8`, `915`, …). */
  code: string;
  /** Primary LoRa frequency in MHz, or null when manual / none. */
  frequencyMhz: number | null;
}

/** Ordered list including `none` sentinel (id 16). */
export const MESHCOM_COUNTRY_PROFILES: readonly MeshcomCountryProfile[] = [
  { id: 0, code: 'EU', frequencyMhz: 433.175 },
  { id: 1, code: 'UK', frequencyMhz: 439.9125 },
  { id: 2, code: 'ON', frequencyMhz: 433.175 },
  { id: 3, code: 'EA', frequencyMhz: 433.175 },
  { id: 4, code: 'LA', frequencyMhz: 433.925 },
  { id: 5, code: '868', frequencyMhz: 869.525 },
  { id: 6, code: '915', frequencyMhz: 906.875 },
  { id: 7, code: 'MAN', frequencyMhz: null },
  { id: 8, code: 'EU8', frequencyMhz: 433.175 },
  { id: 9, code: 'UK8', frequencyMhz: 439.9125 },
  { id: 10, code: 'US', frequencyMhz: 433.175 },
  { id: 11, code: 'VR2', frequencyMhz: 435.775 },
  { id: 12, code: '435', frequencyMhz: 435.75 },
  { id: 13, code: '436', frequencyMhz: 436.25 },
  { id: 14, code: '442', frequencyMhz: 442.0 },
  { id: 15, code: 'PL', frequencyMhz: 433.175 },
  { id: 16, code: 'none', frequencyMhz: null },
];

const BY_ID = new Map(MESHCOM_COUNTRY_PROFILES.map((p) => [p.id, p]));
const BY_CODE = new Map(MESHCOM_COUNTRY_PROFILES.map((p) => [p.code.toUpperCase(), p]));

export function getMeshcomCountryById(id: number): MeshcomCountryProfile | undefined {
  return BY_ID.get(id);
}

export function getMeshcomCountryByCode(code: string): MeshcomCountryProfile | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/** Format frequency for Radio UI (e.g. `433.175 MHz`), or empty when unknown/manual. */
export function formatMeshcomCountryFrequency(profile: MeshcomCountryProfile): string {
  if (profile.frequencyMhz == null) return '';
  const mhz = profile.frequencyMhz;
  const text = Number.isInteger(mhz)
    ? String(mhz)
    : mhz.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} MHz`;
}
