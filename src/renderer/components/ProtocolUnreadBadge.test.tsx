import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { ProtocolUnreadBadge } from './ProtocolUnreadBadge';

describe('ProtocolUnreadBadge', () => {
  it('renders the numeric count in the contrast-bearing label', () => {
    const { getByText } = render(<ProtocolUnreadBadge count={5} fillClass="bg-readable-green" />);
    expect(getByText('5')).toBeInTheDocument();
  });

  it('caps the label at 99+ for numeric counts over 99', () => {
    const { getByText, queryByText } = render(
      <ProtocolUnreadBadge count={150} fillClass="bg-cyan-800 text-white" />,
    );
    expect(getByText('99+')).toBeInTheDocument();
    expect(queryByText('150')).not.toBeInTheDocument();
  });

  it('passes non-numeric counts through unchanged (e.g. "-" placeholder)', () => {
    const { getByText } = render(<ProtocolUnreadBadge count="-" fillClass="bg-amber-800" />);
    expect(getByText('-')).toBeInTheDocument();
  });

  it('keeps the pulse decoration on a separate aria-hidden layer', () => {
    const { container } = render(<ProtocolUnreadBadge count={3} fillClass="bg-readable-green" />);
    const pulseLayer = container.querySelector('[aria-hidden="true"]');
    expect(pulseLayer).not.toBeNull();
    expect(pulseLayer).toHaveClass('animate-pulse');
  });

  it('keeps the text-bearing label fully opaque (no pulse on the contrast-critical element)', () => {
    const { container } = render(<ProtocolUnreadBadge count={3} fillClass="bg-readable-green" />);
    const label = container.querySelector('[data-protocol-unread-label]');
    expect(label).not.toBeNull();
    expect(label).not.toHaveClass('animate-pulse');
  });

  it.each(['bg-readable-green', 'bg-cyan-800 text-white', 'bg-amber-800 text-white'] as const)(
    'has no axe violations with the %s fill class',
    async (fillClass) => {
      const { getByText } = render(<ProtocolUnreadBadge count={7} fillClass={fillClass} />);
      const label = getByText('7');
      hydrateAxeThemeColors(label);
      expect(await axe(label)).toHaveNoViolations();
    },
  );

  it('has no axe violations when the label shows the 99+ cap', async () => {
    const { getByText } = render(<ProtocolUnreadBadge count={250} fillClass="bg-readable-green" />);
    const label = getByText('99+');
    hydrateAxeThemeColors(label);
    expect(await axe(label)).toHaveNoViolations();
  });
});
