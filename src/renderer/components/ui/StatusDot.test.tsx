import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { StatusDot, type StatusDotTone } from './StatusDot';

const TONE_CLASS: Record<StatusDotTone, string> = {
  ok: 'bg-status-success',
  idle: 'border-ink-400',
  off: 'bg-ink-600',
  warn: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
};

describe('StatusDot', () => {
  it('is decorative when no label is supplied', () => {
    const { container } = render(<StatusDot tone="ok" />);
    const dot = container.firstElementChild;
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).not.toHaveAttribute('role');
  });

  it('is announced as an image when a label is supplied', () => {
    const { getByRole } = render(<StatusDot tone="warn" label="Weak signal" />);
    expect(getByRole('img', { name: 'Weak signal' })).toBeInTheDocument();
  });

  it.each(Object.entries(TONE_CLASS))('applies the %s tone class', (tone, className) => {
    const { container } = render(<StatusDot tone={tone as StatusDotTone} />);
    expect(container.firstElementChild?.className).toContain(className);
  });

  it('removes the background for the hollow idle ring', () => {
    const { container } = render(<StatusDot tone="idle" />);
    expect(container.firstElementChild?.className).toContain('bg-transparent');
  });

  it('supports md sizing and optional pulse', () => {
    const { container } = render(<StatusDot tone="ok" size="md" pulse />);
    const className = container.firstElementChild?.className ?? '';
    expect(className).toContain('h-2');
    expect(className).toContain('w-2');
    expect(className).toContain('animate-pulse');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div className="bg-ink-900">
        <StatusDot tone="ok" label="Connected" />
        <StatusDot tone="off" />
        <StatusDot tone="error" label="Offline" />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
