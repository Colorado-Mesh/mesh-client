import type { MeshProtocol } from '@/shared/meshProtocol';

export interface ProtocolTheme {
  displayName: string;
  ariaSwitchKey: string;
  headerBorderConfigured: string;
  pillActiveClass: string;
  pillInactiveClass: string;
  unreadBadgeFillClass: string;
}

export const PROTOCOL_THEME: Record<MeshProtocol, ProtocolTheme> = {
  meshtastic: {
    displayName: 'Meshtastic',
    ariaSwitchKey: 'aria.switchToMeshtastic',
    headerBorderConfigured: 'border-brand-green/20',
    pillActiveClass: 'bg-brand-green/20 text-brand-green',
    pillInactiveClass: 'text-gray-400 hover:bg-gray-800 hover:text-gray-300',
    unreadBadgeFillClass: 'bg-readable-green',
  },
  meshcore: {
    displayName: 'MeshCore',
    ariaSwitchKey: 'aria.switchToMeshCore',
    headerBorderConfigured: 'border-cyan-500/20',
    pillActiveClass: 'bg-cyan-600/20 text-cyan-400',
    pillInactiveClass: 'text-gray-400 hover:bg-gray-800 hover:text-gray-300',
    unreadBadgeFillClass: 'bg-cyan-800 text-white',
  },
  reticulum: {
    displayName: 'Reticulum',
    ariaSwitchKey: 'aria.switchToReticulum',
    headerBorderConfigured: 'border-amber-500/20',
    pillActiveClass: 'bg-amber-600/20 text-amber-400',
    pillInactiveClass: 'text-gray-400 hover:bg-gray-800 hover:text-gray-300',
    unreadBadgeFillClass: 'bg-amber-800 text-white',
  },
};

export function protocolHeaderBorderClass(protocol: MeshProtocol, isConfigured: boolean): string {
  if (!isConfigured) return 'border-gray-700';
  return PROTOCOL_THEME[protocol].headerBorderConfigured;
}
