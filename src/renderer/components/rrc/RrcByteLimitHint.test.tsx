import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { isRrcByteLimitOverMax, RrcByteLimitHint } from './RrcByteLimitHint';

describe('RrcByteLimitHint', () => {
  it('renders nothing when the limit is unknown', () => {
    const { container } = render(
      <RrcByteLimitHint text="anything" limit={null} overMaxKey="rrc.byteLimit.overMax" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while below the warning threshold', () => {
    const { container } = render(
      <RrcByteLimitHint text="abc" limit={10} overMaxKey="rrc.byteLimit.overMax" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a muted counter once 80% of the limit is reached', () => {
    render(<RrcByteLimitHint text="abcdefgh" limit={10} overMaxKey="rrc.byteLimit.overMax" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('8 / 10');
    expect(status.className).toContain('text-muted');
  });

  it('turns orange exactly at the limit', () => {
    render(<RrcByteLimitHint text="abcdefghij" limit={10} overMaxKey="rrc.byteLimit.overMax" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('10 / 10');
    expect(status.className).toContain('text-orange-400');
  });

  it('shows the over-max message and the red tone once the limit is exceeded', () => {
    render(
      <RrcByteLimitHint text={'a'.repeat(11)} limit={10} overMaxKey="rrc.byteLimit.overMax" />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Message too long');
    expect(status).toHaveTextContent('10');
    expect(status.className).toContain('text-red-400');
  });

  it('counts UTF-8 bytes rather than characters', () => {
    // Three emoji are 12 UTF-8 bytes, over a 10-byte limit.
    expect(isRrcByteLimitOverMax('😀😀😀', 10)).toBe(true);
    expect(isRrcByteLimitOverMax('😀😀', 10)).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div className="bg-ink-900">
        <RrcByteLimitHint text={'a'.repeat(11)} limit={10} overMaxKey="rrc.byteLimit.overMax" />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
