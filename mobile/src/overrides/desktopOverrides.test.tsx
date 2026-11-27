import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuitButton } from '@/renderer/components/shell/QuitButton';

import { RENDERER_OVERRIDES } from '../../scripts/desktop-overrides.mjs';

describe('desktop module overrides', () => {
  it('the header has no Quit control on phones (the OS closes apps)', () => {
    const { container } = render(<QuitButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('every override names an existing wrapper', () => {
    const wrappers = import.meta.glob('./renderer/*.{ts,tsx}');
    for (const wrapper of Object.values(RENDERER_OVERRIDES)) {
      expect(Object.keys(wrappers), wrapper).toContain(`./renderer/${wrapper}`);
    }
  });
});
