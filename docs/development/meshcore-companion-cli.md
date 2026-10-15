# MeshCore companion CLI, remote CLI and telemetry push

Developer reference for MeshCore companion firmware v1.18+ features: the local companion CLI (settings, reboot, power off), remote CLI on other companions, telemetry push from sensors, and CLI secret redaction. Repo-wide rules live in [`AGENTS.md`](../../AGENTS.md). Repeater and room server CLI lives in [meshcore-repeaters.md](meshcore-repeaters.md).

All of these are gated by `ProtocolCapabilities.hasCompanionCli` plus `companionCli.available` (the connected companion reports protocol version 14 or newer). Never gate on `protocol === 'meshcore'`.

## Local companion CLI

**Wire:** `CMD_RUN_CLI_COMMAND` (66) carries `xx|<command>`, where `xx` is a random two-character `[a-z0-9]` prefix. The radio answers with `RESP_CODE_CLI_REPLY` (29) carrying the same `xx|` prefix; [`meshcoreCompanionCli.ts`](../../src/renderer/lib/meshcore/meshcoreCompanionCli.ts) `matchCliReplyFrame` ignores replies with a different prefix, so stale replies from a timed-out command are dropped. Calls on one connection are serialized because the firmware has a single reply buffer. `Unknown command` replies are classified as `unsupported`.

**Version gate:** `MESHCORE_COMPANION_CLI_MIN_VER = 14` against `deviceQuery().firmwareVer` (`meshcoreCompanionProtocolVersionFromDeviceQuery`). Older companions keep the classic `conn.reboot()` path and do not show the CLI sections.

**Commands:** single line, leading whitespace dropped (trailing spaces may belong to a WiFi password), at most 150 UTF-8 bytes so the frame and reflected prefix fit the firmware's 166-byte reply buffer.

**Settings:** [`meshcoreCompanionSettings.ts`](../../src/renderer/lib/meshcore/meshcoreCompanionSettings.ts) describes each setting; the Radio panel section is [`MeshcoreCompanionCliSection.tsx`](../../src/renderer/components/MeshcoreCompanionCliSection.tsx).

| Group  | Settings                                                                                                                         | Notes                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| device | `ver`, `board` (read-only), `tz.offset`, `pin` (BLE PIN, write-only secret)                                                      | `pin` needs a reboot                                                               |
| radio  | `af`, `dutycycle` (read-only), `int.thresh`, `cad`, `radio.rxgain`, `rxdelay`, `agc.reset.interval`, `txdelay`, `direct.txdelay` |                                                                                    |
| wifi   | `wifi.enabled`, `wifi.ssid`, `wifi.pwd` (secret), `wifi.status`, `wifi.ip` (read-only)                                           | Enable, SSID and password need a reboot; `set wifi.clear` clears the saved network |

`secret` settings are never part of bulk reads; `wifi.pwd` is read only on an explicit reveal (`MESHCORE_COMPANION_SECRET_GET_COMMANDS`).

**Reboot and reconnect:** [`useMeshcoreCompanionCli.ts`](../../src/renderer/hooks/meshcore/useMeshcoreCompanionCli.ts) `rebootAndReconnect` sets `meshcorePlannedRebootRef`, writes `reboot` without waiting for a reply, waits `MESHCORE_PLANNED_REBOOT_FLUSH_MS` (500 ms) for the frame to flush, then calls the runtime connection-lost handler so the single-owner reconnect cycle starts. While the flag is set the reconnect UI shows the planned-reboot banner instead of a connection-loss state, and the first attempt waits at least `MESHCORE_PLANNED_REBOOT_RECONNECT_DELAY_MS` (8 s) for boot and BLE re-advertising. `powerOff` writes `poweroff` and then performs a manual disconnect (no auto-reconnect).

## Remote CLI on other companions

**Wire:** the repeater CLI path (`sendRepeaterCliCommand`) with `target: 'companion'` sends `MESHCORE_TXT_TYPE_CLI_COMMAND` (txt_type 3) instead of CLI data (1), skips server login (companions have no ACL), and does not schedule the repeater post-reboot status poll. Replies come back as txt_type 1 with the same token and use the normal `RepeaterCommandService` correlation and history.

**Permission:** the target runs the command only if its contact entry for the sender has flag `0x10` (`MESHCORE_CONTACT_FLAG_REMOTE_CLI`). Our own permission for a peer is the same flag on our radio's contact for them; [`meshcoreContactFlags.ts`](../../src/renderer/lib/meshcore/meshcoreContactFlags.ts) reads and writes it with `addOrUpdateContact`, keeping `outPathLen ?? -1` so an unknown path stays flood. When a peer is refused, its companion forwards the command to its app as an inbound txt_type 3 message; mesh-client logs a `[remote-cli] refused command from <prefix>` device-log line and never shows it as chat.

**UI:** [`MeshcoreRemoteCliSection.tsx`](../../src/renderer/components/MeshcoreRemoteCliSection.tsx) in the node detail for `hw_model === 'Chat'` contacts: an allow switch (confirmation before granting, none before revoking), the shared CLI history, and a console that confirms dangerous commands. Hook: [`useMeshcoreCompanionRemote.ts`](../../src/renderer/hooks/meshcore/useMeshcoreCompanionRemote.ts).

## Telemetry push from sensors

**Wire** (firmware `SensorMesh.cpp`): binary request after the usual sensor login (ACL read-only or better).

- Subscribe `0x08`: `[0x08, tag u32 LE, timeoutSecs u16 LE, reserved u8, minDeltasLen u8, minDeltas]`, with 3–14 bytes of min-deltas. Each entry is `channel, LPP type, delta` with the delta big-endian at the firmware's `LPPData` size and multiplier (temperature ×10 signed, humidity ×10, pressure ×10, voltage ×100). The channel must match the sensor's own telemetry channel, so the min-deltas are built from the sensor's last telemetry reply (requested first if none is cached).
- Reply: `[grantedSecs u16 LE, reserved u16, scope]`; `grantedSecs === 0` means rejected.
- Unsubscribe `0x09`: one byte.
- Push: the sensor sends at its read interval when a watched value changed by more than its delta. The companion forwards it as unsolicited `0x8C` (`MC_PUSH_BINARY_RESPONSE`); meshcore.js parses `{ tag, responseData }` with `responseData = timestamp u32 + LPP`. There is no sender key, so the subscription tag is the only routing key.

**Code:** [`meshcoreTelemetryPush.ts`](../../src/renderer/lib/meshcore/meshcoreTelemetryPush.ts) (codec, builders, parsers, registry) and [`useMeshcoreTelemetryPush.ts`](../../src/renderer/hooks/meshcore/useMeshcoreTelemetryPush.ts). The runtime routes pushes into `applyMeshcoreTelemetryLpp`, the same decode path as requested telemetry (node telemetry, environment history, GPS altitude). Subscriptions renew at 80% of the granted time (30 s floor), pause their timers when the link drops, re-subscribe 5 s after reconnect, and are forgotten without RF traffic on manual disconnect. UI: [`MeshcoreTelemetryPushSection.tsx`](../../src/renderer/components/MeshcoreTelemetryPushSection.tsx) for `hw_model === 'Sensor'`.

## Secret redaction

[`src/shared/meshcoreCliSecrets.ts`](../../src/shared/meshcoreCliSecrets.ts) is the single pattern list for secret CLI commands: `password`, `get|set guest.password`, `get|set prv.key`, `get|set wifi.pwd` and `set pin`, with or without the `xx|` token prefix.

- Repeater, room and remote CLI history use `redactMeshcoreCliSecrets`: the secret argument becomes `[redacted]` and the reply to a secret command is replaced; `wifi.pwd: value` echoed in other replies is scrubbed too.
- Companion CLI logging uses `formatMeshcoreCompanionCliForLog`, which also runs `sanitizeLogMessage`.
- Support bundles ([`support-bundle.ts`](../../src/main/support-bundle.ts)) scrub `mesh-client.log`, `mesh-client.log.1` and the string values of `debug-snapshot.json` with `redactMeshcoreCliSecretsInText` / `InJsonText`, which catch lines written by older builds. Bounded bare `password <arg>` and `password now:` replies are scrubbed; ordinary wording such as `wrong password for` is left alone. JSON also redacts `"wifi.pwd"` object fields.
