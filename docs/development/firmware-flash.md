# Device firmware flash (Meshtastic + MeshCore)

Developer reference for the USB firmware flasher in the **Admin** tab. Operator guide: [firmware.md](../firmware.md). RNode flashing is a separate path: [Reticulum — Admin (RNode flasher)](../reticulum.md#admin-rnode-flasher).

## Layout

| Piece                                                                                         | Path                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| UI section (state machine, blockers, warnings, flash/cancel)                                  | `src/renderer/components/flasher/DeviceFirmwareFlashSection.tsx`                                                                              |
| Mount point (local USB only, collapsible, `data-setting-anchor="admin.firmware.flashDevice"`) | `src/renderer/components/AdminPanel.tsx`                                                                                                      |
| `firmwareFlashDevice` assembly from connection state                                          | `buildDetectedFlashDevice` in `src/renderer/lib/flasher/deviceFirmwareBoards.ts`, called from `App.tsx`                                       |
| Supported-board matrix + detection                                                            | `src/renderer/lib/flasher/deviceFirmwareBoards.ts` (`DEVICE_FLASH_BOARDS`, `detectDeviceFlashBoard`)                                          |
| Preflight gate (blockers + warnings, pure)                                                    | `src/renderer/lib/flasher/deviceFirmwarePreflight.ts` (`evaluateFlashPreflight`, `FLASH_MIN_BATTERY_PERCENT`)                                 |
| Image planning/validation (pure)                                                              | `src/renderer/lib/flasher/deviceFirmwareImage.ts` (`planDeviceFirmware`, `DeviceFirmwareError`)                                               |
| Flash orchestration                                                                           | `src/renderer/lib/flasher/deviceFirmwareFlash.ts` (`runDeviceFirmwareFlash`, `assertPlanMatchesBoard`)                                        |
| ESP32 writer (esptool-js)                                                                     | `src/renderer/lib/flasher/esp32Flasher.ts` (`flashEsp32Images`), `esp32BootloaderEntry.ts`, `prepareEsp32PortForFlash.ts`                     |
| nRF52 serial DFU writer                                                                       | `src/renderer/lib/flasher/nrf52DfuFlasher.ts` (`Nrf52DfuFlasher`, `nrf52DfuCrc16`)                                                            |
| Serial port helpers                                                                           | `src/renderer/lib/flasher/flasherSerial.ts`, `flasherSessionPort.ts`; picker in `FlasherSerialPortPicker.tsx` + `useElectronSerialPortPicker` |
| Error text for transport failures                                                             | `src/renderer/lib/flasher/flasherErrorHumanize.ts` (`flasher.errors.*`)                                                                       |
| Shared button/progress/DFU controls                                                           | `flasherStepButtonStyles.ts`, `FlashProgress.tsx`, `DfuModeTrigger.tsx`                                                                       |
| Size cap                                                                                      | `FIRMWARE_BACKUP_MAX_BYTES` in `src/shared/firmwareBackup.ts` (32 MiB)                                                                        |
| Capability                                                                                    | `hasDeviceFirmwareFlash` in `src/renderer/lib/radio/BaseRadioProvider.ts` (true for Meshtastic and MeshCore, false for Reticulum)             |
| Release URLs + update check                                                                   | `src/renderer/lib/firmwareCheck.ts`; toast in `FirmwareUpdateNotifier.tsx`; indicator in `FirmwareStatusIndicator.tsx`                        |
| Search index                                                                                  | `src/renderer/lib/settingsSearchEntries/admin.ts` (`admin.firmware.flashDevice`; `deviceFirmware.*` exempt)                                   |
| Copy                                                                                          | `deviceFirmware.*` and `flasher.*` in `src/renderer/locales/en/translation.json`                                                              |

Everything runs in the renderer over Web Serial. There is no main-process or IPC path: no new `ipcMain` channel is involved, and nothing is downloaded.

## Boards

`DEVICE_FLASH_BOARDS` is the whole supported set (fail closed):

| Id                     | Family     | Notes                                                 |
| ---------------------- | ---------- | ----------------------------------------------------- |
| `meshtastic:heltec-v3` | `esp32s3`  | `meshtasticHwModel` 43, slug `heltec-v3`, 8 MiB flash |
| `meshtastic:tbeam`     | `esp32`    | `meshtasticHwModel` 4, slug `tbeam`, 4 MiB flash      |
| `meshtastic:rak4631`   | `nrf52840` | `meshtasticHwModel` 9, slug `rak4631`                 |
| `meshcore:heltec-v3`   | `esp32s3`  | prefix `heltec_v3`, model key `heltecv3`, 8 MiB flash |
| `meshcore:rak4631`     | `nrf52840` | prefix `rak_4631`, model key `rak4631`                |

Add a board only after its factory image layout, chip id, and bootloader entry are verified. Ids are `<protocol>:<slug>` and unique across protocols.

## Contracts and invariants

- **Fail closed.** An unlisted board, an unrecognized file name, an ambiguous archive, or any header mismatch throws `DeviceFirmwareError` (typed `code`, optional `detail`) instead of guessing. Add new codes to both `ERROR_KEYS` in the component and `deviceFirmware.errors.*`.
- **Detection.** `detectDeviceFlashBoard` returns `matched` (selection locked to the live radio), `unsupported` (blocks), or `unknown` (disconnected or no model reported: manual pick plus the `unverifiedBoard` warning). Meshtastic matches the numeric `hw_model` first, then a legacy branded label. MeshCore matches the normalized (`[a-z0-9]` only) `deviceQuery` manufacturer/model against `meshcoreModelKeys`. Live detection wins over `manualBoardId`.
- **Plans are never stale.** The component re-plans on every change of file, board, or expected digest, and only uses a `PlanResult` whose `file`, `boardId`, and `expectedSha` still match the current inputs. Files over `FIRMWARE_BACKUP_MAX_BYTES` are refused before they are read into memory.
- **Acknowledgement is bound** to `${board.id}:${payloadSha256}` and cleared after every flash attempt (`finally`).
- **Preflight is pure.** `evaluateFlashPreflight` has no I/O. `canFlash` is true only with no blockers.

  | Blocker id             | Condition                                                                        |
  | ---------------------- | -------------------------------------------------------------------------------- |
  | `noBoard`              | No board selected and detection is not `unsupported`                             |
  | `boardUnsupported`     | Detection `unsupported`                                                          |
  | `boardMismatch`        | Detection `matched` but selection differs (stale or forged selection)            |
  | `serialConnectionOpen` | Radio connected over `serial` (the app owns the port)                            |
  | `lowBattery`           | Connected, battery below `FLASH_MIN_BATTERY_PERCENT` (30), not reported charging |
  | `noImage`              | No validated plan                                                                |
  | `notAcknowledged`      | Checklist not ticked                                                             |

  | Warning id                          | Condition                             |
  | ----------------------------------- | ------------------------------------- |
  | `cable`                             | Always                                |
  | `batteryUnknown`                    | Battery not a number                  |
  | `espBootloader` / `nrf52Bootloader` | By board family                       |
  | `settingsReset`                     | Any non-nRF52 board                   |
  | `connectionDrops`                   | Connected over a non-serial transport |
  | `unverifiedBoard`                   | Detection `unknown`                   |

  `BLOCKER_KEYS`, `WARNING_KEYS`, and `ERROR_KEYS` in the component are `Record<…Id, string>` maps: adding an id to the union forces a locale key at compile time.

- **Image rules (`deviceFirmwareImage.ts`).**
  - Meshtastic ESP32: `firmware-<slug>-<version>.factory.bin`. Meshtastic nRF52: `firmware-<slug>-<version>.zip`, with an optional `-ota` suffix.
  - MeshCore: `<prefix>_companion_radio_…`, `-merged.bin` for ESP32 and `.zip` for nRF52. Non-companion MeshCore assets are refused (`IMAGE_NOT_COMPANION`).
  - Zips are read with zip.js (CRC32 verified while reading). An archive that has more than one match is `IMAGE_AMBIGUOUS`.
  - ESP32: the extended image header must start with the ESP magic (`0xE9`) and carry the board's `chip_id` (`ESP_IMAGE_CHIP_ID`: `esp32` 0x0000, `esp32s3` 0x0009), the image must not exceed `flashBytes`, and it must reach `MIN_ESP32_FULL_IMAGE_BYTES` (0x20000). Classic ESP32 images carry the bootloader at 0x1000, S3 at 0x0. Full images are written at address 0.
  - nRF52: legacy serial-DFU package, application-only manifest, safe entry names (no absolute path or `..`), no duplicate entries, and the init packet's CRC16 must equal the firmware CRC16 (`nrf52DfuCrc16`).
  - `fileSha256` and `payloadSha256` are both computed. An optional expected digest must be a 64-character hex string and is compared with the file hash (`CHECKSUM_INVALID`, `CHECKSUM_MISMATCH`).
- **Last-line check before hardware.** `runDeviceFirmwareFlash` calls `assertPlanMatchesBoard` (board id, family vs plan kind, every ESP image's chip id). The ESP path also passes `expectedChipName` so `flashEsp32Images` verifies the chip reported by the ROM bootloader before any write.
- **ESP32 path.** `flashSize`/`flashMode`/`flashFreq` are `keep` (the image's own header is used), `skipRNodePrepare: true`, 921600 baud. Sync times out after 45 s with up to 3 attempts. The stall timeout is 60 s (`ESP32_FLASH_STALLED`). A transfer that writes fewer than 8192 bytes is rejected as a failure.
- **nRF52 path.** The port is closed, then `Nrf52DfuFlasher.flash` takes the DFU package at 115200 baud. The `enterDfuMode` touch uses 1200 baud. The stall timeout is 60 s (`NRF52_DFU_STALLED`).
- **Port lifecycle.** The component always shows the picker (no session reuse; the last port may have been an RNode), stores the session port, and closes it in a `finally` with `safeCloseSerialPort`. The caller owns the port, not `runDeviceFirmwareFlash`.
- **Cancellation.** An `AbortController` is passed as `signal`. Cancel rejects with `ESP32_FLASH_CANCELLED` or `NRF52_DFU_CANCELLED` and the UI shows `deviceFirmware.cancelled`. Unmount aborts any running flash.
- **i18n.** All copy lives under `deviceFirmware.*` and `flasher.*`. No hardcoded English in the section.

## Failure behaviour

| Failure                                        | Behaviour                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Validation (`DeviceFirmwareError`)             | Nothing written; message shown inline under the file picker via `ERROR_KEYS`                    |
| File read fails                                | `READ_FAILED` shown; `console.warn` log                                                         |
| Chip mismatch (ROM bootloader vs board)        | `esp32ChipMismatch`; nothing written                                                            |
| Image larger than the detected flash           | `imageExceedsFlash`; nothing written                                                            |
| Stall, sync, timeout, MD5 mismatch after write | Humanized via `humanizeFlasherError`; port closed in `finally`; device may need to be reflashed |
| User cancel                                    | `deviceFirmware.cancelled` status; port closed; checklist cleared                               |
| Any other flash error                          | `console.error('[DeviceFirmwareFlash] flash failed')` plus a status message                     |

Flash start, success, and failure log under the `[DeviceFirmwareFlash]` tag with the board id, kind, byte count, and `payloadSha256`. Nothing user-controlled goes to the logger unsanitized.

## Do not

- Do not add a board without a verified factory image, chip id, and bootloader entry. RNode boards live in `firmwareConfigs.ts`, not here.
- Do not flash a Reticulum RNode here. Its flow (provisioning, EEPROM, firmware hash, backup) is in `RNodeFlasherSection.tsx`.
- Do not add Meshtastic-only admin tools to this section; they belong with the Admin panel's Meshtastic tools ([development/meshtastic.md](meshtastic.md)).
- Do not download firmware in the app. Operators choose a local file.
- Do not skip `assertPlanMatchesBoard` or reuse a plan across board changes.

## Tests

| Area                                                   | File                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Section (blockers, acknowledgement, flash/cancel, DFU) | `src/renderer/components/flasher/DeviceFirmwareFlashSection.test.tsx`                              |
| Board matrix and detection                             | `src/renderer/lib/flasher/deviceFirmwareBoards.test.ts`                                            |
| Preflight                                              | `src/renderer/lib/flasher/deviceFirmwarePreflight.test.ts`                                         |
| Image planning, checksums, DFU package                 | `src/renderer/lib/flasher/deviceFirmwareImage.test.ts` (fixtures: `deviceFirmwareTestFixtures.ts`) |
| Orchestration                                          | `src/renderer/lib/flasher/deviceFirmwareFlash.test.ts`                                             |
| ESP32 / nRF52 writers                                  | `esp32Flasher.test.ts`, `nrf52DfuFlasher.test.ts`, `__tests__/nrf52DfuFlasher.test.ts`             |
| Error text                                             | `flasherErrorHumanize.test.ts`                                                                     |
| Serial / session port                                  | `flasherSerial.test.ts`, `flasherSessionPort.test.ts`, `FlasherSerialPortPicker.test.tsx`          |
| Update toast                                           | `src/renderer/components/FirmwareUpdateNotifier.test.tsx`, `FirmwareStatusIndicator.test.tsx`      |

Cover all three platforms when changing platform-sensitive serial behaviour, per AGENTS.md platform parity.

## Related

- [Device firmware flashing (operator guide)](../firmware.md)
- [Reticulum — Admin (RNode flasher)](../reticulum.md#admin-rnode-flasher), [reticulum-development.md](../reticulum-development.md) (RNode flasher timeouts)
- [Troubleshooting — Reticulum Admin: RNode flasher timeout or stalled transfer](../troubleshooting-reticulum.md#reticulum-admin-rnode-flasher-timeout-or-stalled-transfer) (shared stall errors)
- [BLE and serial](ble-serial.md)
- [Meshtastic development notes](meshtastic.md)
