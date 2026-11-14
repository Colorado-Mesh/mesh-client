/**
 * Pure routing for a global / shared Scan QR control.
 * Surfaces apply their own side effects from the returned action.
 */

import { classifyMeshcoreQr } from '@/renderer/lib/meshcore/meshcoreQrIngest';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

export type ScanQrRouteAction =
  | { kind: 'meshcoreContact'; text: string }
  | {
      kind: 'meshcoreChannel';
      channel: { name: string; secretHex: string; regionScope?: string };
    }
  | { kind: 'meshtasticChannel'; url: string }
  | { kind: 'reticulum'; text: string }
  | { kind: 'unknown' };

/** Classify any supported mesh-client QR and pick the destination surface. */
export function routeScannedQr(text: string): ScanQrRouteAction {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'unknown' };

  const meshcore = classifyMeshcoreQr(trimmed);
  if (meshcore.kind === 'meshcoreContactAdd') {
    return { kind: 'meshcoreContact', text: trimmed };
  }
  if (meshcore.kind === 'meshcoreChannelAdd') {
    return {
      kind: 'meshcoreChannel',
      channel: {
        name: meshcore.name,
        secretHex: meshcore.secretHex,
        ...(meshcore.regionScope !== undefined ? { regionScope: meshcore.regionScope } : {}),
      },
    };
  }
  if (meshcore.kind === 'meshtasticChannel') {
    return { kind: 'meshtasticChannel', url: meshcore.url };
  }

  const parsed = classifyMeshClientDeepLink(trimmed);
  if (
    parsed.kind === 'lxmContact' ||
    parsed.kind === 'lxmaContact' ||
    parsed.kind === 'lxmPaperMessage' ||
    parsed.kind === 'lxmIdentity' ||
    parsed.kind === 'lxmGameSession'
  ) {
    return { kind: 'reticulum', text: trimmed };
  }

  return { kind: 'unknown' };
}
