import { describe, expect, it } from 'vitest';

import {
  hasCustomReticulumProfileIcon,
  isDefaultReticulumProfileIcon,
  mapRgbToReticulumIconColor,
  parseReticulumIconAppearanceWire,
  resolveReticulumProfileIconName,
} from './reticulumIconAppearance';

describe('reticulumIconAppearance', () => {
  it('detects default profile icon', () => {
    expect(isDefaultReticulumProfileIcon(null, null)).toBe(true);
    expect(isDefaultReticulumProfileIcon('circle', 'green')).toBe(true);
    expect(hasCustomReticulumProfileIcon('star', 'green')).toBe(true);
    expect(hasCustomReticulumProfileIcon('circle', 'amber')).toBe(true);
  });

  it('maps foreground rgb to palette color', () => {
    expect(mapRgbToReticulumIconColor([255, 255, 0])).toBe('amber');
    expect(mapRgbToReticulumIconColor([0, 0, 255])).toBe('cyan');
  });

  it('parses LXMF icon appearance wire', () => {
    const parsed = parseReticulumIconAppearanceWire({
      icon_name: 'hiking',
      foreground_rgb: [255, 255, 0],
      background_rgb: [0, 0, 255],
    });
    expect(parsed).toEqual({ icon_name: 'hiking', icon_color: 'amber' });
  });

  it('maps material symbols to lucide names', () => {
    expect(resolveReticulumProfileIconName('favorite')).toBe('heart');
    expect(resolveReticulumProfileIconName('hiking')).toBe('user');
    expect(resolveReticulumProfileIconName('star')).toBe('star');
  });
});
