// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const PRELOAD_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');
const TYPES_SOURCE = readFileSync(join(__dirname, '../shared/electron-api.types.ts'), 'utf-8');

/** Top-level electronAPI namespaces declared on ElectronAPI in shared types. */
const EXPECTED_TOP_LEVEL_KEYS = [
  'db',
  'mqtt',
  'update',
  'clipboard',
  'notify',
  'safeStorage',
  'appSettings',
  'meshcore',
  'http',
  'tak',
  'chat',
  'log',
];

describe('preload bridge contract', () => {
  it('exposes electronAPI via contextBridge', () => {
    expect(PRELOAD_SOURCE).toContain("contextBridge.exposeInMainWorld('electronAPI'");
  });

  it('declares expected top-level namespaces on electronAPI', () => {
    for (const key of EXPECTED_TOP_LEVEL_KEYS) {
      expect(PRELOAD_SOURCE).toContain(`${key}: {`);
    }
  });

  it('ElectronAPI interface documents db namespace', () => {
    expect(TYPES_SOURCE).toMatch(/db:\s*\{/);
    expect(TYPES_SOURCE).toContain('getMessages:');
    expect(TYPES_SOURCE).toContain('saveMessage:');
  });

  it('preload invokes chat export IPC', () => {
    expect(PRELOAD_SOURCE).toContain("'chat:export'");
  });
});
