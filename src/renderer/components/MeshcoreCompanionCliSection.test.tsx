import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshcoreCompanionCliActions } from '../hooks/meshcore/useMeshcoreCompanionCli';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { MeshcoreCompanionCliResult } from '../lib/meshcore/meshcoreCompanionCli';
import { serializeMeshcoreUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import { renderWithToast } from '../lib/testRenderHelpers';
import MeshcoreCompanionCliSection from './MeshcoreCompanionCliSection';

const REPLIES: Record<string, string> = {
  ver: 'v1.18.0 (Build: 15 Oct 2026)',
  board: 'Heltec V3',
  'get tz.offset': '> -7',
  'get af': '> 1.0',
  'get dutycycle': '> 50.0%',
  'get int.thresh': '> 0',
  'get cad': '> off',
  'get radio.rxgain': '> on',
  'get rxdelay': '> 0.0',
  'get agc.reset.interval': '> 0',
  'get txdelay': '> 0.5',
  'get direct.txdelay': '> 0.2',
  'get wifi.enabled': '> 1',
  'get wifi.ssid': '> HomeNet',
  'get wifi.pwd': '> hunter2',
  'get wifi.status': '> connected',
  'get wifi.ip': '> 192.168.1.40',
  'set af 2': 'OK',
  'set pin 123456': 'OK - reboot to apply',
};

function makeCli(
  overrides: Partial<MeshcoreCompanionCliActions> = {},
): MeshcoreCompanionCliActions {
  return {
    available: true,
    run: vi.fn((command: string): Promise<MeshcoreCompanionCliResult> => {
      const reply = REPLIES[command] ?? 'Unknown command';
      return Promise.resolve(
        reply === 'Unknown command' ? { kind: 'unsupported', reply } : { kind: 'ok', reply },
      );
    }),
    rebootAndReconnect: vi.fn(() => Promise.resolve()),
    powerOff: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function openSection(): void {
  const details = document.querySelector('details');
  if (!details) throw new Error('details missing');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('MeshcoreCompanionCliSection', () => {
  it('shows the firmware notice and skips reads on pre-v1.18 firmware', () => {
    const cli = makeCli({ available: false });
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    expect(screen.getAllByText(/firmware v1\.18/i).length).toBeGreaterThan(0);
    expect(cli.run).not.toHaveBeenCalled();
  });

  it('loads settings lazily when opened', async () => {
    const cli = makeCli();
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    expect(cli.run).not.toHaveBeenCalled();
    openSection();
    expect(await screen.findByDisplayValue('HomeNet')).toBeInTheDocument();
    expect(screen.getByText('Heltec V3')).toBeInTheDocument();
    expect(cli.run).not.toHaveBeenCalledWith('get wifi.pwd');
  });

  it('applies only edited fields in a group and flags reboot-required replies', async () => {
    const cli = makeCli();
    const onToast = vi.fn();
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} onToast={onToast} />);
    openSection();
    const pin = await screen.findByLabelText(/bluetooth pin/i);
    fireEvent.change(pin, { target: { value: '123456' } });
    const deviceGroup = pin.closest('fieldset');
    if (!deviceGroup) throw new Error('fieldset missing');
    const apply = Array.from(deviceGroup.querySelectorAll('button')).find(
      (b) => b.textContent === 'Apply',
    );
    if (!apply) throw new Error('apply missing');
    fireEvent.click(apply);
    await waitFor(() => {
      expect(cli.run).toHaveBeenCalledWith('set pin 123456');
    });
    expect(cli.run).not.toHaveBeenCalledWith(expect.stringMatching(/^set tz\.offset/));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(onToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('rejects an invalid PIN without sending it', async () => {
    const cli = makeCli();
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    const pin = await screen.findByLabelText(/bluetooth pin/i);
    fireEvent.change(pin, { target: { value: '12' } });
    const deviceGroup = pin.closest('fieldset');
    const apply = Array.from(deviceGroup?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Apply',
    );
    if (!apply) throw new Error('apply missing');
    fireEvent.click(apply);
    await waitFor(() => {
      expect(pin).toHaveAttribute('aria-invalid', 'true');
    });
    expect(cli.run).not.toHaveBeenCalledWith('set pin 12');
  });

  it('routes a typed reboot through the confirm dialog and rebootAndReconnect', async () => {
    const cli = makeCli();
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    await screen.findByDisplayValue('HomeNet');
    const input = screen.getByRole('textbox', { name: 'Companion command' });
    fireEvent.change(input, { target: { value: 'reboot' } });
    fireEvent.submit(input.closest('form')!);
    expect(cli.run).not.toHaveBeenCalledWith('reboot');
    const dialog = await screen.findByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) =>
      /reboot/i.test(b.textContent ?? ''),
    );
    if (!confirm) throw new Error('confirm missing');
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(cli.rebootAndReconnect).toHaveBeenCalledTimes(1);
    });
  });

  it('redacts secrets in the console log', async () => {
    const cli = makeCli();
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    await screen.findByDisplayValue('HomeNet');
    const input = screen.getByRole('textbox', { name: 'Companion command' });
    fireEvent.change(input, { target: { value: 'get wifi.pwd' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(cli.run).toHaveBeenCalledWith('get wifi.pwd');
    });
    const log = screen.getByRole('list', { name: 'Companion command history' });
    await waitFor(() => {
      expect(log.textContent).toContain('[redacted]');
    });
    expect(log.textContent).not.toContain('hunter2');
  });

  it('translates a serialized console failure and sanitizes only the log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = makeCli();
    const cli = makeCli({
      run: vi.fn((command: string) =>
        command === 'set af 99'
          ? Promise.reject(
              new Error(
                serializeMeshcoreUserMessage({
                  key: 'meshcoreCompanionCli.commandMustBeSingleLine',
                }),
              ),
            )
          : base.run(command),
      ),
    });
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    await screen.findByDisplayValue('HomeNet');
    const input = screen.getByRole('textbox', { name: 'Companion command' });
    fireEvent.change(input, { target: { value: 'set af 99' } });
    fireEvent.submit(input.closest('form')!);
    const log = screen.getByRole('list', { name: 'Companion command history' });
    await waitFor(() => {
      expect(log.textContent).toContain('Companion command must be a single line.');
    });
    expect(log.textContent).not.toContain('MC_I18N');
    const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('commandMustBeSingleLine');
    expect(logged).not.toContain('\x1e');
    warn.mockRestore();
  });

  it('hides error text for a failed sensitive console command', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const base = makeCli();
    const cli = makeCli({
      run: vi.fn((command: string) =>
        command.startsWith('set wifi.pwd')
          ? Promise.reject(new Error('failed: set wifi.pwd hunter2'))
          : base.run(command),
      ),
    });
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    await screen.findByDisplayValue('HomeNet');
    const input = screen.getByRole('textbox', { name: 'Companion command' });
    fireEvent.change(input, { target: { value: 'set wifi.pwd hunter2' } });
    fireEvent.submit(input.closest('form')!);
    const log = screen.getByRole('list', { name: 'Companion command history' });
    await waitFor(() => {
      expect(log.querySelectorAll('li')).toHaveLength(2);
    });
    expect(log.textContent).not.toContain('hunter2');
  });

  it('keeps console and reboot disabled until the post-apply refresh finishes', async () => {
    let releaseRefresh: (() => void) | null = null;
    const base = makeCli();
    let applied = false;
    const cli = makeCli({
      run: vi.fn((command: string) => {
        if (command === 'set af 2') applied = true;
        if (applied && command === 'ver') {
          return new Promise<MeshcoreCompanionCliResult>((resolve) => {
            releaseRefresh = () => {
              resolve({ kind: 'ok', reply: REPLIES.ver });
            };
          });
        }
        return base.run(command);
      }),
    });
    renderWithToast(<MeshcoreCompanionCliSection cli={cli} disabled={false} />);
    openSection();
    await screen.findByDisplayValue('HomeNet');
    const af = screen.getByDisplayValue('1.0');
    fireEvent.change(af, { target: { value: '2' } });
    const apply = Array.from(af.closest('fieldset')?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Apply',
    );
    if (!apply) throw new Error('apply missing');
    fireEvent.click(apply);
    await waitFor(() => {
      expect(releaseRefresh).not.toBeNull();
    });
    expect(screen.getByRole('textbox', { name: 'Companion command' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reboot and reconnect' })).toBeDisabled();
    (releaseRefresh as unknown as () => void)();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Companion command' })).not.toBeDisabled();
    });
  });

  it('has no axe violations when loaded', async () => {
    const { container } = renderWithToast(
      <MeshcoreCompanionCliSection cli={makeCli()} disabled={false} />,
    );
    openSection();
    await screen.findByDisplayValue('HomeNet');
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
