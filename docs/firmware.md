# Device firmware flashing (Meshtastic and MeshCore)

Mesh Client can install or update firmware on a small set of Meshtastic and MeshCore radios over USB. The flasher lives in the **Admin** tab under **Flash device firmware**. It checks the board and the firmware file before it writes anything, and it refuses anything it cannot verify.

For problems, see [Troubleshooting](troubleshooting.md). For code, see [Device firmware flasher (developer map)](development/firmware-flash.md).

---

## What can be flashed

| Protocol   | Board                   | Chip family | File to choose                                                                     |
| ---------- | ----------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Meshtastic | Heltec V3               | ESP32-S3    | `firmware-heltec-v3-<version>.factory.bin`, or the release `.zip`                  |
| Meshtastic | LilyGo T-Beam           | ESP32       | `firmware-tbeam-<version>.factory.bin`, or the release `.zip`                      |
| Meshtastic | RAK4631 (WisBlock Core) | nRF52840    | `firmware-rak4631-<version>…` `.zip` (including `-ota.zip`), or the release `.zip` |
| MeshCore   | Heltec V3               | ESP32-S3    | `heltec_v3_companion_radio_…-merged.bin`                                           |
| MeshCore   | RAK4631 (WisBlock Core) | nRF52840    | `rak_4631_companion_radio_…` `.zip`                                                |

Rules that apply to every flash:

- **Only the boards above.** When Mesh Client detects the connected radio, an unlisted board is refused before any data is written. If detection fails, you pick a listed board manually — confirm it matches your hardware. The flasher then checks chip family (and ESP image chip id), so an unlisted board that shares the same chip family could still be written with the selected image. The list is small on purpose.
- **Full images only.** ESP32 boards need the full-flash image (`.factory.bin` or `-merged.bin`). nRF52 boards need the application-only DFU `.zip`.
- **MeshCore companion firmware only.** Repeater, room server, and other MeshCore images are refused.
- **Local USB only.** The section is not available for a remote **Configure node** target, and it is not available on Reticulum.

**Reticulum RNode firmware is separate.** RNode radios use their own flasher with its own board list. See [Reticulum — Admin (RNode flasher)](reticulum.md#admin-rnode-flasher).

**Meshtastic-only tools** (key verification, remote shell, XMODEM file transfer, lockdown, Mesh Beacon) are not part of flashing. See [Meshtastic advanced tools](meshtastic.md#advanced-tools).

---

## Before you flash

1. **Back up your settings and keys.** A full-flash ESP32 image can erase device settings, channels, and keys.
2. **Use a good cable.** Use a data-capable USB cable plugged directly into the computer, with no hub. Do not unplug the device while it flashes.
3. **Power.** Charge the device or power it externally.
4. **Disconnect the radio's USB serial connection in Mesh Client.** The flasher needs the serial port. (A Bluetooth or network connection can stay up, but it drops while the device reboots.)
5. **Download the firmware.** Use **Open Meshtastic firmware releases** or **Open MeshCore firmware releases** in the section. Mesh Client does not download firmware for you. Choose the file from disk.
6. **Close other apps** that hold the serial port, such as a web flasher, a serial console, or the RNode flasher.

---

## Board detection

When the radio is connected, Mesh Client reads its model and picks the board:

| Result          | What you see                                                                                            | What it means                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Matched**     | **Detected from the connected radio: <board>**                                                          | The board is locked to the live radio                                       |
| **Unknown**     | **The radio was not identified automatically. Pick your board manually.**                               | Choose the board from the **Board** list. The flash is marked as unverified |
| **Unsupported** | **The connected radio reports “<model>”, which is not a supported flash target. Flashing is disabled.** | The radio is not in the supported list. Nothing can be flashed              |

If the radio is disconnected (for example, because you unplugged it to flash over USB), the last board detected in this session pre-selects. The confirmation checklist still applies.

---

## Choosing firmware

Use the **Firmware file** picker and select a `.zip` or `.bin` from the release page.

- **Meshtastic:** the release `.zip` from the Meshtastic firmware releases (`firmware-esp32s3-….zip` or `firmware-nrf52840-….zip`), or a single `.factory.bin` / `-ota.zip` for your board.
- **MeshCore:** the companion-radio `-merged.bin` (ESP32) or `.zip` (nRF52) for your board, from the MeshCore releases.

After you choose a file the section shows **Checking firmware…**, then **Ready: <file> (<size>)**, the parsed **Version**, and two checksums:

- **File SHA-256**, the hash of the file you chose. Compare it with the digest shown next to the asset on the release page.
- **Image SHA-256** — for ESP32, the hash of the full-flash image bytes that will be written; for nRF52, the hash of the **DFU ZIP package** (not the extracted application binary alone).

Paste the digest from the release page into **Expected SHA-256 (optional)**. A mismatch against either checksum blocks flashing.

If the file is not acceptable, the section shows one of these:

| Message                                                                  | Meaning                                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| The firmware file is empty                                               | The file has no data                                                         |
| This file name is not a recognized firmware image for the selected board | The name does not match the board                                            |
| This firmware is for a different board                                   | Pick the matching board or a different file                                  |
| The archive does not contain a firmware image for the selected board     | A zip without your board's file                                              |
| This is not the full-flash image Mesh Client writes                      | Use the `.factory.bin`, `-merged.bin`, or DFU `.zip`                         |
| This is not companion-radio firmware                                     | MeshCore companion images only                                               |
| The archive contains more than one matching image                        | Extract the exact file you want and select it                                |
| The file is not a valid ESP32 firmware image                             | Header check failed                                                          |
| The image was built for a different chip than the selected board         | Chip check failed                                                            |
| The image is larger than the selected board's flash                      | Too large for the board                                                      |
| The file is too small to be a full-flash firmware image                  | Not a factory image                                                          |
| The nRF52 DFU package is invalid or unsupported                          | Needs an application-only legacy serial DFU package with a matching checksum |
| The expected SHA-256 is not a valid 64-character hex digest              | Fix the pasted digest                                                        |
| The file's SHA-256 does not match the expected digest                    | Do not flash it. Download it again                                           |
| Could not read the firmware file                                         | The file could not be read                                                   |

Files larger than 32 MiB are refused.

---

## Preflight blockers

The **Flash firmware** button stays disabled while any blocker is listed under the form. Every blocker, in the order it is checked:

| Blocker                | Message                                                                                        | How to clear it                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `noBoard`              | **Select a board.**                                                                            | Choose a board from the list                                           |
| `boardUnsupported`     | **The connected radio is not a supported board.**                                              | Not fixable here. Use the vendor's web flasher                         |
| `boardMismatch`        | **The selected board does not match the connected radio.**                                     | Reselect the detected board. The selection is locked to the live radio |
| `serialConnectionOpen` | **Disconnect the radio's USB serial connection before flashing — Mesh Client needs the port.** | Disconnect the USB serial connection in Mesh Client                    |
| `lowBattery`           | **Battery is below 30% — charge the device or plug it in, then retry.**                        | Charge it. A device that reports it is charging passes                 |
| `noImage`              | **Select a valid firmware file.**                                                              | Choose a file that passes the checks above                             |
| `notAcknowledged`      | **Confirm the checklist below.**                                                               | Tick the confirmation checkbox                                         |

The battery check runs only when the radio is connected and reports its level.

**Confirmation checklist.** Tick **I confirm the USB-connected device is a <board>, it has a stable cable and power, and I have backed up my settings and keys.** The tick is remembered for the pair of board id and image fingerprint. Changing the board or image unchecks it for the new combination, but returning to a previously acknowledged pair can check the box again.

---

## Warnings

Warnings are always shown under **Before you flash** and cannot be dismissed. They do not block the flash.

| Warning                                                                                                                                    | When it appears                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Use a data-capable USB cable plugged directly into the computer (no hub) and do not unplug the device while flashing                       | Always                                                                 |
| Battery level unknown — make sure the device is well charged or externally powered                                                         | The radio does not report a battery level                              |
| Mesh Client resets the board into the ESP32 ROM bootloader automatically. If it cannot, hold BOOT, tap RESET, release BOOT, then try again | ESP32 boards                                                           |
| nRF52 boards flash through the serial DFU bootloader. The bootloader itself is not touched, so a failed update can be retried              | nRF52 boards                                                           |
| A full-flash image can erase device settings, channels, and keys. Export a backup first                                                    | ESP32 boards (not nRF52, whose DFU path replaces only the application) |
| The radio connection will drop while the device reboots                                                                                    | The radio is connected over something other than USB serial            |
| The radio was not identified automatically, so the board choice is unchecked. The wrong board can leave the device unbootable              | Board detection was **Unknown**                                        |

---

## Flashing

### ESP32 (Heltec V3, T-Beam)

1. Press **Flash firmware**. A serial port picker always opens. Choose the board's USB port.
2. Mesh Client resets the board into the ESP32 ROM bootloader on its own. The progress bar shows a syncing state first. If it cannot enter the bootloader, hold BOOT, tap RESET, release BOOT, and try again.
3. Before the first byte is written, the chip reported by the bootloader is checked against the chosen board. A mismatch stops with **The connected chip does not match the selected board. Nothing was written.**
4. The image is written to the flash starting at address 0 and verified. The progress reads **Flashing… N%**.
5. On success: **Firmware written and verified. The device is rebooting — wait about 30 seconds, then reconnect.**

### nRF52 (RAK4631)

1. Put the board in bootloader (DFU) mode. Use **Enter DFU mode** in the section, or double-tap the reset button. The same action also exists in the Admin panel's device commands (**Enter DFU Mode**).
2. Press **Flash firmware** and choose the board's USB port.
3. The DFU package is sent to the serial bootloader. The bootloader itself is not touched.
4. On success: **Firmware sent to the bootloader. The device is rebooting — wait about 30 seconds, then reconnect.**

### Cancelling and stalls

**Cancel flash** stops the transfer and closes the port. The message reads **Flash cancelled. The device may need to be flashed again — see the recovery steps below.**

A transfer with no progress for 60 seconds is stopped and reported as a stall. The same applies if the bootloader cannot be reached (sync fails after several tries).

---

## After flashing

1. Wait about **30 seconds** for the device to reboot.
2. Reconnect the radio in the **Connection** tab.
3. Check the firmware version in the app.
4. On an ESP32 board, re-check your channels and settings. A full-flash image can reset them. Restore from your backup if needed.

The acknowledgement is cleared after every flash attempt, so you must tick the checklist again to flash again.

---

## Recovery

If a flash fails or is cancelled:

- **ESP32:** the ROM bootloader cannot be overwritten, so the board can be recovered. Hold BOOT, tap RESET, release BOOT, and flash again, or use the vendor web flasher.
- **nRF52:** double-tap RESET to enter the UF2 bootloader (a drive appears), then drag the board's `.uf2` onto it, or retry the flash in Mesh Client.
- Try another USB cable or port. Most stalls and verification failures come from the cable.
- If an ESP32 verification fails after writing, download the firmware again and retry.

---

## Firmware update toast

When a Meshtastic or MeshCore radio is connected and configured, Mesh Client checks the upstream releases. If a newer one exists, a toast reads **Firmware update available: v<version>**. The firmware status indicator shows the same result, and when an update is available, clicking it opens the release page.

**Don't remind me** silences the toast for that release, per protocol. It comes back when a newer release ships. The toast does not flash anything. Download the file from the release page and follow this guide.

---

## Related links

- [Meshtastic advanced tools](meshtastic.md#advanced-tools) — key verification, remote shell, XMODEM, lockdown, Mesh Beacon
- [Reticulum — Admin (RNode flasher)](reticulum.md#admin-rnode-flasher) — RNode firmware, separate from this flasher
- [Troubleshooting](troubleshooting.md)
- [Device firmware flasher (developer map)](development/firmware-flash.md)
