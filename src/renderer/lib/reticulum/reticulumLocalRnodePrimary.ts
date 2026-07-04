export {
  countEnabledLocallyConnectedSerialInterfaces,
  isReticulumLocallyConnectedSerialInterface,
  isReticulumLocalSerialInterfaceType,
  pickDefaultPrimaryLocalSerialInterfaceId,
  resolveEffectivePrimaryLocalSerialInterfaceId,
  type ReticulumLocalSerialInterfaceRow,
} from '@/shared/reticulumLocalRnodePrimary';

import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';

export interface ReticulumInterfacesListResponse {
  interfaces?: {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    serial_port?: string | null;
  }[];
  primary_local_serial_interface_id?: string | null;
  effective_primary_local_serial_interface_id?: string | null;
}

export async function fetchReticulumInterfacesWithPrimary(): Promise<{
  interfaces: NonNullable<ReticulumInterfacesListResponse['interfaces']>;
  primaryLocalSerialInterfaceId: string | null;
  effectivePrimaryLocalSerialInterfaceId: string | null;
}> {
  const body = (await window.electronAPI.reticulum.proxyGet(
    '/api/v1/interfaces',
  )) as ReticulumInterfacesListResponse;
  return {
    interfaces: body.interfaces ?? [],
    primaryLocalSerialInterfaceId: body.primary_local_serial_interface_id ?? null,
    effectivePrimaryLocalSerialInterfaceId:
      body.effective_primary_local_serial_interface_id ?? null,
  };
}

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
