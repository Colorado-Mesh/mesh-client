import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { bumpMecpPaxFreetext, MecpComposeModal } from './MecpComposeModal';
import { MecpSeverityBadge } from './MecpSeverityBadge';

describe('bumpMecpPaxFreetext', () => {
  it('appends then increments pax counts', () => {
    expect(bumpMecpPaxFreetext('')).toBe('1pax');
    expect(bumpMecpPaxFreetext('note')).toBe('note 1pax');
    expect(bumpMecpPaxFreetext('note 1pax')).toBe('note 2pax');
    expect(bumpMecpPaxFreetext('3pax west')).toBe('4pax west');
  });
});

describe('MecpComposeModal', () => {
  it('defaults to routine drill and sends MECP/3/D01', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalled();
    expect(String(onSend.mock.calls[0]?.[0])).toMatch(/^MECP\/3\/D01/);
  });

  it('encodes and sends when an M01 code is selected', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    const injury = screen.getByRole('button', { name: /M01/i });
    await user.click(injury);
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalled();
    expect(String(onSend.mock.calls[0]?.[0])).toMatch(/^MECP\/3\//);
    expect(String(onSend.mock.calls[0]?.[0])).toMatch(/M01/);
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
