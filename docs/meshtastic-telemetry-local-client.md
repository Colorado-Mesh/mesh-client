# Meshtastic: mesh telemetry interval vs local client metrics

Meshtastic distinguishes two related ideas:

1. **Mesh (LoRa) telemetry interval**: The value you configure for the telemetry module / device metrics (for example **1800 seconds** for a 30-minute mesh broadcast cadence). This controls how often the radio sends those metrics **over the mesh**.

2. **Local-to-app refresh**: When a client is connected (Bluetooth, USB serial, or Wi-Fi to the device), the firmware **often still delivers device metrics to that client about once per minute** so local dashboards and apps stay reasonably fresh. That behavior is **not** the same thing as your mesh telemetry interval.

So you can see **self telemetry** (battery, voltage, channel utilization, etc.) arriving in Mesh Client roughly every **60 seconds** while the configured interval on the radio still reads **1800 s** or longer. That is expected: the short cadence is for the **connected client**, not necessarily for every LoRa packet on the mesh.

## What you’ll see in Mesh Client

- The **Radio** and **Module** panels show the configured **mesh/module** interval.
- Live or diagnostic views may still update **device metrics from your own node** on a faster cadence when the link to the device is up, because the firmware pushes those updates for local use.

## Official documentation

Meshtastic documents the telemetry module and device metrics behavior here:

[https://meshtastic.org/docs/configuration/module/telemetry](https://meshtastic.org/docs/configuration/module/telemetry)

Refer to that page for authoritative semantics; Mesh Client’s UI copy summarizes the distinction for users who might otherwise assume the on-screen refresh rate must match the configured interval.
