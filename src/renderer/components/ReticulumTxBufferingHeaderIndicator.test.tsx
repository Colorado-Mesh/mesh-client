import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumTxBufferingHeaderIndicator } from './ReticulumTxBufferingHeaderIndicator';

describe('ReticulumTxBufferingHeaderIndicator', () => {
  it('renders nothing when not buffering', () => {
    const { container } = render(<ReticulumTxBufferingHeaderIndicator buffering={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows amber spinner with named tooltip when buffering', () => {
    render(<ReticulumTxBufferingHeaderIndicator buffering interfaceName="RNode 41F4" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Buffering outbound packets on "RNode 41F4"/i),
    );
  });

  it('uses generic copy when interface name is missing', () => {
    render(<ReticulumTxBufferingHeaderIndicator buffering />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Buffering outbound packets to a local RNode/i),
    );
  });

  it('has no axe violations when buffering', async () => {
    const { container } = render(
      <ReticulumTxBufferingHeaderIndicator buffering interfaceName="RNode USB" />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
