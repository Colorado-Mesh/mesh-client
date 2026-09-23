import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { closeApp, disposeUserData, launchApp, openAppTab, teardownApp } from './electronApp';

function wave(): Buffer {
  const rate = 8000;
  const frames = rate / 2;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 1000), 44 + i * 2);
  return bytes;
}

test('custom notification tone survives restart and can repair a missing saved copy', async () => {
  test.setTimeout(120_000);
  const directory = mkdtempSync(path.join(tmpdir(), 'mesh-sound-e2e-'));
  const file = path.join(directory, 'test-tone.wav');
  writeFileSync(file, wave());
  let launched = await launchApp({ retainUserData: true });
  const profile = launched.userDataDir;
  try {
    await launched.app.evaluate(({ BrowserWindow, dialog }, filePath) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, file);
    await openAppTab(launched.page);
    await launched.page.getByText('Notification tones', { exact: true }).click();
    await launched.page
      .getByRole('button', { name: 'Choose audio file for Direct messages' })
      .click();
    const select = launched.page.getByRole('combobox', { name: 'Tone for Direct messages' });
    await expect(select).toHaveValue('custom');
    await expect(select.locator('option:checked')).toHaveText('test-tone.wav');
    await expect(
      launched.page.getByRole('button', { name: 'Preview Direct messages' }),
    ).toBeEnabled();
    await launched.page.getByRole('button', { name: 'Preview Direct messages' }).click();
    await expect(
      launched.page.getByRole('button', { name: 'Preview Direct messages' }),
    ).toBeVisible();
    await expect(launched.page.getByRole('alert')).toHaveCount(0);
    rmSync(file);
    await closeApp(launched);
    launched = await launchApp({ userDataDir: profile, retainUserData: true });
    await launched.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
    });
    await openAppTab(launched.page);
    await launched.page.getByText('Notification tones', { exact: true }).click();
    const restored = launched.page.getByRole('combobox', { name: 'Tone for Direct messages' });
    await expect(restored).toHaveValue('custom');
    await expect(restored.locator('option:checked')).toHaveText('test-tone.wav');
    await launched.page.getByRole('button', { name: 'Preview Direct messages' }).click();
    await expect(
      launched.page.getByRole('button', { name: 'Preview Direct messages' }),
    ).toBeVisible();
    await expect(launched.page.getByRole('alert')).toHaveCount(0);
    await closeApp(launched);
    rmSync(path.join(profile, 'notification-sounds', 'dm.json'));
    launched = await launchApp({ userDataDir: profile, retainUserData: true });
    await launched.app.evaluate(({ BrowserWindow, dialog }, filePath) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
    }, file);
    await openAppTab(launched.page);
    await launched.page.getByText('Notification tones', { exact: true }).click();
    await launched.page.getByRole('button', { name: 'Preview Direct messages' }).click();
    await expect(launched.page.getByRole('alert')).toHaveText(/Could not play/);
    writeFileSync(file, wave());
    await launched.page
      .getByRole('button', { name: 'Choose audio file for Direct messages' })
      .click();
    await expect(
      launched.page.getByRole('button', { name: 'Preview Direct messages' }),
    ).toBeEnabled();
    await launched.page.getByRole('button', { name: 'Preview Direct messages' }).click();
    await expect(
      launched.page.getByRole('button', { name: 'Preview Direct messages' }),
    ).toBeVisible();
    await expect(launched.page.getByRole('alert')).toHaveCount(0);
    await launched.page
      .getByRole('combobox', { name: 'Tone for MECP SAFETY' })
      .selectOption('alert');
    await expect(launched.page.getByRole('button', { name: 'Reset MECP SAFETY' })).toBeEnabled();
    await expect(
      launched.page.getByRole('combobox', { name: 'Tone for MECP ROUTINE' }),
    ).toHaveValue('default');
    await launched.page.screenshot({ path: test.info().outputPath('notification-sounds.png') });
    await launched.page.getByRole('button', { name: 'Reset Direct messages' }).click();
    await expect(
      launched.page.getByRole('combobox', { name: 'Tone for Direct messages' }),
    ).toHaveValue('default');
  } finally {
    await teardownApp(launched);
    await disposeUserData(profile);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('notification tone and volume controls retain keyboard focus after saving', async () => {
  const launched = await launchApp();
  try {
    await openAppTab(launched.page);
    await launched.page.getByText('Notification tones', { exact: true }).click();
    const tone = launched.page.getByRole('combobox', { name: 'Tone for Direct messages' });
    const reset = launched.page.getByRole('button', { name: 'Reset Direct messages' });
    await tone.focus();
    await tone.selectOption('chime');
    await expect(reset).toBeEnabled();
    await expect(tone).toBeFocused();
    const volume = launched.page.getByRole('slider', { name: 'Volume for Direct messages' });
    await volume.focus();
    await volume.press('ArrowLeft');
    await expect(reset).toBeEnabled();
    await expect(volume).toHaveValue('95');
    await expect(volume).toBeFocused();
    await volume.press('ArrowLeft');
    await expect(reset).toBeEnabled();
    await expect(volume).toHaveValue('90');
    await expect(volume).toBeFocused();
  } finally {
    await teardownApp(launched);
  }
});
