import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SnrIndicator from './SnrIndicator';

const FILLED_GREEN = '#4ade80';
const FILLED_YELLOW = '#facc15';
const FILLED_RED = '#f87171';
const UNFILLED = '#364156';

function barFills(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('rect')).map((r) => r.getAttribute('fill') ?? '');
}

describe('SnrIndicator', () => {
  it('fills all three bars and prints a signed value for strong SNR', () => {
    const { container } = render(<SnrIndicator snr={5} />);
    expect(screen.getByText('+5.0 dB')).toBeInTheDocument();
    expect(barFills(container)).toEqual([FILLED_GREEN, FILLED_GREEN, FILLED_GREEN]);
  });

  it('fills two bars for non-negative SNR without a plus sign at zero', () => {
    const { container } = render(<SnrIndicator snr={0} />);
    expect(screen.getByText('0.0 dB')).toBeInTheDocument();
    expect(barFills(container)).toEqual([FILLED_YELLOW, FILLED_YELLOW, UNFILLED]);
  });

  it('fills one bar for negative SNR', () => {
    const { container } = render(<SnrIndicator snr={-12.5} />);
    expect(screen.getByText('-12.5 dB')).toBeInTheDocument();
    expect(barFills(container)).toEqual([FILLED_RED, UNFILLED, UNFILLED]);
  });

  it('appends a custom className', () => {
    const { container } = render(<SnrIndicator snr={1} className="ml-2" />);
    expect(container.firstElementChild?.className).toContain('ml-2');
  });
});
