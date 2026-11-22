/**
 * Source contracts: keep cross-protocol USB yield wired so MeshCore cannot hit
 * "port already open" when Meshtastic still holds the same Web Serial device.
 */
import { describe, expect, it } from 'vitest';

import { loadRendererLibSource, loadRuntimeSource } from './sourceContractTestHelpers';

const CONNECTION = loadRendererLibSource('connection.ts');
const MESHCORE_TRANSPORT = loadRendererLibSource('protocols/meshcore/MeshCoreTransport.ts');
const MESHCOM_TRANSPORT = loadRendererLibSource('protocols/meshcom/MeshComTransport.ts');
const SERIAL_PORT_CLAIM = loadRendererLibSource('serialPortClaim.ts');
const CONNECTION_PANEL = loadRendererLibSource('../components/ConnectionPanel.tsx');
const MESHTASTIC_RUNTIME = loadRuntimeSource('useMeshtasticRuntime.ts');
const MESHCORE_RUNTIME = loadRuntimeSource('useMeshcoreRuntime.ts');
const MESHCOM_RUNTIME = loadRuntimeSource('useMeshcomRuntime.ts');

function assertReleaseBeforeClose(source: string, label: string): void {
  const releaseIdx = source.indexOf('releaseConflictingSerialSessions(');
  const closeIdx = source.indexOf('closeSerialPortIfOpen(');
  expect(releaseIdx, `${label}: missing releaseConflictingSerialSessions`).toBeGreaterThan(-1);
  expect(closeIdx, `${label}: missing closeSerialPortIfOpen`).toBeGreaterThan(-1);
  expect(releaseIdx, `${label}: release must run before closeSerialPortIfOpen`).toBeLessThan(
    closeIdx,
  );
}

describe('cross-protocol serial claim contracts', () => {
  it('MeshCore connectSerial and reconnectMeshcoreSerial yield before close/open', () => {
    expect(MESHCORE_TRANSPORT).toMatch(
      /async function connectSerial[\s\S]*?releaseConflictingSerialSessions\('meshcore'/,
    );
    expect(MESHCORE_TRANSPORT).toMatch(
      /export async function reconnectMeshcoreSerial[\s\S]*?releaseConflictingSerialSessions\('meshcore'/,
    );
    const connectSerial = MESHCORE_TRANSPORT.slice(
      MESHCORE_TRANSPORT.indexOf('async function connectSerial'),
      MESHCORE_TRANSPORT.indexOf('export async function reconnectMeshcoreSerial'),
    );
    assertReleaseBeforeClose(connectSerial, 'connectSerial');
    const reconnect = MESHCORE_TRANSPORT.slice(
      MESHCORE_TRANSPORT.indexOf('export async function reconnectMeshcoreSerial'),
      MESHCORE_TRANSPORT.indexOf('// ─── BLE'),
    );
    assertReleaseBeforeClose(reconnect, 'reconnectMeshcoreSerial');
  });

  it('Meshtastic createConnection serial and reconnectSerial yield before open', () => {
    expect(CONNECTION).toMatch(
      /serialApi\.requestPort = async[\s\S]*?releaseConflictingSerialSessions\('meshtastic'/,
    );
    expect(CONNECTION).toMatch(
      /export async function reconnectSerial[\s\S]*?releaseConflictingSerialSessions\('meshtastic'/,
    );
    const reconnectStart = CONNECTION.indexOf('export async function reconnectSerial');
    const reconnect = CONNECTION.slice(
      reconnectStart,
      CONNECTION.indexOf('export async function safeDisconnect', reconnectStart),
    );
    assertReleaseBeforeClose(reconnect, 'reconnectSerial');
  });

  it('MeshCom serial connect yields before close/open', () => {
    expect(MESHCOM_TRANSPORT).toMatch(/await releaseConflictingSerialSessions\('meshcom', port\)/);
    const connectBody = MESHCOM_TRANSPORT.slice(
      MESHCOM_TRANSPORT.indexOf('async connect(): Promise<void>'),
      MESHCOM_TRANSPORT.indexOf('private async startReadLoop'),
    );
    assertReleaseBeforeClose(connectBody, 'MeshComTransport.connect');
  });

  it('ConnectionPanel serial Connect cancels all LoRa RF auto-connects', () => {
    expect(CONNECTION_PANEL).toContain('cancelAllLoraRfAutoConnect');
    expect(CONNECTION_PANEL).toMatch(/from ['"]@\/renderer\/lib\/serialPortClaim['"]/);
    expect(CONNECTION_PANEL).toMatch(
      /if \(connectionType === 'serial'\) \{\s*cancelAllLoraRfAutoConnect\(\);/,
    );
  });

  it('serialPortClaim yields LoRa holders and cancels their auto-connect', () => {
    expect(SERIAL_PORT_CLAIM).toContain('cancelProtocolRfAutoConnect(protocol)');
    expect(SERIAL_PORT_CLAIM).toContain('await target.releaseHold()');
    expect(SERIAL_PORT_CLAIM).toMatch(/'meshtastic',\s*'meshcore',\s*'meshcom'/);
  });

  it('serial open paths log isSerialConnected snapshot on claim and open failure', () => {
    expect(SERIAL_PORT_CLAIM).toContain('logLoraSerialConnectedSnapshot(');
    expect(SERIAL_PORT_CLAIM).toContain("logLoraSerialConnectedSnapshot('open', claimingProtocol)");
    expect(MESHCORE_TRANSPORT).toContain(
      "logLoraSerialConnectedSnapshot('open failed', 'meshcore')",
    );
    expect(CONNECTION).toContain("logLoraSerialConnectedSnapshot('open failed', 'meshtastic')");
    expect(MESHCOM_TRANSPORT).toContain("logLoraSerialConnectedSnapshot('open failed', 'meshcom')");
  });

  it('ConnectionPanel passes inAppHolders into humanizeSerialError', () => {
    expect(CONNECTION_PANEL).toContain('listInAppSerialHolders');
    expect(CONNECTION_PANEL).toMatch(
      /humanizeSerialError\(err, t, \{\s*inAppHolders: listInAppSerialHolders\(protocol\)/,
    );
  });

  it('runtimes register releaseHold for serial disconnect targets', () => {
    expect(MESHTASTIC_RUNTIME).toMatch(
      /registerMeshtasticSerialDisconnectTarget\(\{[\s\S]*?releaseHold:/,
    );
    expect(MESHCORE_RUNTIME).toMatch(
      /registerMeshcoreSerialDisconnectTarget\(\{[\s\S]*?releaseHold:/,
    );
    expect(MESHCOM_RUNTIME).toMatch(
      /registerMeshcomSerialDisconnectTarget\(\{[\s\S]*?releaseHold:/,
    );
  });
});
