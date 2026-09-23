import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import {
  previewNotificationSound,
  stopNotificationSoundPreview,
  validateNotificationSound,
} from '../lib/chatNotifications';
import i18n from '../lib/i18n';
import { getNotificationSoundSettings } from '../lib/notificationSoundSettings';
import NotificationSoundSettings from './NotificationSoundSettings';

vi.mock('../lib/chatNotifications', () => ({
  previewNotificationSound: vi.fn().mockResolvedValue(undefined),
  stopNotificationSoundPreview: vi.fn(),
  validateNotificationSound: vi.fn().mockResolvedValue(undefined),
}));

describe('NotificationSoundSettings', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
    vi.mocked(window.electronAPI.appSettings.set).mockReset().mockResolvedValue({ changes: 1 });
    vi.mocked(window.electronAPI.notificationSounds.choose).mockReset().mockResolvedValue(null);
    vi.mocked(window.electronAPI.notificationSounds.save)
      .mockReset()
      .mockResolvedValue({ id: 'a'.repeat(64), name: 'glass.wav' });
    vi.mocked(validateNotificationSound).mockReset().mockResolvedValue(undefined);
    vi.mocked(previewNotificationSound).mockReset().mockResolvedValue(undefined);
    vi.mocked(stopNotificationSoundPreview).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  function open() {
    const result = render(<NotificationSoundSettings />);
    fireEvent.click(screen.getByText('Notification tones'));
    return result;
  }

  it('exposes distinct event controls and emergency volume floors accessibly', async () => {
    const { container } = open();
    expect(screen.getAllByRole('combobox')).toHaveLength(7);
    expect(screen.getByRole('slider', { name: 'Volume for MECP MAYDAY' })).toHaveAttribute(
      'min',
      '10',
    );
    expect(screen.getByRole('slider', { name: 'Volume for MECP SAFETY' })).toHaveAttribute(
      'min',
      '0',
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('saves presets and reset per event', async () => {
    open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tone for Direct messages' }), {
      target: { value: 'chime' },
    });
    await waitFor(() => {
      expect(getNotificationSoundSettings().dm.sound).toBe('chime');
    });
    expect(getNotificationSoundSettings().channel.sound).toBe('default');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reset Direct messages' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Direct messages' }));
    await waitFor(() => {
      expect(getNotificationSoundSettings().dm.sound).toBe('default');
    });
  });

  it('keeps a volume drag responsive and commits the final value', async () => {
    open();
    const slider = screen.getByRole('slider', { name: 'Volume for Direct messages' });
    fireEvent.change(slider, { target: { value: '70' } });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue('40');
    fireEvent.pointerUp(slider);
    await waitFor(() => {
      expect(getNotificationSoundSettings().dm.volume).toBe(40);
    });
  });

  it('validates and copies a selected file before saving its reference', async () => {
    const imported = { name: 'glass.wav', dataBase64: 'bytes' };
    vi.mocked(window.electronAPI.notificationSounds.choose).mockResolvedValueOnce(imported);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Choose audio file for Direct messages' }));
    await waitFor(() => {
      expect(getNotificationSoundSettings().dm.sound).toEqual({
        id: 'a'.repeat(64),
        name: 'glass.wav',
      });
    });
    expect(validateNotificationSound).toHaveBeenCalledWith('bytes');
    expect(window.electronAPI.notificationSounds.save).toHaveBeenCalledWith(
      'dm',
      imported,
      undefined,
    );
  });

  it('preserves settings when the chooser is cancelled or audio validation fails', async () => {
    open();
    const choose = screen.getByRole('button', { name: 'Choose audio file for Channel messages' });
    fireEvent.click(choose);
    await waitFor(() => {
      expect(choose).toBeEnabled();
    });
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
    vi.mocked(window.electronAPI.notificationSounds.choose).mockResolvedValueOnce({
      name: 'bad.wav',
      dataBase64: 'bad',
    });
    vi.mocked(validateNotificationSound).mockRejectedValueOnce(new Error('bad audio'));
    fireEvent.click(choose);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not import');
    expect(window.electronAPI.notificationSounds.save).not.toHaveBeenCalled();
    expect(getNotificationSoundSettings().channel.sound).toBe('default');
  });

  it('surfaces failed writes without changing the selection', async () => {
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('disk full'));
    open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tone for Direct messages' }), {
      target: { value: 'bell' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('combobox', { name: 'Tone for Direct messages' })).toHaveValue(
      'default',
    );
  });

  it('stops previews on demand and on unmount', () => {
    vi.mocked(previewNotificationSound).mockReturnValue(new Promise(() => {}));
    const { unmount } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Preview Channel messages' }));
    expect(previewNotificationSound).toHaveBeenCalledWith('channel', {
      sound: 'default',
      volume: 100,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop preview for Channel messages' }));
    expect(screen.getByRole('button', { name: 'Preview Channel messages' })).toBeVisible();
    const calls = vi.mocked(stopNotificationSoundPreview).mock.calls.length;
    unmount();
    expect(stopNotificationSoundPreview).toHaveBeenCalledTimes(calls + 1);
  });

  it('does not import a delayed selection after the settings panel is closed', async () => {
    let choose!: (value: { name: string; dataBase64: string }) => void;
    vi.mocked(window.electronAPI.notificationSounds.choose).mockReturnValueOnce(
      new Promise((resolve) => {
        choose = resolve;
      }),
    );
    const { unmount } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Choose audio file for Direct messages' }));
    unmount();
    await act(async () => {
      choose({ name: 'tone.wav', dataBase64: 'bytes' });
      await Promise.resolve();
    });
    expect(validateNotificationSound).not.toHaveBeenCalled();
    expect(window.electronAPI.notificationSounds.save).not.toHaveBeenCalled();
  });
});
