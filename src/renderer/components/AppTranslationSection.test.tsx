import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';
import { useTranslationStore } from '@/renderer/stores/translationStore';
import type { TranslationProgress } from '@/shared/translation-types';

import { AppTranslationSection } from './AppTranslationSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { pack?: string }) => (opts?.pack ? `${key} ${opts.pack}` : key),
    i18n: { language: 'en' },
  }),
}));
const FR_EN_DOWNLOAD = 'chatTranslation.downloadPack French → English';

describe('App translation settings', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it('shows opt-in first and starts verified engine installation only after enabling', async () => {
    const api = resetTranslation({ ...translationStatus(false), enabled: false });
    const { container } = render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    expect(api.installPack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.enable' }));
    await waitFor(() => {
      expect(api.setEnabled).toHaveBeenCalledWith(true);
    });
    expect(api.installPack).toHaveBeenCalledWith('engine');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('disables auto without complete packs and handles downloads, progress, cancel, delete and remove all', async () => {
    const api = resetTranslation(translationStatus(false));
    let progress!: (value: TranslationProgress) => void;
    api.onPackProgress.mockImplementation((callback) => {
      progress = callback;
      return () => {};
    });
    render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    expect(screen.getByRole('checkbox', { name: 'chatTranslation.auto' })).toBeDisabled();
    expect(screen.getByText('chatTranslation.autoNeedsPacks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: FR_EN_DOWNLOAD }));
    await waitFor(() => {
      expect(api.installPack).toHaveBeenCalledWith('fr-en');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: FR_EN_DOWNLOAD })).toBeEnabled();
    });
    act(() => {
      progress({ packId: 'fr-en', receivedBytes: 50, totalBytes: 100, state: 'downloading' });
    });
    expect(
      screen.getByRole('progressbar', { name: 'chatTranslation.progress French → English' }),
    ).toHaveAttribute('value', '50');
    fireEvent.click(
      screen.getByRole('button', { name: 'chatTranslation.cancelPack French → English' }),
    );
    expect(api.cancelInstall).toHaveBeenCalledWith('fr-en');
    api.getStatus.mockResolvedValue(translationStatus());
    act(() => {
      progress({ packId: 'fr-en', receivedBytes: 100, totalBytes: 100, state: 'installed' });
    });
    const remove = await screen.findByRole('button', {
      name: 'chatTranslation.deletePack French → English',
    });
    fireEvent.click(remove);
    await waitFor(() => {
      expect(api.deletePack).toHaveBeenCalledWith('fr-en');
    });
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.removeAll' }));
    await waitFor(() => {
      expect(api.removeAll).toHaveBeenCalled();
    });
  });
  it('explains read languages and keeps the target language read', async () => {
    const api = resetTranslation(translationStatus(false));
    const { container } = render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    expect(screen.getByText('chatTranslation.readLanguagesHint')).toBeInTheDocument();
    expect(screen.getByText('chatTranslation.autoDescription')).toBeInTheDocument();
    const english = screen.getByRole('checkbox', { name: 'English' });
    expect(english).toBeChecked();
    expect(english).toBeDisabled();
    const french = screen.getByRole('checkbox', { name: 'French' });
    expect(french).not.toBeChecked();
    fireEvent.click(french);
    expect(useTranslationStore.getState().preferences.readLanguages).toEqual(['en', 'fr']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'French' }));
    expect(useTranslationStore.getState().preferences.readLanguages).toEqual(['en']);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('summarizes needed packs for the settings and downloads them together', async () => {
    const status = translationStatus(false);
    status.packs.push({
      id: 'en-de',
      installed: false,
      downloadBytes: 100,
      diskBytes: 0,
      license: 'MPL-2.0',
    });
    const api = resetTranslation(status);
    useTranslationStore
      .getState()
      .setPreferences({ target: 'de', readLanguages: ['de'], auto: false });
    render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    expect(screen.getByText('chatTranslation.pivotHint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.downloadNeeded' }));
    await waitFor(() => {
      expect(api.installPack).toHaveBeenCalledTimes(3);
    });
    expect(api.installPack.mock.calls.map(([id]) => id)).toEqual(['engine', 'en-de', 'fr-en']);
  });
  it('shows a per-pack failure with retry and reports when everything needed is installed', async () => {
    const api = resetTranslation(translationStatus(false));
    api.installPack.mockResolvedValueOnce({ ok: false, reason: 'downloadFailed' });
    render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: FR_EN_DOWNLOAD }));
    expect(await screen.findByText('chatTranslation.downloadFailed')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: FR_EN_DOWNLOAD });
    expect(retry).toHaveTextContent('chatTranslation.retry');
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByText('chatTranslation.downloadFailed')).not.toBeInTheDocument();
    });
    api.getStatus.mockResolvedValue(translationStatus(true));
    await act(async () => {
      const { refreshTranslationStatus } = await import('@/renderer/stores/translationStore');
      await refreshTranslationStatus(true);
    });
    expect(screen.getByText('chatTranslation.neededComplete')).toBeInTheDocument();
  });
  it('filters the language pack table by localized name', async () => {
    const api = resetTranslation(translationStatus(false));
    render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    const search = screen.getByRole('searchbox', { name: 'chatTranslation.searchLanguages' });
    expect(screen.getByRole('rowheader', { name: 'French' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'germ' } });
    expect(screen.getByRole('rowheader', { name: 'German' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'French' })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('chatTranslation.noLanguagesMatch')).toBeInTheDocument();
  });
  it('validates server URL, explains privacy and tests only an explicitly enabled provider', async () => {
    const api = resetTranslation();
    const { container } = render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    expect(screen.getByText('chatTranslation.onlinePrivacy')).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: 'chatTranslation.onlineEnabled' });
    expect(toggle).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'chatTranslation.serverUrl' }), {
      target: { value: 'file:///secret' },
    });
    expect(toggle).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'chatTranslation.serverUrl' }), {
      target: { value: 'http://localhost:5000' },
    });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(api.setLibreConfig).toHaveBeenCalledWith({
        enabled: true,
        url: 'http://localhost:5000',
      });
    });
    const status = translationStatus();
    status.libre = { enabled: true, url: 'http://localhost:5000', hasApiKey: false };
    api.getStatus.mockResolvedValue(status);
    // The main-process status is authoritative after saving configuration.
    await act(async () => {
      const { refreshTranslationStatus } = await import('@/renderer/stores/translationStore');
      await refreshTranslationStatus(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.test' }));
    await waitFor(() => {
      expect(api.testLibreConfig).toHaveBeenCalled();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('allows opting out after deleting packs or entering an invalid server URL', async () => {
    const status = translationStatus(false);
    status.libre = { enabled: true, url: 'https://server.test', hasApiKey: true };
    const api = resetTranslation(status);
    useTranslationStore
      .getState()
      .setPreferences({ target: 'en', readLanguages: ['en'], auto: true });
    render(<AppTranslationSection />);
    await waitFor(() => {
      expect(api.getStatus).toHaveBeenCalled();
    });
    const auto = screen.getByRole('checkbox', { name: 'chatTranslation.auto' });
    expect(auto).toBeChecked();
    expect(auto).toBeEnabled();
    fireEvent.click(auto);
    expect(auto).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'chatTranslation.serverUrl' }), {
      target: { value: 'file:///invalid' },
    });
    const online = screen.getByRole('checkbox', { name: 'chatTranslation.onlineEnabled' });
    expect(online).toBeChecked();
    expect(online).toBeEnabled();
    fireEvent.click(online);
    await waitFor(() => {
      expect(api.setLibreConfig).toHaveBeenCalledWith({
        enabled: false,
        url: 'https://server.test',
      });
    });
  });
});
