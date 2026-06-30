import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';

export interface ReticulumIdentityStatus {
  configured: boolean;
  lxmfHash: string | null;
}

/** Fetch sidecar identity status (shared by runtime and connection/radio panels). */
export async function fetchReticulumIdentityStatus(): Promise<ReticulumIdentityStatus> {
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identity/status')) as {
      configured?: boolean;
      lxmf_hash?: string;
    };
    const lxmfHash = body.configured && body.lxmf_hash ? body.lxmf_hash : null;
    if (lxmfHash) {
      registerReticulumDestinationHash(reticulumHashToNodeId(lxmfHash), lxmfHash);
    }
    return { configured: Boolean(body.configured), lxmfHash };
  } catch (e) {
    console.debug('[reticulumSidecarReads] identity status ' + errLikeToLogString(e));
    return { configured: false, lxmfHash: null };
  }
}
