import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from '../lib/appSettingsStorage';
import i18n from '../lib/i18n';
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
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
  });

  it('renders colorful globe icon accents', () => {
    const { container } = render(<LanguageSelector />);
    const button = screen.getByLabelText(/language/i);
    expect(button).toBeInTheDocument();
    expect(container.querySelector('.stroke-cyan-300')).toBeInTheDocument();
    expect(container.querySelector('.stroke-emerald-300')).toBeInTheDocument();
    expect(container.querySelector('.stroke-violet-300')).toBeInTheDocument();
    expect(container.querySelector('.fill-amber-300\\/90')).toBeInTheDocument();
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
});
