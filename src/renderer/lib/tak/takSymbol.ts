export type TakAffiliation = 'friend' | 'hostile' | 'neutral' | 'unknown' | 'point';

/** Battle dimension from the third CoT atom segment; `other` covers SOF and unset dimensions. */
export type TakDimension = 'air' | 'ground' | 'sea' | 'subsurface' | 'space' | 'other';

/** Function glyphs drawn inside the frame; matches the relayed types the client emits and ATAK's common picks. */
export type TakFunctionGlyph =
  'infantry' | 'recon' | 'medical' | 'armor' | 'vehicle' | 'installation' | 'sensor' | 'none';

export interface TakSymbol {
  affiliation: TakAffiliation;
  dimension: TakDimension;
  glyph: TakFunctionGlyph;
}

/** MIL-STD-2525 affiliation colors as ATAK draws them; map points use a distinct violet. */
export const TAK_AFFILIATION_COLORS: Record<TakAffiliation, string> = {
  friend: '#38bdf8',
  hostile: '#ef4444',
  neutral: '#22c55e',
  unknown: '#facc15',
  point: '#a78bfa',
};

/** Glyph and outline ink; divIcon HTML cannot read the theme's CSS custom properties. */
const GLYPH_INK = '#0b0f14';

/** CoT atoms are `a-<affiliation>-…`; assumed friend, suspect, joker and faker fold into two. */
export function takAffiliation(type: string): TakAffiliation {
  if (!type.startsWith('a-')) return 'point';
  switch (type.charAt(2)) {
    case 'f':
    case 'a':
      return 'friend';
    case 'h':
    case 's':
    case 'j':
    case 'k':
      return 'hostile';
    case 'n':
      return 'neutral';
    default:
      return 'unknown';
  }
}

const DIMENSIONS: Record<string, TakDimension> = {
  A: 'air',
  G: 'ground',
  S: 'sea',
  U: 'subsurface',
  P: 'space',
};

/** Longest function prefix wins, so `G-U-C-I` beats `G-U-C`. */
const GLYPH_PREFIXES: [string, TakFunctionGlyph][] = [
  ['G-U-C-I', 'infantry'],
  ['G-U-C-R', 'recon'],
  ['G-U-C-A', 'armor'],
  ['G-U-S-M', 'medical'],
  ['G-E-V', 'vehicle'],
  ['G-E-S', 'sensor'],
  ['G-I', 'installation'],
];

/** Parse a CoT atom (`a-f-G-U-C-I`) into what the map draws. */
export function parseTakSymbol(type: string): TakSymbol {
  const affiliation = takAffiliation(type);
  if (affiliation === 'point') return { affiliation, dimension: 'other', glyph: 'none' };
  const rest = type.split('-').slice(2);
  const dimension = DIMENSIONS[rest[0] ?? ''] ?? 'other';
  const path = rest.join('-');
  const match = GLYPH_PREFIXES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}-`));
  return { affiliation, dimension, glyph: match?.[1] ?? 'none' };
}

/** Frame outline in a 32×32 box: affiliation picks the shape, air and subsurface open one side. */
function framePath(affiliation: Exclude<TakAffiliation, 'point'>, dimension: TakDimension): string {
  const air = dimension === 'air' || dimension === 'space';
  const sub = dimension === 'subsurface';
  switch (affiliation) {
    case 'friend':
      if (air) return 'M4 26 V16 A12 12 0 0 1 28 16 V26';
      if (sub) return 'M4 6 V16 A12 12 0 0 0 28 16 V6';
      if (dimension === 'sea') return 'M16 4 A12 12 0 1 1 15.99 4 Z';
      return 'M3 8 H29 V24 H3 Z';
    case 'hostile':
      if (air) return 'M4 26 V16 L16 3 L28 16 V26';
      if (sub) return 'M4 6 V16 L16 29 L28 16 V6';
      return 'M16 2 L30 16 L16 30 L2 16 Z';
    case 'neutral':
      if (air) return 'M4 28 V4 H28 V28';
      if (sub) return 'M4 4 V28 H28 V4';
      return 'M4 4 H28 V28 H4 Z';
    case 'unknown':
      if (air) return 'M4 26 V16 A6 6 0 0 1 10 8 A6 6 0 0 1 22 8 A6 6 0 0 1 28 16 V26';
      if (sub) return 'M4 6 V16 A6 6 0 0 0 10 24 A6 6 0 0 0 22 24 A6 6 0 0 0 28 16 V6';
      return 'M10 8 A6 6 0 0 1 22 8 A6 6 0 0 1 24 22 A6 6 0 0 1 8 24 A6 6 0 0 1 10 8 Z';
  }
}

const GLYPH_MARKUP: Record<TakFunctionGlyph, string> = {
  infantry: `<path d="M8 11 L24 21 M24 11 L8 21" />`,
  recon: `<path d="M8 21 L24 11" />`,
  medical: `<path d="M16 10 V22 M10 16 H22" />`,
  armor: `<ellipse cx="16" cy="16" rx="8" ry="4" />`,
  vehicle: `<path d="M9 18 H23" /><circle cx="11" cy="21" r="1.5" /><circle cx="21" cy="21" r="1.5" />`,
  installation: `<path d="M12 7 H20" stroke-width="3" /><path d="M11 20 V14 L16 11 L21 14 V20 Z" />`,
  sensor: `<path d="M16 21 V14 M12 13 A5 5 0 0 1 20 13 M10 11 A8 8 0 0 1 22 11" />`,
  none: '',
};

/**
 * Self-drawn MIL-STD-2525-style marker SVG. Built only from the fixed shapes and colors above,
 * never from contact text, so it is safe as divIcon HTML.
 */
export function takSymbolSvg(symbol: TakSymbol): string {
  if (symbol.affiliation === 'point') {
    const c = TAK_AFFILIATION_COLORS.point;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><circle cx="16" cy="16" r="10" fill="${c}" fill-opacity="0.55" stroke="${c}" stroke-width="3" stroke-dasharray="4 4"/></svg>`;
  }
  const color = TAK_AFFILIATION_COLORS[symbol.affiliation];
  const frame = framePath(symbol.affiliation, symbol.dimension);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">` +
    `<path d="${frame}" fill="${color}" fill-opacity="0.85" stroke="${GLYPH_INK}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<g fill="none" stroke="${GLYPH_INK}" stroke-width="2" stroke-linecap="round">${GLYPH_MARKUP[symbol.glyph]}</g>` +
    `</svg>`
  );
}

/** Stable key so identical symbols share one Leaflet icon. */
export function takSymbolKey(symbol: TakSymbol): string {
  return `${symbol.affiliation}:${symbol.dimension}:${symbol.glyph}`;
}
