import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';

interface ReticulumStackAutostartCoordinatorProps {
  connecting: boolean;
  onStartStack: () => Promise<void>;
  enabled?: boolean;
}

/**
 * Keeps Reticulum sidecar autostart alive while ConnectionPanel is tab-mounted only for the
 * active protocol. Without this, cold start on Meshtastic/MeshCore never starts the stack.
 */
export function ReticulumStackAutostartCoordinator({
  connecting,
  onStartStack,
  enabled = true,
}: ReticulumStackAutostartCoordinatorProps) {
  useReticulumSidecarApi({
    connecting,
    onStartStack,
    enableAutostart: enabled,
  });
  return null;
}
