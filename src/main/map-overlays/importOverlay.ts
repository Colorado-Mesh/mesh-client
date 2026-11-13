import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  kmlDocumentName,
  mapOverlayDisplayName,
  mapOverlayFormatFromName,
  MapOverlayParseError,
  parseMapOverlayText,
} from '@/shared/mapOverlays/parseMapOverlay';
import type { MapOverlayImportResult } from '@/shared/mapOverlays/types';
import { MAP_OVERLAY_MAX_BYTES } from '@/shared/mapOverlays/types';

import { sanitizeLogMessage } from '../sanitize-log-message';
import { extractKmlTextFromKmz, KmzExtractError } from './kmzExtract';

/**
 * Read a local overlay file, enforce the size cap, parse GeoJSON/KML (KMZ via temp extract),
 * and return a FeatureCollection ready for the renderer store.
 */
export async function importMapOverlayFromPath(filePath: string): Promise<MapOverlayImportResult> {
  const base = path.basename(filePath);
  const format = mapOverlayFormatFromName(base);
  if (!format) return { ok: false, code: 'unsupported' };

  // Open once and fstat+read from the same handle to avoid TOCTOU between stat and read.
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
  } catch (e: unknown) {
    console.warn(
      '[map-overlays] open failed ' +
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return { ok: false, code: 'io' };
  }

  try {
    const stat = await fh.stat();
    if (!stat.isFile()) return { ok: false, code: 'malformed' };
    if (stat.size > MAP_OVERLAY_MAX_BYTES) return { ok: false, code: 'too_large' };

    const fallbackName = mapOverlayDisplayName(base);
    if (format === 'kmz') {
      const bytes = await fh.readFile();
      if (bytes.byteLength > MAP_OVERLAY_MAX_BYTES) return { ok: false, code: 'too_large' };
      const kmlText = await extractKmlTextFromKmz(bytes);
      const geojson = parseMapOverlayText(kmlText, 'kml');
      return {
        ok: true,
        name: kmlDocumentName(kmlText, fallbackName),
        format: 'kmz',
        geojson,
      };
    }

    const text = await fh.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') > MAP_OVERLAY_MAX_BYTES) {
      return { ok: false, code: 'too_large' };
    }
    if (format === 'kml') {
      const geojson = parseMapOverlayText(text, 'kml');
      return {
        ok: true,
        name: kmlDocumentName(text, fallbackName),
        format: 'kml',
        geojson,
      };
    }
    const geojson = parseMapOverlayText(text, 'geojson');
    return { ok: true, name: fallbackName, format: 'geojson', geojson };
  } catch (e: unknown) {
    if (e instanceof MapOverlayParseError || e instanceof KmzExtractError) {
      return { ok: false, code: e.code };
    }
    console.warn(
      '[map-overlays] import failed ' +
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    return { ok: false, code: 'io' };
  } finally {
    await fh.close().catch(() => {
      // catch-no-log-ok close after successful/failed import
    });
  }
}
