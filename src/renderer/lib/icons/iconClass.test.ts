import { describe, expect, it } from 'vitest';

import { ICON_LG, ICON_MD, ICON_SM, ICON_SM_PLUS } from './iconClass';

describe('iconClass', () => {
  it('exports stable Tailwind size classes', () => {
    expect(ICON_SM).toContain('h-3');
    expect(ICON_SM_PLUS).toContain('h-3.5');
    expect(ICON_MD).toContain('w-4');
    expect(ICON_LG).toContain('w-5');
  });
});
