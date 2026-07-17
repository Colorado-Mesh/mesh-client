import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SignalMeter from './SignalMeter';

describe('SignalMeter', () => {
  it('renders RSSI and SNR when present', () => {
    render(<SignalMeter rssi={-65} snr={7.5} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/-65/)).toBeInTheDocument();
    expect(screen.getByText(/\+7\.5/)).toBeInTheDocument();
  });

  it('shows empty placeholders when no data', () => {
    render(<SignalMeter />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label');
    expect(status.textContent).toMatch(/—/);
  });
});
