import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { bumpMecpPaxFreetext, MecpComposeModal } from './MecpComposeModal';
import {
  MECP_SEVERITY_BADGE_CLASSES,
  mecpChatBubbleToneClasses,
  MecpSeverityBadge,
} from './MecpSeverityBadge';

describe('bumpMecpPaxFreetext', () => {
  it('appends then increments pax counts', () => {
    expect(bumpMecpPaxFreetext('')).toBe('1pax');
    expect(bumpMecpPaxFreetext('note')).toBe('note 1pax');
    expect(bumpMecpPaxFreetext('note 1pax')).toBe('note 2pax');
    expect(bumpMecpPaxFreetext('3pax west')).toBe('4pax west');
  });
});

describe('MecpComposeModal', () => {
  it('defaults to ROUTINE and Drill category with no codes selected', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    expect(screen.getByRole('button', { name: 'ROUTINE' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Drill / Test' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /D02 This is a test/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('encodes and sends when an M01 code is selected', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: 'Medical' }));
    await user.click(screen.getByRole('button', { name: /M01 /i }));
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalled();
    expect(String(onSend.mock.calls[0]?.[0])).toMatch(/^MECP\/3\//);
    expect(String(onSend.mock.calls[0]?.[0])).toMatch(/M01/);
  });

  it('focuses requests on reports and exposes the full standard code list when needed', async () => {
    const user = userEvent.setup();
    render(<MecpComposeModal mode="request" open onClose={() => {}} onSend={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'MECP request or report' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Response' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Have / Offer Resources' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Medical' }));
    await user.click(screen.getByRole('button', { name: /M01 Injury/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Show all MECP codes' }));
    expect(screen.getByRole('button', { name: 'Response' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove code M01' })).toBeInTheDocument();
  });

  it('opens responses on R codes and sends the standard wire format', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal mode="response" open onClose={() => {}} onSend={onSend} />);
    expect(screen.getByRole('dialog', { name: 'MECP response' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Response' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /R02 Help coming/ }));
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith('MECP/3/R02');
  });

  it.each(['request', 'response'] as const)(
    'has no axe violations in %s mode with a selected code',
    async (mode) => {
      const user = userEvent.setup();
      const { container } = render(
        <MecpComposeModal mode={mode} open onClose={() => {}} onSend={vi.fn()} />,
      );
      await user.click(
        screen.getByRole('button', {
          name: mode === 'request' ? /D02 This is a test/ : /R02 Help coming/,
        }),
      );
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('has no axe violations', async () => {
    const { container } = render(<MecpComposeModal open onClose={() => {}} onSend={() => {}} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('MecpSeverityBadge', () => {
  it.each([0, 1, 2, 3] as const)('has no axe violations for severity %i', async (severity) => {
    const { container } = render(<MecpSeverityBadge severity={severity} pulse={severity <= 1} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses red for 0–1, yellow for 2, blue for 3', () => {
    expect(MECP_SEVERITY_BADGE_CLASSES[0]).toContain('bg-red-700');
    expect(MECP_SEVERITY_BADGE_CLASSES[1]).toContain('bg-red-700');
    expect(MECP_SEVERITY_BADGE_CLASSES[2]).toContain('bg-yellow-600');
    expect(MECP_SEVERITY_BADGE_CLASSES[3]).toContain('bg-blue-700');
    expect(mecpChatBubbleToneClasses(0, false)).toContain('border-red-500');
    expect(mecpChatBubbleToneClasses(1, true)).toContain('border-red-400');
    expect(mecpChatBubbleToneClasses(2, false)).toContain('border-yellow-500');
    expect(mecpChatBubbleToneClasses(3, true)).toContain('border-blue-400');
  });
});
