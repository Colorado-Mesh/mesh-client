import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from '../lib/appSettingsStorage';
import i18n from '../lib/i18n';
import { SUPPORTED_LANGUAGES } from '../locales/languages';
import LanguageSelector from './LanguageSelector';

vi.mock('../lib/appSettingsStorage', async (importOriginal) => {
  const actual = await importOriginal();
  if (!actual || typeof actual !== 'object') {
    return { mergeAppSetting: vi.fn() };
  }
  return {
    ...(actual as Record<string, unknown>),
    mergeAppSetting: vi.fn(),
  };
});

describe('LanguageSelector', () => {
  beforeEach(async () => {
    vi.mocked(mergeAppSetting).mockClear();
    vi.mocked(window.electronAPI.appSettings.getAll).mockClear();
    await i18n.changeLanguage('en');
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  it('renders animated globe language icon', () => {
    const { container } = render(<LanguageSelector />);
    const button = screen.getByLabelText(/language/i);
    expect(button).toBeInTheDocument();
    expect(container.querySelector('svg.text-cyan-300')).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Click to select language');
  });

  it('lists all supported languages when parent has overflow clipping', async () => {
    const user = userEvent.setup();
    render(
      <div className="h-8 overflow-hidden">
        <LanguageSelector />
      </div>,
    );

    await user.click(screen.getByLabelText(/language/i));
    expect(screen.getAllByRole('option')).toHaveLength(SUPPORTED_LANGUAGES.length);
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeVisible();
  });

  it('persists locale when selecting a language', async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);

    await user.click(screen.getByLabelText(/language/i));
    await user.click(screen.getByRole('button', { name: 'Deutsch' }));

    await waitFor(() => {
      expect(mergeAppSetting).toHaveBeenCalledWith('locale', 'de', 'LanguageSelector');
    });
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith('locale', 'de');
  });

  it('stays open when scrolling the language list', async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);

    const trigger = screen.getByLabelText(/language/i);
    await user.click(trigger);

    const listbox = screen.getByRole('listbox');
    act(() => {
      listbox.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeVisible();
  });

  it('closes when an outside element scrolls', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <div data-testid="scroll-outside" style={{ height: 40, overflow: 'auto' }}>
          <div style={{ height: 200 }} />
        </div>
        <LanguageSelector />
      </div>,
    );

    const trigger = screen.getByLabelText(/language/i);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const outside = container.querySelector('[data-testid="scroll-outside"]');
    expect(outside).toBeTruthy();
    act(() => {
      outside!.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
