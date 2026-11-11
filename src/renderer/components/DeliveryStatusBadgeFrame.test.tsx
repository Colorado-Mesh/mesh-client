import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeliveryStatusBadgeFrame } from './DeliveryStatusBadgeFrame';

const TOOLTIP = 'Delivered to the mesh';

describe('DeliveryStatusBadgeFrame', () => {
  it('renders the label and icon inside the shared frame', () => {
    render(
      <DeliveryStatusBadgeFrame
        label="Sent"
        icon="✓"
        colorClass="text-green-400"
        tooltip={TOOLTIP}
      />,
    );
    expect(screen.getByText('Sent ✓')).toBeInTheDocument();
  });

  it('exposes the tooltip as the accessible description', () => {
    const { container } = render(
      <DeliveryStatusBadgeFrame
        label="Sent"
        icon="✓"
        colorClass="text-green-400"
        tooltip={TOOLTIP}
      />,
    );
    const wrapper = container.querySelector(`[aria-label="${TOOLTIP}"]`);
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(screen.getByText(TOOLTIP)).toBeInTheDocument();
  });

  it('applies the supplied color class to the badge text', () => {
    render(
      <DeliveryStatusBadgeFrame
        label="Failed"
        icon="!"
        colorClass="text-red-400"
        tooltip="Send failed"
      />,
    );
    expect(screen.getByText('Failed !').className).toContain('text-red-400');
  });
});
