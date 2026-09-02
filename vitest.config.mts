import { readdirSync } from 'node:fs';
import os from 'node:os';
import { join, relative, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import {
  resolveVitestProjectGroupOrder,
  resolveVitestProjectMaxWorkers,
  VITEST_CORE_DEPS,
  VITEST_SERVER_INLINE_DEPS,
} from './vitest.harness.mts';

const srcAlias = { '@': resolve(import.meta.dirname, 'src') };
const cpuCount = os.cpus().length;

/** Per-project CI shards skip global thresholds; merge job enforces them on combined coverage. */
const coverageThresholds =
  process.env.VITEST_COVERAGE_SHARD === '1'
    ? undefined
    : {
        lines: 54,
        functions: 52,
        branches: 46,
        statements: 52,
      };

/** Pure renderer unit tests — no RTL, no window, no setup stubs */
const RENDERER_LOGIC_INCLUDE = [
  'src/renderer/lib/**/*.test.ts',
  'src/renderer/stores/messageStore.test.ts',
  'src/renderer/stores/connectionStore.test.ts',
  'src/renderer/stores/nodeStore.meshcore-meshtastic.test.ts',
  'src/renderer/stores/nodeStore.test.ts',
  'src/renderer/hooks/meshcore/buildMeshcoreNodeMapFromDb.test.ts',
  'src/renderer/hooks/meshcore/meshcoreHookPreamble.crossTransport.test.ts',
  'src/renderer/hooks/openMeshCoreTransport.test.ts',
  'src/renderer/components/LogPanel.filtering.test.ts',
  'src/renderer/components/MentionAutocomplete.test.ts',
  'src/renderer/locales/locale-quality.test.ts',
  'src/renderer/appHandleResend.test.ts',
  'src/renderer/index.html.test.ts',
];

/** Borderline: needs localStorage / electronAPI / renderHook / navigator */
const RENDERER_LOGIC_EXCLUDE = [
  'src/renderer/hooks/useActiveMeshIdentity.test.ts',
  'src/renderer/hooks/useChatOutbox.test.ts',
  'src/renderer/hooks/useConnectionStatus.test.ts',
  'src/renderer/hooks/useConnectionView.test.ts',
  'src/renderer/hooks/useDbRefresh.test.ts',
  'src/renderer/hooks/useLatestTrackedPosition.test.ts',
  'src/renderer/hooks/useMeshcorePanelActions.test.ts',
  'src/renderer/hooks/useMeshcoreRepeaterRemoteAuth.test.tsx',
  'src/renderer/hooks/useMeshtasticPanelActions.test.ts',
  'src/renderer/hooks/useMeshtasticRuntime.favorited.test.ts',
  'src/renderer/hooks/useMeshtasticRuntime.emptyNode.test.ts',
  'src/renderer/hooks/useMeshtasticRuntime.selfNodeLastHeard.test.ts',
  'src/renderer/hooks/useNodeStatusNotifier.test.ts',
  'src/renderer/hooks/useNowMs.test.ts',
  'src/renderer/hooks/usePowerRecovery.test.ts',
  'src/renderer/hooks/useProtocolConnection.test.ts',
  'src/renderer/hooks/useProtocolFacade.test.ts',
  'src/renderer/hooks/useProtocolMqttSettings.test.ts',
  'src/renderer/hooks/useSendMessage.test.ts',
  'src/renderer/hooks/useSyncFormFromConfig.test.ts',
  'src/renderer/hooks/meshcore/meshcoreHookPreamble.reconcile.test.ts',
  'src/renderer/hooks/meshcore/meshcoreHookPreamble.resolvePubKey.test.ts',
  'src/renderer/lib/appSettingsStorage.test.ts',
  'src/renderer/lib/appWindowActivity.test.ts',
  'src/renderer/lib/bleReconnectHelper.test.ts',
  'src/renderer/lib/chatNotifications.test.ts',
  'src/renderer/lib/reticulumVoiceCallTones.test.ts',
  'src/renderer/lib/reticulumVoiceSession.test.ts',
  'src/renderer/lib/reticulumVoiceCapability.test.ts',
  'src/renderer/lib/chatPanelProtocolStorage.test.ts',
  'src/renderer/lib/chatScrollUtils.test.ts',
  'src/renderer/lib/confettiBurst.test.ts',
  'src/renderer/lib/connectedMeshcoreBleMac.test.ts',
  'src/renderer/lib/connection.ble-retry.test.ts',
  'src/renderer/lib/connection.serial-cleanup.test.ts',
  'src/renderer/lib/connectionPanelErrorHumanize.test.ts',
  'src/renderer/lib/controlledEditableValue.test.ts',
  'src/renderer/lib/debugSnapshot.test.ts',
  'src/renderer/lib/devElectronApiStub.test.ts',
  'src/renderer/lib/drivers/attachTypedPacketListener.test.ts',
  'src/renderer/lib/drivers/PacketRouter.test.ts',
  'src/renderer/lib/encryptedKeyBackupStorage.test.ts',
  'src/renderer/lib/fontScale.test.ts',
  'src/renderer/lib/gpsSource.test.ts',
  'src/renderer/lib/hydrateIdentityStoresFromDb.test.ts',
  'src/renderer/lib/ingest/meshtasticIngest.test.ts',
  'src/renderer/lib/ingest/meshcoreIngest.test.ts',
  'src/renderer/lib/letsMeshJwt.test.ts',
  'src/renderer/lib/messageRetention.test.ts',
  'src/renderer/lib/rrcMessagePersist.test.ts',
  'src/renderer/lib/rrcNickCacheHydrate.test.ts',
  'src/renderer/lib/rrcRoomHistory.test.ts',
  'src/renderer/lib/rrcLegacyWhispersMigrate.test.ts',
  'src/renderer/lib/nomad/micronParser.test.ts',
  'src/renderer/lib/nomad/nomadPageCache.test.ts',
  'src/renderer/lib/meshtasticBacklogUtils.test.ts',
  'src/renderer/lib/meshtasticDmKeyBackupStorage.test.ts',
  'src/renderer/lib/meshtasticMqttIdentity.test.ts',
  'src/renderer/lib/meshtasticMqttLiveIngest.test.ts',
  'src/renderer/lib/meshtasticMqttPublish.test.ts',
  'src/renderer/lib/meshtasticMqttSettingsStorage.test.ts',
  'src/renderer/lib/meshtasticRemoteAdminKeyStorage.test.ts',
  'src/renderer/lib/meshcore/meshcoreLiveContactPersist.test.ts',
  'src/renderer/lib/meshcore/meshcoreContactCapacityPush.test.ts',
  'src/renderer/lib/meshtastic/meshtasticTransportSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticTransportLossDetection.test.ts',
  'src/renderer/lib/meshtastic/meshtasticRuntimeWireEffects.post-reboot.test.ts',
  'src/renderer/lib/meshtastic/meshtasticRuntimeWireEffects.telemetry-nodeinfo.test.ts',
  'src/renderer/lib/meshtastic/meshtasticNodeSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticRawPacketSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticRouterSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticModulePortSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticStoreForwardSideEffects.test.ts',
  'src/renderer/lib/meshtastic/meshtasticTraceSideEffects.test.ts',
  'src/renderer/lib/meshtastic/transportDisplayNameCache.test.ts',
  'src/renderer/lib/meshcoreDualNobleBleInit.test.ts',
  'src/renderer/lib/meshcoreKeyBackupStorage.test.ts',
  'src/renderer/lib/meshcoreLateRfHopEnrichment.test.ts',
  'src/renderer/lib/meshcoreMqttSettingsStorage.test.ts',
  'src/renderer/lib/meshcoreContactAutoAdd.test.ts',
  'src/renderer/lib/meshcoreDbCacheHydration.repair.test.ts',
  'src/renderer/lib/meshcoreOwnNodeIds.test.ts',
  'src/renderer/lib/reticulumLastSelfLxmfHash.test.ts',
  'src/renderer/lib/reticulumOwnNodeIds.test.ts',
  'src/renderer/lib/meshcore/meshcoreRfRxRuntime.test.ts',
  'src/renderer/lib/meshcoreRoomCredentialStorage.test.ts',
  'src/renderer/lib/meshcoreRepeaterCredentialStorage.test.ts',
  'src/renderer/lib/meshcoreInfraAdminSecrets.test.ts',
  'src/renderer/lib/meshcorePerNodeCredentialStorage.test.ts',
  'src/renderer/lib/meshcoreRepeaterSavedSecrets.test.ts',
  'src/renderer/lib/meshcoreRepeaterSession.test.ts',
  'src/renderer/lib/meshcoreRoomSavedSecrets.test.ts',
  'src/renderer/lib/meshcoreRoomSession.test.ts',
  'src/renderer/lib/meshcoreRoomSyncStorage.test.ts',
  'src/renderer/lib/meshcoreStoreDedup.test.ts',
  'src/renderer/lib/meshcoreDirectMessageDecode.test.ts',
  'src/renderer/lib/mqttAutoLaunch.test.ts',
  'src/renderer/lib/mqttSettingsStorage.test.ts',
  'src/renderer/lib/protocols/meshcore/MeshCoreTransport.serial-writable.test.ts',
  'src/renderer/lib/reduceMotionPreference.test.ts',
  'src/renderer/lib/remoteSettingsStorage.test.ts',
  'src/renderer/lib/sendRncpRequestEnable.test.ts',
  'src/renderer/lib/applyRncpReceiveDestShare.test.ts',
  'src/renderer/lib/applyRncpReceiveDestShareFromChatHistory.test.ts',
  'src/renderer/lib/pushRncpListenerPolicy.test.ts',
  'src/renderer/lib/rncpListenerApply.test.ts',
  'src/renderer/lib/rncpTransferUiHelpers.test.ts',
  'src/renderer/lib/rfReconnectHelper.test.ts',
  'src/renderer/lib/reticulum/useReticulumSidecarApi.test.ts',
  'src/renderer/lib/reticulum/useReticulumInterfaceSnapshot.test.ts',
  'src/renderer/lib/reticulum/reticulumNobleBleYield.test.ts',
  'src/renderer/lib/reticulum/reticulumBleAdapterLease.test.ts',
  'src/renderer/lib/reticulum/reticulumAttachmentCache.test.ts',
  'src/renderer/lib/reticulum/reticulumDiagnosticSnapshot.test.ts',
  'src/renderer/lib/reticulum/reticulumGamesNotifications.test.ts',
  'src/renderer/lib/reticulum/catchUpInboundLxmf.test.ts',
  'src/renderer/components/NomadMicronPageView.test.tsx',
  'src/renderer/lib/serialPortSignature.test.ts',
  'src/renderer/lib/startupDbPrune.test.ts',
  'src/renderer/lib/storedMeshProtocol.test.ts',
  'src/renderer/lib/systemPowerState.test.ts',
  'src/renderer/lib/themeColors.test.ts',
  'src/renderer/lib/transport/TransportManager.test.ts',
  'src/renderer/lib/transportTcpIpc.test.ts',
  'src/renderer/lib/connection.tcp.test.ts',
  'src/renderer/lib/webbluetooth-ble-manager.test.ts',
  'src/renderer/lib/writeClipboardText.test.ts',
  'src/renderer/runtime/useMeshcoreRuntime.favorited-identity.test.ts',
  'src/renderer/runtime/useMeshcoreRuntime.reconnect.test.ts',
  'src/renderer/runtime/useMeshtasticRuntime.reconnect-hardening.test.ts',
  'src/renderer/stores/diagnosticsStore.foreignLora.test.ts',
  'src/renderer/stores/diagnosticsStore.test.ts',
  'src/renderer/stores/mapLayerStore.test.ts',
  'src/renderer/stores/mapViewportStore.test.ts',
  'src/renderer/stores/pathHistoryStore.test.ts',
  'src/renderer/stores/store-shapes.test.ts',
  'src/renderer/stores/watchedNodesStore.test.ts',
];

/** Glob in renderer-logic include; excluded from renderer-ui via RENDERER_UI_EXCLUDE filter below */
const RENDERER_LOGIC_LIB_GLOB = 'src/renderer/lib/**/*.test.ts';

/** Lib tests that need jsdom/setup — excluded from renderer-logic, routed to renderer-ui */
const RENDERER_LOGIC_LIB_UI_FALLBACK = new Set(
  RENDERER_LOGIC_EXCLUDE.filter((f) => f.startsWith('src/renderer/lib/')),
);

function collectRendererLibTestFiles(): string[] {
  const libRoot = join(import.meta.dirname, 'src/renderer/lib');
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(path);
      } else if (ent.name.endsWith('.test.ts')) {
        results.push(
          relative(import.meta.dirname, path)
            .split('\\')
            .join('/'),
        );
      }
    }
  };
  walk(libRoot);
  return results;
}

/** Pure lib unit tests owned by renderer-logic; borderline files run in renderer-ui instead */
const RENDERER_LOGIC_LIB_NODE_ONLY = collectRendererLibTestFiles().filter(
  (f) => !RENDERER_LOGIC_LIB_UI_FALLBACK.has(f),
);

/** renderer-ui skips tests that run in renderer-logic (node), not borderline jsdom lib tests */
const RENDERER_UI_EXCLUDE = [
  ...RENDERER_LOGIC_INCLUDE.filter((pattern) => pattern !== RENDERER_LOGIC_LIB_GLOB),
  ...RENDERER_LOGIC_LIB_NODE_ONLY,
];

export default defineConfig({
  server: {
    deps: {
      inline: [...VITEST_SERVER_INLINE_DEPS],
    },
  },
  ssr: {
    optimizeDeps: {
      include: [...VITEST_CORE_DEPS],
    },
  },
  test: {
    // Test environment strategy:
    // - renderer-ui: component/hook tests in jsdom with setup stubs.
    // - renderer-logic: pure renderer unit tests in node (no setup).
    // - main: main/shared/preload/scripts in node.
    // - Use file-level `// @vitest-environment ...` only as an explicit override.
    globals: true,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'renderer-ui',
          globals: true,
          environment: 'jsdom',
          setupFiles: [resolve(import.meta.dirname, 'src/renderer/vitest.setup.ts')],
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          exclude: RENDERER_UI_EXCLUDE,
          pool: 'forks',
          maxWorkers: resolveVitestProjectMaxWorkers('renderer-ui', cpuCount),
          isolate: true,
          fileParallelism: true,
          sequence: { groupOrder: resolveVitestProjectGroupOrder('renderer-ui') },
        },
        resolve: {
          alias: srcAlias,
        },
      },
      {
        test: {
          name: 'renderer-logic',
          globals: true,
          environment: 'node',
          include: RENDERER_LOGIC_INCLUDE,
          // RENDERER_LOGIC_LIB_GLOB in include matches all lib tests; exclude routes jsdom cases to renderer-ui.
          exclude: RENDERER_LOGIC_EXCLUDE,
          pool: 'threads',
          maxWorkers: resolveVitestProjectMaxWorkers('renderer-logic', cpuCount),
          isolate: true,
          fileParallelism: true,
          sequence: { groupOrder: resolveVitestProjectGroupOrder('renderer-logic') },
        },
        resolve: {
          alias: srcAlias,
        },
      },
      {
        test: {
          name: 'main',
          globals: true,
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/architecture/**/*.test.ts',
            'scripts/**/*.test.mjs',
            'vitest.harness.test.ts',
          ],
          pool: 'forks',
          maxWorkers: resolveVitestProjectMaxWorkers('main', cpuCount),
          isolate: true,
          fileParallelism: true,
          sequence: { groupOrder: resolveVitestProjectGroupOrder('main') },
        },
        resolve: {
          alias: srcAlias,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'cobertura'],
      reportOnFailure: true,
      include: ['src/main/**', 'src/preload/**', 'src/shared/**', 'src/renderer/**'],
      exclude: [
        '**/*.test.{ts,tsx,mjs}',
        '**/*.d.ts',
        'src/main/fixtures/**',
        'src/renderer/locales/**',
        'src/renderer/index.html',
        'src/renderer/vitest.setup.ts',
        'src/renderer/vitest.electronApiMock.ts',
      ],
      thresholds: coverageThresholds,
    },
  },
  resolve: {
    alias: srcAlias,
  },
});
