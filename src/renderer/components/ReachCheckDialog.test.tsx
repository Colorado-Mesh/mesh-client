import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { ReachCheckDialogState } from '../hooks/useReachCheck';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { SUPPORTED_LANGUAGES } from '../locales/languages';
import { ReachCheckDialog } from './ReachCheckDialog';

function renderDialog(state: ReachCheckDialogState) {
  const onAnswer = vi.fn();
  const view = render(<ReachCheckDialog state={state} onAnswer={onAnswer} />);
  return { onAnswer, ...view };
}

describe('ReachCheckDialog', () => {
  it('asks for a server, focuses the field and saves on the button or Enter', () => {
    const { onAnswer } = renderDialog({ kind: 'setup' });
    expect(screen.getByRole('dialog', { name: 'Reach check' })).toBeInTheDocument();
    const input = screen.getByLabelText('Reach check server');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'https://rangecheck.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and run' }));
    expect(onAnswer).toHaveBeenLastCalledWith({
      kind: 'save-server',
      url: 'https://rangecheck.example.org',
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('shows why a server address was refused', () => {
    renderDialog({ kind: 'setup', error: 'not_public' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Use the server's public internet address.",
    );
    expect(screen.getByLabelText('Reach check server')).toHaveAttribute('aria-invalid', 'true');
  });

  it('cancels with the button and with Escape', () => {
    const { onAnswer } = renderDialog({ kind: 'setup' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'cancel' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('offers the website on a server with a browser check', () => {
    const { onAnswer } = renderDialog({
      kind: 'turnstile',
      origin: 'https://healthcheck.example.net',
      host: 'healthcheck.example.net',
    });
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'healthcheck.example.net asks for a browser check before it gives out codes.',
    );
    const link = screen.getByRole('link', { name: 'Open healthcheck.example.net' });
    expect(link).toHaveAttribute('href', 'https://healthcheck.example.net');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    fireEvent.click(link);
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'cancel' });
  });

  it('asks before adding the channel and names the slot', () => {
    const { onAnswer } = renderDialog({ kind: 'confirm-add', name: '#cm-reach', index: 5 });
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This server listens on #cm-reach, which is not on your radio. Add it to channel slot 5?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add and run' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'confirm' });
  });

  it('keeps the slot number joined to its word in every locale', () => {
    // At 390 px the German body broke between "Kanal-Slot" and its "5". Each locale joins
    // {{slot}} to the word beside it with a no-break space, or with a word joiner where the
    // script puts no space there (ja, zh), so a line never starts or ends with the bare number.
    const joiners = new Set([String.fromCharCode(0xa0), String.fromCharCode(0x2060)]);
    const placeholder = '{{slot}}';
    for (const { code } of SUPPORTED_LANGUAGES) {
      const file = path.resolve(import.meta.dirname, '../locales', code, 'translation.json');
      const strings = JSON.parse(readFileSync(file, 'utf8')) as {
        reachCheck: { confirmAddBody: string };
      };
      const body = strings.reachCheck.confirmAddBody;
      const at = body.indexOf(placeholder);
      expect(at, `${code} has no ${placeholder}`).toBeGreaterThan(0);
      const before = body.charAt(at - 1);
      const after = body.charAt(at + placeholder.length);
      expect(joiners.has(before) || joiners.has(after), `${code}: ${JSON.stringify(body)}`).toBe(
        true,
      );
    }
  });

  it('asks for a private channel key and shows a hash mismatch', () => {
    const { onAnswer, rerender } = renderDialog({ kind: 'paste-key', name: 'ukmeshtest' });
    const input = screen.getByLabelText('Channel key');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'ab'.repeat(16) } });
    fireEvent.click(screen.getByRole('button', { name: 'Add and run' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'paste-key', hex: 'ab'.repeat(16) });
    rerender(
      <ReachCheckDialog
        state={{ kind: 'paste-key', name: 'ukmeshtest', error: 'hash' }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That key is not the one this server listens with.',
    );
  });

  it.each([
    [{ kind: 'error', error: 'rate_limited', retryAfterSeconds: 120 }, 'Try again in 2 min.'],
    [{ kind: 'error', error: 'rate_limited' }, 'Try again later.'],
    [
      { kind: 'error', error: 'key-mismatch', name: '#cm-reach' },
      'Your #cm-reach channel uses a different key than this server',
    ],
    [{ kind: 'error', error: 'slots-full' }, 'All channel slots are in use.'],
    [{ kind: 'error', error: 'send-failed' }, 'The code could not be sent.'],
    [{ kind: 'error', error: 'network' }, 'The server could not be reached.'],
    [{ kind: 'error', error: 'not_configured' }, 'This server has no test channel set up.'],
    [{ kind: 'error', error: 'no_observers' }, 'This server has no observers to check against'],
    [{ kind: 'error', error: 'invalid_response' }, 'The server answer was not understood.'],
    [
      { kind: 'error', error: 'changed' },
      'The radio or its channels changed during the check, so nothing was sent. Try again.',
    ],
  ] as [ReachCheckDialogState, string][])('explains %o', (state, text) => {
    const { onAnswer } = renderDialog(state);
    expect(screen.getByRole('dialog')).toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'cancel' });
  });

  it('wraps its message and field error so a short last word does not end up alone', () => {
    // At 390 px the rate message broke as "Try again in 3" / "min." and the browser check
    // message ended with "opened." alone; text-wrap: pretty keeps the last line from being one word.
    renderDialog({ kind: 'paste-key', name: 'ukmeshtest', error: 'hash' });
    const bodyId = screen.getByRole('dialog').getAttribute('aria-describedby');
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId ?? '')).toHaveClass('text-pretty');
    expect(screen.getByRole('alert')).toHaveClass('text-pretty');
  });

  it.each([
    { kind: 'setup', error: 'invalid_url' },
    { kind: 'error', error: 'key-mismatch', name: '#cm-reach' },
  ] as ReachCheckDialogState[])('has no axe violations (%o)', async (state) => {
    const { container } = renderDialog(state);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
