import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import L from 'leaflet';
import { describe, expect, it } from 'vitest';

import { MAP_BASEMAPS } from '@/renderer/lib/mapBasemapUtils';

const styles = readFileSync(join(__dirname, '../../styles.css'), 'utf8');

describe('dark basemap styles', () => {
  it('darkens the actual Leaflet tile descendants rather than the layer container', () => {
    const container = document.createElement('div');
    document.body.append(container);
    Object.defineProperty(container, 'clientWidth', { value: 256 });
    Object.defineProperty(container, 'clientHeight', { value: 256 });
    const stylesheet = document.createElement('style');
    stylesheet.textContent = /\.mesh-basemap-dark[^{}]*\{[^}]*\}/.exec(styles)?.[0] ?? '';
    document.head.append(stylesheet);
    const map = L.map(container).setView([39, -105], 6);
    try {
      const layer = L.tileLayer(MAP_BASEMAPS.dark.url, {
        className: MAP_BASEMAPS.dark.tileClassName,
      }).addTo(map);
      const tile = layer.getContainer()?.querySelector('.leaflet-tile');
      if (!tile) throw new Error('Leaflet did not render a tile');
      expect(getComputedStyle(tile).filter).toContain('grayscale(1) invert(1)');
      expect(getComputedStyle(container).filter).not.toContain('invert');
    } finally {
      map.remove();
      container.remove();
      stylesheet.remove();
    }
  });
});
