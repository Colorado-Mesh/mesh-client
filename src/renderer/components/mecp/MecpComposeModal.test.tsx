import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(async () => {
    cleanup();
    await i18next.changeLanguage('en');
  });

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

  it('previews compact codes and operator notes by default', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /D02 This is a test/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' }),
      '1pax app test',
    );
    const text = 'MECP/3/D02 1pax app test';
    expect(screen.getByRole('checkbox', { name: 'Include an explanation' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include a MECP help link' })).not.toBeChecked();
    expect(
      screen.queryByRole('combobox', { name: 'Explanation language' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('What other apps will see')).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith(text);
  });

  it('blocks additions over the transport budget and restores compact sending when unchecked', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} maxMessageBytes={45} />);
    await user.click(screen.getByRole('button', { name: /D02 This is a test/ }));
    const notes = '2pax 39.7392,-104.9903 app test';
    await user.type(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' }), notes);
    const compact = `MECP/3/D02 ${notes}`;
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeEnabled();
    for (const addition of ['Include an explanation', 'Include a MECP help link']) {
      const checkbox = screen.getByRole('checkbox', { name: addition });
      await user.click(checkbox);
      expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(compact);
      expect(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' })).toHaveValue(
        notes,
      );
      expect(screen.getByRole('status')).toHaveTextContent('/ 45 bytes');
      expect(screen.getByRole('status')).toHaveTextContent(
        'The message is too long. Turn off an addition or shorten your notes.',
      );
      expect(screen.getByRole('button', { name: /send mecp/i })).toBeDisabled();
      expect(onSend).not.toHaveBeenCalled();
      await user.click(checkbox);
      expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(compact);
      expect(screen.getByRole('button', { name: /send mecp/i })).toBeEnabled();
    }
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith(compact);
  });

  it.each([
    ['de-DE', 'de', 'Dies ist ein Test'],
    ['ru-RU', 'ru', 'Это тест'],
  ])('defaults explanations to the %s app language', async (appLanguage, pack, label) => {
    await i18next.changeLanguage(appLanguage);
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    await user.click(await screen.findByRole('button', { name: /^D02 / }));
    expect(screen.getByLabelText('What other apps will see')).toHaveTextContent('MECP/3/D02');
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    expect(screen.getByRole('combobox', { name: 'Explanation language' })).toHaveValue(pack);
    const text = `MECP/3/D02 [${pack}: ${label}]`;
    expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(text);
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith(text);
  });

  it('lets the sender override the explanation language independently of the UI language', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MecpComposeModal open onClose={() => {}} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: 'Medical' }));
    await user.click(screen.getByRole('button', { name: /^M01 / }));
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    const languageSelector = screen.getByRole('combobox', { name: 'Explanation language' });
    expect(languageSelector).toHaveValue('en');
    expect(screen.getAllByRole('option')).toHaveLength(15);
    expect(screen.getByRole('option', { name: 'Deutsch' })).toHaveValue('de');
    expect(screen.getByRole('option', { name: 'Русский' })).toHaveValue('ru');
    await user.selectOptions(languageSelector, 'fr');
    expect(i18next.language).toBe('en');
    await act(async () => {
      await i18next.changeLanguage('ru');
    });
    expect(languageSelector).toHaveValue('fr');
    expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(
      'MECP/3/M01 [fr: Blessure]',
    );
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith('MECP/3/M01 [fr: Blessure]');
  });

  it('follows an app language change until the sender explicitly chooses a language', async () => {
    const user = userEvent.setup();
    render(<MecpComposeModal open onClose={() => {}} onSend={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^D02 / }));
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    await act(async () => {
      await i18next.changeLanguage('de');
    });
    expect(screen.getByRole('combobox', { name: 'Explanation language' })).toHaveValue('de');
    expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(
      'MECP/3/D02 [de: Dies ist ein Test]',
    );
  });

  it('counts the exact UTF-8 payload and preserves notes and a leading response ETA', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const notes = '15 2pax 39.7392,-104.9903 подъезд';
    const text = `MECP/3/R03 ${notes} [ru: Время прибытия [минут]] https://mecp.radio`;
    const bytes = new TextEncoder().encode(text).byteLength;
    const { rerender } = render(
      <MecpComposeModal
        mode="response"
        open
        onClose={() => {}}
        onSend={onSend}
        maxMessageBytes={bytes - 1}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^R03 / }));
    await user.type(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' }), notes);
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Explanation language' }), 'ru');
    await user.click(screen.getByRole('checkbox', { name: 'Include a MECP help link' }));
    expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(text);
    expect(screen.getByRole('status')).toHaveTextContent(`${bytes} / ${bytes - 1} bytes`);
    expect(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' })).toHaveValue(notes);
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeDisabled();
    rerender(
      <MecpComposeModal
        mode="response"
        open
        onClose={() => {}}
        onSend={onSend}
        maxMessageBytes={bytes}
      />,
    );
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(onSend).toHaveBeenCalledWith(text);
  });

  it('resets additions and the language override after sending and reopening', async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onSend: vi.fn() };
    const { rerender } = render(<MecpComposeModal {...props} open />);
    await user.click(screen.getByRole('button', { name: /^D02 / }));
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Explanation language' }), 'fr');
    await user.click(screen.getByRole('checkbox', { name: 'Include a MECP help link' }));
    await user.click(screen.getByRole('button', { name: /send mecp/i }));
    expect(props.onClose).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Include an explanation' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include a MECP help link' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    expect(screen.getByRole('combobox', { name: 'Explanation language' })).toHaveValue('en');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Explanation language' }), 'ru');
    await user.click(screen.getByRole('checkbox', { name: 'Include a MECP help link' }));
    rerender(<MecpComposeModal {...props} open={false} />);
    await i18next.changeLanguage('de');
    rerender(<MecpComposeModal {...props} open />);
    expect(screen.getByRole('checkbox', { name: 'Include an explanation' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include a MECP help link' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
    expect(screen.getByRole('combobox', { name: 'Explanation language' })).toHaveValue('de');
    expect(screen.getByRole('button', { name: /send mecp/i })).toBeDisabled();
  });

  it('keeps notes and additions after a failed send and retries the same payload', async () => {
    await withMockedConsoleWarn(async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onSend = vi
        .fn()
        .mockRejectedValueOnce(new Error('Queue is full'))
        .mockResolvedValueOnce(undefined);
      render(<MecpComposeModal open onClose={onClose} onSend={onSend} />);
      const notes = '2pax 39.7392,-104.9903 app test';
      const text = `MECP/3/D02 ${notes} [de: Dies ist ein Test] https://mecp.radio`;
      await user.click(screen.getByRole('button', { name: /^D02 / }));
      await user.type(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' }), notes);
      await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Explanation language' }),
        'de',
      );
      await user.click(screen.getByRole('checkbox', { name: 'Include a MECP help link' }));
      await user.click(screen.getByRole('button', { name: /send mecp/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Queue is full');
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Free text (pax, GPS, notes)' })).toHaveValue(
        notes,
      );
      expect(screen.getByRole('checkbox', { name: 'Include an explanation' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Include a MECP help link' })).toBeChecked();
      expect(screen.getByRole('combobox', { name: 'Explanation language' })).toHaveValue('de');
      expect(screen.getByLabelText('What other apps will see')).toHaveTextContent(text);
      expect(screen.getByRole('button', { name: /send mecp/i })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: /send mecp/i }));
      expect(onSend).toHaveBeenNthCalledWith(1, text);
      expect(onSend).toHaveBeenNthCalledWith(2, text);
      expect(onClose).toHaveBeenCalledOnce();
    });
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
      await user.click(screen.getByRole('checkbox', { name: 'Include an explanation' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Explanation language' }),
        'de',
      );
      await user.click(screen.getByRole('checkbox', { name: 'Include a MECP help link' }));
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
