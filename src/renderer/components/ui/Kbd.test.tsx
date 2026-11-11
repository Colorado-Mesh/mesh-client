import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd } from './Kbd';

describe('Kbd', () => {
  it('renders the shortcut text in a kbd element', () => {
    const { container } = render(<Kbd>Ctrl+K</Kbd>);
    const kbd = container.querySelector('kbd');
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent('Ctrl+K');
  });

  it('hides itself on coarse pointers where there is no keyboard', () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    const kbd = container.querySelector('kbd');
    expect(kbd?.className).toContain('pointer-coarse:hidden');
  });
});
