import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BleWeakSignalBanner } from './BleWeakSignalBanner';

describe('BleWeakSignalBanner', () => {
  it('renders nothing for missing, unknown, or strong RSSI', () => {
    const { container, rerender } = render(<BleWeakSignalBanner rssi={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BleWeakSignalBanner rssi={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BleWeakSignalBanner rssi={-55} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a polite status warning with the rounded RSSI', () => {
    render(<BleWeakSignalBanner rssi={-85.4} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Bluetooth signal is weak (-85 dBm)');
  });

  it('warns at the weak threshold boundary (-80 dBm)', () => {
    render(<BleWeakSignalBanner rssi={-80} />);
    expect(screen.getByRole('status')).toHaveTextContent('-80 dBm');
  });

  it('honors a custom className', () => {
    render(<BleWeakSignalBanner rssi={-95} className="custom-banner" />);
    expect(screen.getByRole('status').className).toBe('custom-banner');
  });
});
