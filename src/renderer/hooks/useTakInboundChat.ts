import { useEffect } from 'react';

import { relayTakChatToMesh } from '../lib/tak/takInboundChat';
import { sendTakTextOnMesh } from '../lib/tak/takMeshSend';

/**
 * Sends GeoChat messages from local TAK clients on the mesh channels bridged to their room, for
 * channels the user allowed TAK to send to. Mount once from AppContent.
 */
export function useTakInboundChat(): void {
  useEffect(() => {
    return window.electronAPI.tak.onInboundChat((message) => {
      void relayTakChatToMesh(message, sendTakTextOnMesh);
    });
  }, []);
}
