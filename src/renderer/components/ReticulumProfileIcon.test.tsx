import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReticulumProfileIconSlot, ReticulumProfileIconUnset } from './ReticulumProfileIcon';

describe('ReticulumProfileIconUnset / Slot LXMFace', () => {
  const hash = 'a7b3c9d1e5f20681943ab2de77fc8e01';

  it('renders LXMFace data-URL img when destination hash is valid', () => {
    const { container } = render(<ReticulumProfileIconUnset destinationHash={hash} size={20} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(img?.getAttribute('width')).toBe('20');
  });

  it('falls back to dashed placeholder without a hash', () => {
    const { container } = render(<ReticulumProfileIconUnset size={16} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('Slot uses LXMFace when no custom icon is set', () => {
    const { container } = render(
      <ReticulumProfileIconSlot destinationHash={hash} iconName="circle" size={14} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('Slot prefers custom Lucide icon over LXMFace', () => {
    const { container } = render(
      <ReticulumProfileIconSlot
        destinationHash={hash}
        iconName="star"
        iconColor="green"
        size={14}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
