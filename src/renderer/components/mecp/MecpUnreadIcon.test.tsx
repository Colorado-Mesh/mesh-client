import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { MecpUnreadIcon } from './MecpUnreadIcon';

describe('MecpUnreadIcon', () => {
  it.each([
    [0, 'MAYDAY'],
    [1, 'URGENT'],
    [2, 'SAFETY'],
    [3, 'ROUTINE'],
  ] as const)('labels severity %i as %s', (severity, word) => {
    render(<MecpUnreadIcon severity={severity} />);
    expect(screen.getByRole('img', { name: `Unread ${word} MECP report` })).toBeInTheDocument();
  });

  it.each([0, 1, 2, 3] as const)('has no axe violations for severity %i', async (severity) => {
    const { container } = render(
      <div className="bg-deep-black">
        <MecpUnreadIcon severity={severity} />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
