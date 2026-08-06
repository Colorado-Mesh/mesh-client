/**
 * MeshCore TCP init tolerates peer FIN after the contacts burst is captured.
 * Shared predicate for initConn / getChannels skip paths.
 */
export function isMeshcoreTcpBurstDeadBridge(opts: {
  transportType: string;
  burstCaptured: boolean;
  bridgeDead: boolean;
}): boolean {
  return opts.transportType === 'tcp' && opts.burstCaptured && opts.bridgeDead;
}
