import { vi } from 'vitest';

/** Cold-mount MeshCore hydrate uses one batched IPC — prefer this over separate contact/message mocks. */
export function mockMeshcoreIdentityHydration(opts?: {
  contacts?: unknown[];
  nodes?: unknown[];
  hopHistory?: unknown[];
  messages?: unknown[];
}): void {
  vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
    contacts: opts?.contacts ?? [],
    nodes: (opts?.nodes ?? []) as never[],
    hopHistory: (opts?.hopHistory ?? []) as never[],
    messages: opts?.messages ?? [],
  });
}

/** Reset electronAPI mocks touched by useMeshcoreRuntime tests without vi.clearAllMocks(). */
export function resetMeshcoreRuntimeElectronMocks(): void {
  vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockClear();
  vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockClear();
  vi.mocked(window.electronAPI.db.getMeshcoreMessagesForHydration).mockClear();
  vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockClear();
  vi.mocked(window.electronAPI.connectGatt).mockClear();
  vi.mocked(window.electronAPI.disconnectGatt).mockClear();
  vi.mocked(window.electronAPI.db.getMeshcoreContacts).mockResolvedValue([]);
  vi.mocked(window.electronAPI.db.getMeshcoreMessages).mockResolvedValue([]);
  vi.mocked(window.electronAPI.db.getMeshcoreMessagesForHydration).mockResolvedValue([]);
  vi.mocked(window.electronAPI.db.getMeshcoreIdentityHydration).mockResolvedValue({
    contacts: [],
    nodes: [],
    hopHistory: [],
    messages: [],
  });
  vi.mocked(window.electronAPI.connectGatt).mockResolvedValue({ ok: true });
  vi.mocked(window.electronAPI.disconnectGatt).mockResolvedValue(undefined);
}

/** Reset electronAPI MQTT listener mocks used by Meshtastic runtime hook tests. */
export function resetMeshtasticMqttElectronMocks(): void {
  const mqtt = window.electronAPI.mqtt;
  vi.mocked(mqtt.onStatus).mockClear();
  vi.mocked(mqtt.onError).mockClear();
  vi.mocked(mqtt.onWarning).mockClear();
  vi.mocked(mqtt.onNodeUpdate).mockClear();
  vi.mocked(mqtt.onMessage).mockClear();
  vi.mocked(mqtt.onBrokerRaw).mockClear();
  vi.mocked(mqtt.onTraceRouteReply).mockClear();
  vi.mocked(mqtt.onClientId).mockClear();
  vi.mocked(mqtt.onMeshcoreChat).mockClear();
  vi.mocked(mqtt.onRequestTokenRefresh).mockClear();
  vi.mocked(mqtt.onStatus).mockReturnValue(() => {});
  vi.mocked(mqtt.onError).mockReturnValue(() => {});
  vi.mocked(mqtt.onWarning).mockReturnValue(() => {});
  vi.mocked(mqtt.onNodeUpdate).mockReturnValue(() => {});
  vi.mocked(mqtt.onMessage).mockReturnValue(() => {});
  vi.mocked(mqtt.onBrokerRaw).mockReturnValue(() => {});
  vi.mocked(mqtt.onTraceRouteReply).mockReturnValue(() => {});
  vi.mocked(mqtt.onClientId).mockReturnValue(() => {});
  vi.mocked(mqtt.onMeshcoreChat).mockReturnValue(() => {});
  vi.mocked(mqtt.onRequestTokenRefresh).mockReturnValue(() => {});
}
