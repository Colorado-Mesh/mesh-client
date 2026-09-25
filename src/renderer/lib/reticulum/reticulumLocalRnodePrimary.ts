export {
  countEnabledLocallyConnectedSerialInterfaces,
  isReticulumLocallyConnectedSerialInterface,
  isReticulumLocalSerialInterfaceType,
  pickDefaultPrimaryLocalSerialInterfaceId,
  resolveEffectivePrimaryLocalSerialInterfaceId,
  type ReticulumLocalSerialInterfaceRow,
} from '@/shared/reticulumLocalRnodePrimary';

import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';

export async function setReticulumPrimaryLocalSerialInterface(
  id: string,
): Promise<{ ok: boolean; reordered?: boolean; effectiveId?: string | null; error?: string }> {
  const body = (await window.electronAPI.reticulum.proxyPost(
    '/api/v1/interfaces/primary-local-rnode',
    { id },
  )) as {
    ok?: boolean;
    reordered?: boolean;
    effective_id?: string | null;
    error?: string;
  };
  invalidateReticulumInterfacesCache();
  return {
    ok: body.ok === true,
    reordered: body.reordered,
    effectiveId: body.effective_id ?? null,
    error: body.error,
  };
}
