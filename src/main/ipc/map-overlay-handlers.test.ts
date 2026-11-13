// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  assertIpcSender: vi.fn(),
  dialogResult: { canceled: true, filePaths: [] as string[] },
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(() => Promise.resolve(harness.dialogResult)),
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      harness.handlers.set(channel, fn);
    },
  },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: (...args: unknown[]) => harness.assertIpcSender(...args),
}));

vi.mock('../map-overlays/importOverlay', () => ({
  importMapOverlayFromPath: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      name: 't',
      geojson: { type: 'FeatureCollection' as const, features: [] },
    }),
  ),
}));

import { registerMapOverlayIpcHandlers } from './map-overlay-handlers';

describe('registerMapOverlayIpcHandlers', () => {
  beforeEach(() => {
    harness.handlers.clear();
    harness.assertIpcSender.mockReset().mockImplementation(() => {});
    harness.dialogResult = { canceled: true, filePaths: [] };
    registerMapOverlayIpcHandlers(() => null);
  });

  it('registers mapOverlays:import with assertIpcSender', async () => {
    expect(harness.handlers.has('mapOverlays:import')).toBe(true);
    const event = {} as IpcMainInvokeEvent;
    await harness.handlers.get('mapOverlays:import')!(event);
    expect(harness.assertIpcSender).toHaveBeenCalledWith(event, 'mapOverlays:import');
  });
});
