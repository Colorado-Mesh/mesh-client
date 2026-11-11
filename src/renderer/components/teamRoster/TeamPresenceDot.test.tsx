import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { NodeStatus } from '@/renderer/lib/nodeStatus';

import { TeamPresenceDot } from './TeamPresenceDot';

describe('TeamPresenceDot', () => {
  it.each<[NodeStatus, string, string]>([
    ['online', 'Online', 'bg-green-500'],
    ['stale', 'Stale', 'bg-orange-500'],
    ['offline', 'Offline', 'bg-ink-500'],
  ])('renders the %s status with an accessible label', (status, label, className) => {
    render(<TeamPresenceDot status={status} />);
    const dot = screen.getByRole('img', { name: label });
    expect(dot).toHaveAttribute('title', label);
    expect(dot.className).toContain(className);
  });

  it('appends a custom className', () => {
    const { container } = render(<TeamPresenceDot status="online" className="ml-1" />);
    expect(container.firstElementChild?.className).toContain('ml-1');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div className="bg-ink-900">
        <TeamPresenceDot status="online" />
        <TeamPresenceDot status="stale" />
        <TeamPresenceDot status="offline" />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
