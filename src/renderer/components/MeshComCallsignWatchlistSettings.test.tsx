/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { mergeAppSetting } from '../lib/appSettingsStorage';
import i18n from '../lib/i18n';
import {
  MESHCOM_CALLSIGN_WATCHLIST_KEY,
  resetMeshcomCallsignWatchlistAlertsForTests,
} from '../lib/meshcom/meshcomCallsignWatchlist';
import { MeshComCallsignWatchlistSettings } from './MeshComCallsignWatchlistSettings';

describe('MeshComCallsignWatchlistSettings', () => {
  beforeEach(async () => {
    resetMeshcomCallsignWatchlistAlertsForTests();
    mergeAppSetting(MESHCOM_CALLSIGN_WATCHLIST_KEY, [], 'MeshComCallsignWatchlistSettings.test');
    await i18n.changeLanguage('en');
    vi.mocked(window.electronAPI.appSettings.set).mockReset().mockResolvedValue({ changes: 1 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('adds and removes watchlist callsigns', async () => {
    const user = userEvent.setup();
    render(<MeshComCallsignWatchlistSettings />);
    const input = screen.getByRole('textbox', { name: /add callsign to meshcom watchlist/i });
    await user.type(input, 'oe1abc-9');
    await user.click(screen.getByRole('button', { name: /add callsign to meshcom watchlist/i }));
    await waitFor(() => {
      expect(screen.getByText('OE1ABC')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /remove OE1ABC from meshcom watchlist/i }));
    await waitFor(() => {
      expect(screen.queryByText('OE1ABC')).not.toBeInTheDocument();
    });
  });

  it('shows a save failure alert when persistence rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('disk full'));
    render(<MeshComCallsignWatchlistSettings />);
    const input = screen.getByRole('textbox', { name: /add callsign to meshcom watchlist/i });
    await user.type(input, 'W1AW');
    await user.click(screen.getByRole('button', { name: /add callsign to meshcom watchlist/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not save the meshcom watchlist/i);
    });
    expect(screen.queryByText('W1AW')).not.toBeInTheDocument();
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<MeshComCallsignWatchlistSettings />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
