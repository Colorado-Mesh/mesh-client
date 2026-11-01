// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isMapSourceId, supportsOfflineMapDownload } from './basemapRegistry';
import {
  buildCustomRemoteTileUrl,
  customAttributionToHtml,
  isCustomMapSourceId,
  isPrivateOrLocalAddress,
  sanitizeCustomSourceAttribution,
  sanitizeCustomSourceName,
  sniffRasterTileMime,
  validateXyzTemplate,
} from './customMapSources';

describe('validateXyzTemplate', () => {
  it('accepts a public https template and returns its host', () => {
    const v = validateXyzTemplate('https://Tiles.Example.org/maps/{z}/{x}/{y}.png?key=abc');
    expect(v).toEqual({
      ok: true,
      host: 'tiles.example.org',
      template: 'https://Tiles.Example.org/maps/{z}/{x}/{y}.png?key=abc',
    });
  });

  it('allows row-before-column layouts and placeholders in the query', () => {
    expect(validateXyzTemplate('https://t.example.com/tile/{z}/{y}/{x}').ok).toBe(true);
    expect(validateXyzTemplate('https://t.example.com/t?z={z}&x={x}&y={y}').ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['http://t.example.com/{z}/{x}/{y}.png', 'scheme'],
    ['ftp://t.example.com/{z}/{x}/{y}.png', 'scheme'],
    ['https://t.example.com/{z}/{x}.png', 'placeholders'],
    ['https://t.example.com/{z}/{z}/{x}/{y}.png', 'placeholders'],
    ['https://t.example.com/{s}/{z}/{x}/{y}.png', 'placeholders'],
    ['https://{z}.example.com/{x}/{y}', 'placeholders'],
    ['https://user:pw@t.example.com/{z}/{x}/{y}.png', 'credentials'],
    ['https://t.example.com:8443/{z}/{x}/{y}.png', 'port'],
    ['https://127.0.0.1/{z}/{x}/{y}.png', 'host'],
    ['https://192.168.1.5/{z}/{x}/{y}.png', 'host'],
    ['https://[::1]/{z}/{x}/{y}.png', 'host'],
    ['https://localhost/{z}/{x}/{y}.png', 'host'],
    ['https://printer.local/{z}/{x}/{y}.png', 'host'],
    ['https://nas/{z}/{x}/{y}.png', 'host'],
    ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'osm'],
    ['https://a.tile.OpenStreetMap.org/{z}/{x}/{y}.png', 'osm'],
    ['https://t.example.com/{z}/{x}/{y}.png#frag', 'invalid'],
    ['https://t.example.com/{z}/{x}/{y} .png', 'invalid'],
  ])('rejects %s (%s)', (input, code) => {
    expect(validateXyzTemplate(input)).toEqual({ ok: false, code });
  });

  it('rejects non-strings and oversized input', () => {
    expect(validateXyzTemplate(42)).toEqual({ ok: false, code: 'invalid' });
    expect(validateXyzTemplate(`https://t.example.com/${'a'.repeat(3000)}/{z}/{x}/{y}`)).toEqual({
      ok: false,
      code: 'too_long',
    });
  });

  it('substitutes coordinates without touching the host', () => {
    expect(buildCustomRemoteTileUrl('https://t.example.com/{z}/{y}/{x}.jpg', 5, 6, 7)).toBe(
      'https://t.example.com/5/7/6.jpg',
    );
  });
});

describe('custom source ids and text', () => {
  it('accepts only generated id shapes', () => {
    expect(isCustomMapSourceId('xyz-0123456789ab')).toBe(true);
    expect(isCustomMapSourceId('mbtiles-0123456789ab')).toBe(true);
    for (const bad of [
      'xyz-',
      'xyz-0123456789AB',
      'xyz-0123456789abc',
      'osm',
      '../xyz-0123456789ab',
      'xyz-0123456789ab/..',
    ]) {
      expect(isCustomMapSourceId(bad)).toBe(false);
    }
    expect(isMapSourceId('osm')).toBe(true);
    expect(isMapSourceId('xyz-0123456789ab')).toBe(true);
    expect(isMapSourceId('esri')).toBe(false);
  });

  it('never allows bulk region download for custom sources', () => {
    expect(supportsOfflineMapDownload('xyz-0123456789ab')).toBe(false);
    expect(supportsOfflineMapDownload('mbtiles-0123456789ab')).toBe(false);
    expect(supportsOfflineMapDownload('osm')).toBe(false);
  });

  it('sanitizes labels and escapes attribution for HTML', () => {
    expect(sanitizeCustomSourceName('  My\u0000 map\n ')).toBe('My map');
    expect(sanitizeCustomSourceName('')).toBeNull();
    expect(sanitizeCustomSourceAttribution('x'.repeat(201))).toBeNull();
    expect(sanitizeCustomSourceAttribution('   ')).toBeNull();
    expect(customAttributionToHtml('© <img src=x onerror=alert(1)> "A" & \'B\'')).toBe(
      '© &lt;img src=x onerror=alert(1)&gt; &quot;A&quot; &amp; &#39;B&#39;',
    );
  });
});

describe('isPrivateOrLocalAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
  ])('flags %s', (ip) => {
    expect(isPrivateOrLocalAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateOrLocalAddress(ip)).toBe(false);
  });
});

describe('sniffRasterTileMime', () => {
  it('detects png/jpeg/webp and rejects everything else', () => {
    expect(sniffRasterTileMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(
      'image/png',
    );
    expect(sniffRasterTileMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffRasterTileMime(
        Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
    expect(sniffRasterTileMime(Buffer.from('<html>error</html>'))).toBeNull();
    expect(sniffRasterTileMime(Uint8Array.from([0x1f, 0x8b, 8]))).toBeNull(); // gzip (vector pbf)
  });
});
