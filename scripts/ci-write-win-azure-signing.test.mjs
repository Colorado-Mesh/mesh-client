import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildSigningOverlayConfig,
  isSigningActivated,
  OVERLAY_FILENAME,
  writeWinAzureSigningConfig,
} from './ci-write-win-azure-signing.mjs';

/** A full set of activating env vars. */
function fullEnv() {
  return {
    AZURE_CLIENT_ID: 'client-123',
    AZURE_TENANT_ID: 'tenant-123',
    AZURE_CLIENT_SECRET: 'secret-123',
    AZURE_SIGNING_ENDPOINT: 'https://wus2.codesigning.azure.net/',
    AZURE_SIGNING_ACCOUNT: 'colorado-mesh-signing',
    AZURE_SIGNING_PROFILE: 'mesh-client-profile',
    AZURE_SIGNING_PUBLISHER_NAME: 'Colorado Mesh',
  };
}

describe('isSigningActivated', () => {
  it('is true only when AZURE_CLIENT_ID is a non-empty string', () => {
    expect(isSigningActivated({ AZURE_CLIENT_ID: 'x' })).toBe(true);
    expect(isSigningActivated({ AZURE_CLIENT_ID: '  ' })).toBe(false);
    expect(isSigningActivated({ AZURE_CLIENT_ID: '' })).toBe(false);
    expect(isSigningActivated({})).toBe(false);
  });
});

describe('buildSigningOverlayConfig', () => {
  it('builds an extends overlay with all azureSignOptions coordinates', () => {
    const cfg = buildSigningOverlayConfig(fullEnv());
    expect(cfg.extends).toBe('./electron-builder.yml');
    expect(cfg.win.azureSignOptions).toEqual({
      endpoint: 'https://wus2.codesigning.azure.net/',
      codeSigningAccountName: 'colorado-mesh-signing',
      certificateProfileName: 'mesh-client-profile',
      publisherName: 'Colorado Mesh',
    });
  });

  it('trims whitespace from values', () => {
    const env = { ...fullEnv(), AZURE_SIGNING_PUBLISHER_NAME: '  Colorado Mesh  ' };
    expect(buildSigningOverlayConfig(env).win.azureSignOptions.publisherName).toBe('Colorado Mesh');
  });

  it('throws listing every missing coordinate when activation is on', () => {
    const env = { AZURE_CLIENT_ID: 'x' };
    expect(() => buildSigningOverlayConfig(env)).toThrow(/AZURE_SIGNING_ENDPOINT/);
    expect(() => buildSigningOverlayConfig(env)).toThrow(/AZURE_SIGNING_PUBLISHER_NAME/);
  });
});

describe('writeWinAzureSigningConfig', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'win-signing-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes nothing and returns null when signing is not activated', () => {
    const result = writeWinAzureSigningConfig({}, dir);
    expect(result).toBeNull();
    expect(existsSync(path.join(dir, OVERLAY_FILENAME))).toBe(false);
  });

  it('removes a stale overlay when signing is deactivated', () => {
    const overlayPath = path.join(dir, OVERLAY_FILENAME);
    writeFileSync(overlayPath, 'stale: true\n');
    const result = writeWinAzureSigningConfig({}, dir);
    expect(result).toBeNull();
    expect(existsSync(overlayPath)).toBe(false);
  });

  it('writes a valid extends overlay when activated', () => {
    const result = writeWinAzureSigningConfig(fullEnv(), dir);
    const overlayPath = path.join(dir, OVERLAY_FILENAME);
    expect(result).toBe(overlayPath);
    expect(existsSync(overlayPath)).toBe(true);

    const parsed = yaml.load(readFileSync(overlayPath, 'utf8'));
    expect(parsed.extends).toBe('./electron-builder.yml');
    expect(parsed.win.azureSignOptions.publisherName).toBe('Colorado Mesh');
    expect(parsed.win.azureSignOptions.endpoint).toBe('https://wus2.codesigning.azure.net/');
  });

  it('throws when activated but coordinates are incomplete', () => {
    expect(() => writeWinAzureSigningConfig({ AZURE_CLIENT_ID: 'x' }, dir)).toThrow(
      /required env vars are missing/,
    );
  });
});
