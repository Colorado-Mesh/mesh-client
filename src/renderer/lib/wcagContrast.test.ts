import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './wcagContrast';

describe('wcagContrast', () => {
  describe('relativeLuminance', () => {
    it('calculates correct luminance for pure black and white', () => {
      expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
      expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
      expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    });

    it('throws error for invalid hex color strings', () => {
      expect(() => relativeLuminance('#fff')).toThrow('expected #rrggbb hex');
      expect(() => relativeLuminance('123456')).toThrow('expected #rrggbb hex');
      expect(() => relativeLuminance('#zzzzzz')).toThrow('expected #rrggbb hex');
    });
  });

  describe('contrastRatio', () => {
    it('calculates maximum contrast 21:1 between pure black and white', () => {
      const ratio = contrastRatio('#ffffff', '#000000');
      expect(ratio).toBeCloseTo(21, 2);
    });

    it('calculates 1:1 contrast for identical colors', () => {
      expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 4);
      expect(contrastRatio('#abcdef', '#abcdef')).toBeCloseTo(1, 4);
    });

    it('is symmetric regardless of foreground vs background order', () => {
      const fgFirst = contrastRatio('#234567', '#fedcba');
      const bgFirst = contrastRatio('#fedcba', '#234567');
      expect(fgFirst).toBeCloseTo(bgFirst, 6);
    });
  });
});
