/** BLE MAC / peripheral id of the live MeshCore RF link (null when not BLE-connected). */
let connectedMeshcoreBleMac: string | null = null;

/** Called from MeshCore runtime when a BLE session connects or disconnects. */
export function setConnectedMeshcoreBleMac(mac: string | null): void {
  const trimmed = mac?.trim() ?? '';
  connectedMeshcoreBleMac = trimmed.length > 0 ? trimmed : null;
}

export function getConnectedMeshcoreBleMac(): string | null {
  return connectedMeshcoreBleMac;
}

/** Test helper — reset module state between cases. */
export function resetConnectedMeshcoreBleMacForTests(): void {
  connectedMeshcoreBleMac = null;
}
