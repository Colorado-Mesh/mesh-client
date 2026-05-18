/** Meshtastic node id while the Meshtastic radio is connected (for cross-protocol Foreign LoRa). */
let connectedMyNodeNum = 0;

export function setMeshtasticConnectedMyNodeNum(nodeNum: number): void {
  connectedMyNodeNum = nodeNum;
}

export function getMeshtasticConnectedMyNodeNum(): number {
  return connectedMyNodeNum;
}

/** Foreign LoRa is stored under the Meshtastic node id even when the UI protocol is MeshCore. */
export function resolveForeignLoraDiagnosticsNodeId(panelMyNodeNum: number): number {
  const mtNode = getMeshtasticConnectedMyNodeNum();
  return mtNode > 0 ? mtNode : panelMyNodeNum;
}
