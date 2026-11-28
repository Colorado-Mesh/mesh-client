// The Android manifest declares what the shared renderer needs at runtime. A runtime permission the
// manifest omits is refused without a prompt, so the feature fails with no way for the user to allow
// it (Scan QR with the camera reported "Camera is not available on this device").
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const MANIFEST = path.resolve(import.meta.dirname, '../android/app/src/main/AndroidManifest.xml');
const manifest = readFileSync(MANIFEST, 'utf8');

function declaresPermission(name) {
  return manifest.includes(`<uses-permission android:name="android.permission.${name}" />`);
}

function optionalFeature(name) {
  const at = manifest.indexOf(`android:name="android.hardware.${name}"`);
  if (at < 0) return false;
  const end = manifest.indexOf('/>', at);
  if (end < 0) throw new Error(`unterminated uses-feature for ${name}`);
  return manifest.slice(at, end).includes('android:required="false"');
}

describe('Android manifest', () => {
  it('declares the camera permission the QR scanner asks for, as an optional feature', () => {
    expect(declaresPermission('CAMERA')).toBe(true);
    expect(optionalFeature('camera')).toBe(true);
  });

  it('declares the microphone permissions Reticulum voice messages and calls ask for', () => {
    // Capacitor's WebChromeClient requests both for an audio capture.
    expect(declaresPermission('RECORD_AUDIO')).toBe(true);
    expect(declaresPermission('MODIFY_AUDIO_SETTINGS')).toBe(true);
    expect(optionalFeature('microphone')).toBe(true);
  });
});
