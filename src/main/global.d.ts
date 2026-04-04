import type { MQTTSettings } from '../renderer/lib/types';

declare global {
  interface Window {
    electronAPI: {
      mqtt: {
        connect: (settings: MQTTSettings) => Promise<void>;
        disconnect: (protocol?: 'meshtastic' | 'meshcore') => Promise<void>;
        getClientId: (protocol?: 'meshtastic' | 'meshcore') => Promise<string>;
        refreshMeshcoreToken: (
          serverHost: string,
        ) => Promise<{ token: string; expiresAt: number } | null>;
        updateMeshcoreToken: (token: string, expiresAt: number) => Promise<void>;
      };
    };
  }
}
