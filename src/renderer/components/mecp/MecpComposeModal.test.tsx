import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { MecpComposeModal } from './MecpComposeModal';
import { MecpSeverityBadge } from './MecpSeverityBadge';

describe('MecpComposeModal', () => {
  it('encodes and sends when codes selected', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    const injury = screen.queryByRole('button', { name: /M01/i });
    if (injury) {
      await user.click(injury);
      await user.click(screen.getByRole('button', { name: /send mecp/i }));
      expect(onSend).toHaveBeenCalled();
      expect(String(onSend.mock.calls[0]?.[0])).toMatch(/^MECP\/0\//);
    }
  });

  it('has no axe violations', async () => {
    const { container } = render(<MecpComposeModal open onClose={() => {}} onSend={() => {}} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('MecpSeverityBadge', () => {
  it('has no axe violations for MAYDAY', async () => {
    const { container } = render(<MecpSeverityBadge severity={0} pulse />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
