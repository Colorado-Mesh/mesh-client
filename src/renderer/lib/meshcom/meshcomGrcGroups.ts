/**
 * MeshCom GRC (group call) registry from ICSSW.
 * Source: https://icssw.org/en/meshcom-grc-gruppen/ (reviewed 2026-11-21).
 *
 * Firmware accepts any numeric id 1–99999; this catalog names well-known groups.
 * Range rows (e.g. OE1–OE9) are metadata only — not expanded into synthetic pills.
 */

import { isMeshcomGroupDest } from './meshcomChannel';

/** Firmware listen filter holds at most six GRC ids; first entry is the master group. */
export const MESHCOM_GRC_MAX_SLOTS = 6;

export interface MeshcomGrcGroup {
  /** Numeric GRC id (1–99999). */
  id: number;
  /** Short prefix from ICSSW (EU, LOC, DL, …). */
  prefix: string;
  /** i18n key under `meshcom.grc.notes.*` for the region/note. */
  noteKey: string;
  /** i18n key under `meshcom.grc.reach.*` when reach is documented; omit when empty. */
  reachKey?: string;
}

export interface MeshcomGrcRangeMeta {
  /** Inclusive start of the documented range. */
  from: number;
  /** Inclusive end of the documented range. */
  to: number;
  prefix: string;
  noteKey: string;
  reachKey?: string;
}

/** Named single-id groups from the ICSSW GRC table (ranges listed separately). */
export const MESHCOM_GRC_GROUPS: readonly MeshcomGrcGroup[] = [
  { id: 2, prefix: 'EU', noteKey: 'eu', reachKey: 'europeWide' },
  { id: 3, prefix: 'US', noteKey: 'us', reachKey: 'usWide' },
  { id: 9, prefix: 'LOC', noteKey: 'loc', reachKey: 'hfCloudOnly' },
  { id: 10, prefix: 'WW-GE', noteKey: 'wwGe', reachKey: 'germanLanguage' },
  { id: 11, prefix: 'WW-FR', noteKey: 'wwFr', reachKey: 'frenchLanguage' },
  { id: 13, prefix: 'WW-EN', noteKey: 'wwEn', reachKey: 'englishLanguage' },
  { id: 14, prefix: 'WW-SP', noteKey: 'wwSp', reachKey: 'spanishLanguage' },
  { id: 16, prefix: 'WW-IT', noteKey: 'wwIt', reachKey: 'italianLanguage' },
  { id: 20, prefix: 'DACH', noteKey: 'dach', reachKey: 'dach' },
  { id: 30, prefix: 'SV', noteKey: 'sv' },
  { id: 204, prefix: 'PA', noteKey: 'pa' },
  { id: 206, prefix: 'ON', noteKey: 'on' },
  { id: 208, prefix: 'F', noteKey: 'f' },
  { id: 214, prefix: 'EA', noteKey: 'ea' },
  { id: 222, prefix: 'I', noteKey: 'i' },
  { id: 226, prefix: 'YO', noteKey: 'yo' },
  { id: 228, prefix: 'HB', noteKey: 'hb' },
  { id: 232, prefix: 'OE', noteKey: 'oe' },
  { id: 234, prefix: 'G', noteKey: 'g' },
  { id: 238, prefix: 'OZ', noteKey: 'oz' },
  { id: 240, prefix: 'SA', noteKey: 'sa' },
  { id: 260, prefix: 'SP', noteKey: 'sp' },
  { id: 262, prefix: 'DL', noteKey: 'dl' },
  { id: 292, prefix: 'T7', noteKey: 't7' },
  { id: 293, prefix: 'S5', noteKey: 's5' },
  { id: 460, prefix: 'B', noteKey: 'b' },
  { id: 901, prefix: '9V', noteKey: 'nineV' },
  { id: 19000, prefix: 'F', noteKey: 'f19000' },
  { id: 20899, prefix: 'F 99', noteKey: 'f99' },
  { id: 22201, prefix: 'I', noteKey: 'i22201' },
  { id: 22202, prefix: 'I', noteKey: 'i22202' },
  { id: 22203, prefix: 'I', noteKey: 'i22203' },
  { id: 22211, prefix: 'I', noteKey: 'i22211' },
  { id: 22213, prefix: 'I', noteKey: 'i22213' },
  { id: 22221, prefix: 'I', noteKey: 'i22221' },
  { id: 22231, prefix: 'I', noteKey: 'i22231' },
  { id: 22232, prefix: 'I', noteKey: 'i22232' },
  { id: 22233, prefix: 'I', noteKey: 'i22233' },
  { id: 22241, prefix: 'I', noteKey: 'i22241' },
  { id: 22251, prefix: 'I', noteKey: 'i22251' },
  { id: 22261, prefix: 'I', noteKey: 'i22261' },
  { id: 22262, prefix: 'I', noteKey: 'i22262' },
  { id: 22271, prefix: 'I', noteKey: 'i22271' },
  { id: 22281, prefix: 'I', noteKey: 'i22281' },
  { id: 22282, prefix: 'I', noteKey: 'i22282' },
  { id: 22283, prefix: 'I', noteKey: 'i22283' },
  { id: 22284, prefix: 'I', noteKey: 'i22284' },
  { id: 22291, prefix: 'I', noteKey: 'i22291' },
  { id: 22299, prefix: 'I', noteKey: 'i22299' },
  { id: 2622, prefix: 'DL 2', noteKey: 'dl2622' },
  { id: 26206, prefix: 'DL 06', noteKey: 'dl26206' },
  { id: 26207, prefix: 'DL 07', noteKey: 'dl26207' },
  { id: 26216, prefix: 'DL 16', noteKey: 'dl26216' },
  { id: 26220, prefix: 'DL 20', noteKey: 'dl26220' },
  { id: 26221, prefix: 'DL 21', noteKey: 'dl26221' },
  { id: 26225, prefix: 'DL 25', noteKey: 'dl26225' },
  { id: 26229, prefix: 'DL 29', noteKey: 'dl26229' },
  { id: 26235, prefix: 'DL 35', noteKey: 'dl26235' },
  { id: 26242, prefix: 'DL 42', noteKey: 'dl26242' },
  { id: 26244, prefix: 'DL 44', noteKey: 'dl26244' },
  { id: 26251, prefix: 'DL 51', noteKey: 'dl26251', reachKey: 'dl26251' },
  { id: 26255, prefix: 'DL 55', noteKey: 'dl26255' },
  { id: 26266, prefix: 'DL 66', noteKey: 'dl26266' },
  { id: 26269, prefix: 'DL 69', noteKey: 'dl26269' },
  { id: 26289, prefix: 'DL 89', noteKey: 'dl26289' },
  { id: 26295, prefix: 'DL 95', noteKey: 'dl26295' },
  { id: 26298, prefix: 'DL 98', noteKey: 'dl26298' },
  { id: 26299, prefix: 'DL 99', noteKey: 'dl26299' },
  { id: 26379, prefix: 'DL3 79', noteKey: 'dl26379' },
  { id: 60000, prefix: 'FR 60', noteKey: 'fr60000' },
  { id: 82267, prefix: 'AFUCAMP', noteKey: 'afucamp' },
  { id: 99099, prefix: 'DL 99', noteKey: 'dl99099' },
];

/** Documented ranges (not expanded into individual chat pills). */
export const MESHCOM_GRC_RANGES: readonly MeshcomGrcRangeMeta[] = [
  { from: 2321, to: 2329, prefix: 'OE1-OE9', noteKey: 'oeStates' },
  {
    from: 26200,
    to: 26299,
    prefix: 'DL00-DL99',
    noteKey: 'dlRegional',
    reachKey: 'germanLanguage',
  },
];

const BY_ID = new Map(MESHCOM_GRC_GROUPS.map((g) => [g.id, g]));

export function getMeshcomGrcGroup(id: number): MeshcomGrcGroup | undefined {
  return BY_ID.get(id);
}

/** Parse semicolon-separated `--setgrc` / snapshot value into unique ids (max 6). */
export function parseMeshcomGrcListenList(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(/[;,]/)) {
    const token = part.trim();
    if (!token || !isMeshcomGroupDest(token)) continue;
    const id = Number.parseInt(token, 10);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MESHCOM_GRC_MAX_SLOTS) break;
  }
  return out;
}

/** Build `--setgrc` argument (semicolon-joined) or empty string to clear. */
export function formatMeshcomGrcListenList(ids: readonly number[]): string {
  const cleaned: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1 || id > 99999) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
    if (cleaned.length >= MESHCOM_GRC_MAX_SLOTS) break;
  }
  return cleaned.join(';');
}

/**
 * Chat pill label: prefer `PREFIX (id)` from registry, else caller-supplied fallback.
 * `tNote` / `tReach` are unused here — callers use prefix + id for the strip.
 */
export function meshcomGrcChannelLabel(id: number, fallback: (id: number) => string): string {
  const known = BY_ID.get(id);
  if (!known) return fallback(id);
  return `${known.prefix} (${id})`;
}

export interface MeshcomChatChannelPill {
  index: number;
  name: string;
}

/**
 * Merge ALL (*) + listen groups + locally opened + history-discovered GRC ids.
 * Order: ALL, then listen (device order), then remaining local/history ascending.
 */
export function buildMeshcomChatChannels(opts: {
  listenGroupIds: readonly number[];
  localGroupIds?: readonly number[];
  historyGroupIds: readonly number[];
  labelAll: string;
  labelGroup: (id: number) => string;
}): MeshcomChatChannelPill[] {
  const pills: MeshcomChatChannelPill[] = [{ index: 0, name: opts.labelAll }];
  const seen = new Set<number>([0]);
  const push = (id: number): void => {
    if (!Number.isInteger(id) || id <= 0 || id > 99999 || seen.has(id)) return;
    seen.add(id);
    pills.push({ index: id, name: meshcomGrcChannelLabel(id, opts.labelGroup) });
  };
  for (const id of opts.listenGroupIds) push(id);
  for (const id of opts.localGroupIds ?? []) push(id);
  const historySorted = [...opts.historyGroupIds]
    .filter((id) => Number.isInteger(id) && id > 0 && id <= 99999 && !seen.has(id))
    .sort((a, b) => a - b);
  for (const id of historySorted) push(id);
  return pills;
}

/** Case-insensitive registry search by id, prefix, or note key token. */
export function searchMeshcomGrcGroups(query: string): MeshcomGrcGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...MESHCOM_GRC_GROUPS];
  return MESHCOM_GRC_GROUPS.filter((g) => {
    if (String(g.id).includes(q)) return true;
    if (g.prefix.toLowerCase().includes(q)) return true;
    if (g.noteKey.toLowerCase().includes(q)) return true;
    return false;
  });
}
