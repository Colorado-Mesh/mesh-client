import { describe, expect, it, vi } from 'vitest';

import {
  areElectronBundlesReady,
  waitForDevReady,
  DEV_ELECTRON_BUNDLE_PATHS,
} from './wait-for-dev.mjs';

describe('wait-for-dev', () => {
  it('areElectronBundlesReady requires non-empty files for main and preload', () => {
    const statSync = vi.fn((filePath) => {
      if (filePath.endsWith('preload/index.js')) {
        return { isFile: () => true, size: 100 };
      }
      if (filePath.endsWith('main/index.js')) {
        return { isFile: () => false, size: 100 };
      }
      throw new Error('missing');
    });

    expect(
      areElectronBundlesReady(
        { main: '/tmp/main/index.js', preload: '/tmp/preload/index.js' },
        statSync,
      ),
    ).toBe(false);
  });

  it('waitForDevReady resolves only when vite and bundles are both ready', async () => {
    let viteUp = false;
    let bundlesReady = false;
    const sleep = vi.fn(async () => {
      if (!viteUp) viteUp = true;
      else bundlesReady = true;
    });

    const isPortOpen = vi.fn(async () => viteUp);
    const paths = { main: '/tmp/main/index.js', preload: '/tmp/preload/index.js' };
    const statSync = vi.fn(() => ({
      isFile: () => true,
      size: bundlesReady ? 100 : 0,
    }));

    await waitForDevReady({
      paths,
      isPortOpen,
      statSync,
      sleep,
      intervalMs: 1,
    });

    expect(isPortOpen).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalled();
    expect(statSync).toHaveBeenCalled();
  });
});

it('requires the translation worker before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.translation).toContain('translation-worker.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('translation-worker.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the summary prompt chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.summaryPrompt).toContain('ai-summary-prompt.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('ai-summary-prompt.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the follow-up prompt chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.followUpPrompt).toContain('ai-follow-up-prompt.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('ai-follow-up-prompt.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the summarize prompt-prepare chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.summarizePromptPrepare).toContain(
    'ai-summarize-prompt-prepare.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('ai-summarize-prompt-prepare.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the local models catalog chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.localModels).toContain('ai-local-models.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('ai-local-models.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the native AI runtime chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.nativeAiRuntime).toContain('ai-native-runtime.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('ai-native-runtime.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the identity hydration chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.identityHydration).toContain('identity-hydration.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('identity-hydration.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the team roster chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.teamRoster).toContain('team-roster-handlers.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('team-roster-handlers.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the MeshCom db + UDP bridge chunks before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.meshcomDb).toContain('meshcom-db-handlers.js');
  expect(DEV_ELECTRON_BUNDLE_PATHS.meshcomDbFallback).toContain('meshcom-db-handlers-fallback.js');
  expect(DEV_ELECTRON_BUNDLE_PATHS.udpBridge).toContain('udp-bridge.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('meshcom-db-handlers.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('udp-bridge.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the team roster fallback chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.teamRosterFallback).toContain(
    'team-roster-handlers-fallback.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('team-roster-handlers-fallback.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the environment telemetry chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.environmentTelemetry).toContain(
    'environment-telemetry-handlers.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('environment-telemetry-handlers.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the environment telemetry fallback chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.environmentTelemetryFallback).toContain(
    'environment-telemetry-handlers-fallback.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('environment-telemetry-handlers-fallback.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the reach check chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.reachCheck).toContain('reach-check-handlers.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('reach-check-handlers.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the regional map (beacon) chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.beacon).toContain('beacon-handlers.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('beacon-handlers.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the tray unread-dot chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.trayUnreadDot).toContain('tray-unread-dot.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('tray-unread-dot.js')) throw new Error('not built');
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the scheduled-broadcasts rebuild chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.scheduledBroadcastsRebuild).toContain(
    'scheduled-broadcasts-interval-rebuild.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('scheduled-broadcasts-interval-rebuild.js')) {
        throw new Error('not built');
      }
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the MQTT publishWaypoint validation chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.mqttPublishWaypointValidation).toContain(
    'mqtt-publish-waypoint-validation.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('mqtt-publish-waypoint-validation.js')) {
        throw new Error('not built');
      }
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the notification SoundPlayer chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.notificationSoundPlayWav).toContain(
    'notification-sound-play-wav.js',
  );
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('notification-sound-play-wav.js')) {
        throw new Error('not built');
      }
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the nodes upsert chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.nodeUpsert).toContain('node-upsert.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('node-upsert.js')) {
        throw new Error('not built');
      }
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});

it('requires the MeshCore MQTT pool chunk before launching Electron', () => {
  expect(DEV_ELECTRON_BUNDLE_PATHS.meshcoreMqttPool).toContain('meshcore-mqtt-pool.js');
  expect(
    areElectronBundlesReady(DEV_ELECTRON_BUNDLE_PATHS, (file) => {
      if (file.endsWith('meshcore-mqtt-pool.js')) {
        throw new Error('not built');
      }
      return { isFile: () => true, size: 1 };
    }),
  ).toBe(false);
});
