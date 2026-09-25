import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { withMockedConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

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

  it('prefills MAYDAY severity and auto-attaches GPS exactly once across parent re-renders', async () => {
    const resolveGps = vi.fn().mockResolvedValue({ lat: 39.7392, lon: -104.9903 });
    const { rerender } = render(
      <MecpComposeModal
        open
        onClose={() => {}}
        onSend={() => {}}
        initialSeverity={0}
        autoAttachGps
        resolveGps={resolveGps}
      />,
    );
    expect(screen.getByRole('button', { name: 'MAYDAY' })).toHaveAttribute('aria-pressed', 'true');
    const freetext = screen.getByRole('textbox', { name: /free text/i });
    await vi.waitFor(() => {
      expect(freetext).toHaveValue('#39.73920,-104.99030');
    });

    // Parent re-renders hand a fresh resolver identity; the prefill must not re-run.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'URGENT' }));
    rerender(
      <MecpComposeModal
        open
        onClose={() => {}}
        onSend={() => {}}
        initialSeverity={0}
        autoAttachGps
        resolveGps={() => Promise.resolve({ lat: 1, lon: 2 })}
      />,
    );
    await Promise.resolve();
    expect(resolveGps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'URGENT' })).toHaveAttribute('aria-pressed', 'true');
    expect(freetext).toHaveValue('#39.73920,-104.99030');
  });

  it('shows the GPS error when MAYDAY auto-attach cannot get a fix', async () => {
    await withMockedConsoleWarn(async () => {
      render(
        <MecpComposeModal
          open
          onClose={() => {}}
          onSend={() => {}}
          initialSeverity={0}
          autoAttachGps
          resolveGps={() => Promise.reject(new Error('no fix'))}
        />,
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not get a GPS fix');
    });
  });

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
