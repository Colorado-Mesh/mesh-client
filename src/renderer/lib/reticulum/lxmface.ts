/**
 * LXMFace — deterministic identicon SVG for LXMF / Reticulum destination hashes.
 *
 * Vendored algorithm from https://github.com/ratspeak/LXMFace (MIT), adapted from
 * https://github.com/download13/blockies (MIT). Keep output byte-compatible with
 * upstream `js/lxmface.js` so faces match Ratspeak and other LXMFace clients.
 */

import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

/** Normalize to lowercase 32-char hex destination hash, or null if invalid. */
export function normalizeLxmfaceSeed(seed: string | null | undefined): string | null {
  if (typeof seed !== 'string') return null;
  return canonicalizeReticulumDestinationHash(seed);
}

function seedRand(seed: string): () => number {
  const s = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++) {
    s[i % 4] = (s[i % 4] << 5) - s[i % 4] + seed.charCodeAt(i);
  }
  return () => {
    const t = s[0] ^ (s[0] << 11);
    s[0] = s[1];
    s[1] = s[2];
    s[2] = s[3];
    s[3] = (s[3] ^ (s[3] >> 19) ^ t ^ (t >> 8)) >>> 0;
    return s[3] / ((1 << 31) >>> 0);
  };
}

function createColor(rand: () => number): string {
  const h = Math.floor(rand() * 360);
  const s = rand() * 60 + 40;
  const l = (rand() + rand() + rand() + rand()) * 25;
  return `hsl(${h},${s}%,${l}%)`;
}

function createImageData(rand: () => number, gridSize: number): number[][] {
  const halfW = Math.ceil(gridSize / 2);
  const data: number[][] = [];
  for (let y = 0; y < gridSize; y++) {
    const row: number[] = [];
    for (let x = 0; x < halfW; x++) {
      row.push(Math.floor(rand() * 2.3));
    }
    const fullRow = row.slice();
    for (let x = Math.floor(gridSize / 2) - 1; x >= 0; x--) {
      fullRow.push(row[x]);
    }
    data.push(fullRow);
  }
  return data;
}

/**
 * Generate a deterministic identicon SVG for an LXMF/Reticulum address.
 *
 * @param seed - Hash string (typically a lowercase 32-hex LXMF destination)
 * @param size - SVG width/height in pixels
 */
export function lxmface(seed: string, size: number): string {
  const gridSize = 8;
  const rand = seedRand(seed || '');
  const color = createColor(rand);
  const bgcolor = createColor(rand);
  const spotcolor = createColor(rand);
  const grid = createImageData(rand, gridSize);

  let rects = '';
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const val = grid[y][x];
      const fill = val === 0 ? bgcolor : val === 1 ? color : spotcolor;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  }

  const r = gridSize / 2;
  // Per-seed clip id so multiple faces in one document do not collide.
  const clipId = `lxmface-clip-${seed || 'empty'}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}"` +
    ` height="${size}" viewBox="0 0 ${gridSize} ${gridSize}"` +
    ` shape-rendering="crispEdges">` +
    `<defs><clipPath id="${clipId}"><circle cx="${r}" cy="${r}" r="${r}"/></clipPath></defs>` +
    `<g clip-path="url(#${clipId})">${rects}</g></svg>`
  );
}

export default lxmface;
