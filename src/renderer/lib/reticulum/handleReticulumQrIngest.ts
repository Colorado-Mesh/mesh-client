/**
 * Shared Reticulum QR / paste ingest for Network Scan / import, Chat, and deep-link host.
 * Classifies contact / lxma / paper / identity cards and applies them.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  applyLxmaContactImport,
  applyLxmContactImport,
  applyLxmPaperIngest,
} from '@/renderer/lib/meshClientDeepLinkApply';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

export interface ReticulumQrIngestToast {
  key: string;
  variant: 'success' | 'error';
  params?: Record<string, string>;
}

export type ReticulumQrIngestOutcome =
  { handled: true; toast: ReticulumQrIngestToast } | { handled: false };

/**
 * Handle a decoded QR / pasted string for Reticulum-capable surfaces.
 * Contact / lxma imports apply immediately (no confirm modal) — matches Network panel today.
 * Paper ingest calls the sidecar; OS deep-link host may still confirm contacts separately.
 */
export async function handleReticulumQrIngest(text: string): Promise<ReticulumQrIngestOutcome> {
  const parsed = classifyMeshClientDeepLink(text);
  try {
    if (parsed.kind === 'lxmPaperMessage') {
      const result = await applyLxmPaperIngest({ uri: parsed.uri });
      return {
        handled: true,
        toast: {
          key: result.ok ? 'qrIngest.paperIngested' : result.errorKey,
          variant: result.ok ? 'success' : 'error',
        },
      };
    }
    if (parsed.kind === 'lxmContact') {
      const result = await applyLxmContactImport({
        destinationHash: parsed.destinationHash,
        name: parsed.name ?? null,
      });
      return {
        handled: true,
        toast: {
          key: result.ok ? 'qrIngest.contactImported' : result.errorKey,
          variant: result.ok ? 'success' : 'error',
        },
      };
    }
    if (parsed.kind === 'lxmaContact') {
      const result = await applyLxmaContactImport({
        destinationHash: parsed.destinationHash,
        publicKeyHex: parsed.publicKeyHex,
      });
      return {
        handled: true,
        toast: {
          key: result.ok ? 'qrIngest.contactImported' : result.errorKey,
          variant: result.ok ? 'success' : 'error',
        },
      };
    }
    if (parsed.kind === 'lxmIdentity') {
      return {
        handled: true,
        toast: { key: 'qrIngest.identityShown', variant: 'success' },
      };
    }
    return {
      handled: true,
      toast: { key: 'qrIngest.unknownLink', variant: 'error' },
    };
  } catch (err) {
    console.error('[handleReticulumQrIngest] failed: ' + errLikeToLogString(err));
    return {
      handled: true,
      toast: { key: 'qrIngest.unknownLink', variant: 'error' },
    };
  }
}
