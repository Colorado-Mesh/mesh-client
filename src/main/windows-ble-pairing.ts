/**
 * Windows-only: pair a Bluetooth LE device with a PIN using WinRT via PowerShell.
 * Noble (@stoprocent/noble) has no pairing API; this module fills the gap for Win32.
 *
 * The PowerShell script uses Register-ObjectEvent to handle WinRT's event-driven
 * PairingRequested callback, then calls PairAsync with DevicePairingKinds.ProvidePin.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface BlePairingResult {
  /** WinRT DevicePairingResultStatus string, e.g. "Paired", "AlreadyPaired", "Failed", "RejectedByHandler". */
  status: string;
  success: boolean;
}

/**
 * Pair a BLE device with the given PIN via WinRT on Windows 10/11.
 * @param address MAC address in colon ("20:6e:f1:b8:8d:99") or flat ("206ef1b88d99") format.
 * @param pin     6-digit (or shorter) numeric PIN shown on the device.
 */
export async function pairBleDeviceWithPin(
  address: string,
  pin: string,
): Promise<BlePairingResult> {
  const hex = address.replace(/:/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) throw new Error(`Invalid BLE address: ${address}`);
  if (!/^\d{1,6}$/.test(pin)) throw new Error('PIN must be 1–6 digits');

  // Values are sanitised above — safe to interpolate directly.
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
$null = [Windows.Devices.Enumeration.DevicePairingKinds,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
function Await($op) { $op.AsTask().GetAwaiter().GetResult() }
$addr = [Convert]::ToUInt64('${hex}',16)
$device = Await([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($addr))
if (-not $device) { Write-Output 'DeviceNotFound'; exit 0 }
$pairing = $device.DeviceInformation.Pairing
if ($pairing.IsPaired) { Write-Output 'AlreadyPaired'; exit 0 }
if (-not $pairing.CanPair) { Write-Output 'CannotPair'; exit 0 }
$custom = $pairing.Custom
$job = Register-ObjectEvent -InputObject $custom -EventName PairingRequested -MessageData '${pin}' -Action {
  $p = $Event.MessageData
  if ($EventArgs.PairingKind -eq [Windows.Devices.Enumeration.DevicePairingKinds]::ProvidePin) {
    $EventArgs.Accept($p)
  } else { $EventArgs.Accept() }
}
try {
  $kinds = [Windows.Devices.Enumeration.DevicePairingKinds]::ProvidePin -bor [Windows.Devices.Enumeration.DevicePairingKinds]::ConfirmOnly
  $result = Await($custom.PairAsync($kinds))
  Write-Output $result.Status.ToString()
} finally {
  $job | Stop-Job -ErrorAction SilentlyContinue
  $job | Remove-Job -Force -ErrorAction SilentlyContinue
}
`;

  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 30_000 },
  );

  if (stderr?.trim()) {
    console.warn('[windows-ble-pairing] PowerShell stderr:', stderr.trim());
  }

  const status = (stdout ?? '').trim();
  const success = status === 'Paired' || status === 'AlreadyPaired';
  return { status, success };
}
