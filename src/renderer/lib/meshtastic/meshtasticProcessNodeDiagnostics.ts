import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { MESHTASTIC_CAPABILITIES } from '../radio/BaseRadioProvider';
import { getStoredMeshProtocol } from '../storedMeshProtocol';
import type { MeshNode } from '../types';

export function processMeshtasticNodeDiagnostics(
  node: MeshNode,
  myNodeNum: number,
  homeNode: MeshNode | null,
): void {
  if (getStoredMeshProtocol() !== 'meshtastic') return;
  useDiagnosticsStore
    .getState()
    .processNodeUpdate(node, homeNode, myNodeNum, MESHTASTIC_CAPABILITIES);
}
