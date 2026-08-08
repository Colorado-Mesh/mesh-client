# MeshCore MQTT authentication

This document describes the **device-signing** authentication contract shared by the public MeshCore MQTT presets: **LetsMesh** (US/EU), **MeshMapper**, **Colorado Mesh**, **Waev**, **Meshat.se**, **MeshCore.CA** (Primary/Backup), and **EastMesh**. mesh-client uses the same contract as [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker): MQTT username `v1_<64-hex public key>` (uppercase) and a password produced by `@michaelhart/meshcore-decoder` `createAuthToken`. The broker allowlist and each broker's WebSocket path live in [`letsMeshJwt.ts`](../src/renderer/lib/letsMeshJwt.ts) (`DEVICE_SIGNING_HOST_WS_PATHS`).

## JWT audience (`aud`)

The broker validates that the token’s `aud` claim matches its configured `AUTH_EXPECTED_AUDIENCE` when that value is set.

For **every device-signing preset**, mesh-client sets the JWT `aud` to the **same hostname as the MQTT connect server** (not a separate apex domain), via `letsMeshJwtAudience()`. Examples:

- **MQTT connect host/port**: the broker hostname (e.g. `mqtt-us-v1.letsmesh.net`, `mqtt.waev.app`, `mqtt1.meshcore.ca`) and `443` (WebSocket TLS).
- **JWT `aud`**: that exact connect hostname.

That aligns with common tooling such as [meshcoretomqtt](https://github.com/Cisien/meshcoretomqtt) (token `audience` matches the broker host). If your operator documents a different `aud`, use **Custom** MQTT and paste a manually generated token.

## WebSocket path (`wsPath`)

Device-signing brokers use one of two WebSocket paths, enforced on connect ([`letsMeshConnectionGuards.ts`](../src/renderer/lib/letsMeshConnectionGuards.ts)):

- **`/ws`** — LetsMesh (US/EU), MeshMapper, Colorado Mesh.
- **`/mqtt`** — Waev, Meshat.se, MeshCore.CA, EastMesh.

Selecting a preset (or a broker toggle) sets the correct path; a mismatched `wsPath` blocks Connect with a clear error and raises the amber deviation banner.

## WebSocket idle / keepalive

Device-signing presets default to a **30s MQTT keepalive**; the **LetsMesh Region (US/EU)** buttons raise it to **60s**. Both values are treated as valid (no deviation banner). mqtt.js’s internal deadline is about **1.5× the keepalive**. The client sends **WebSocket `ping` frames** for proxy/LB idle paths, and periodically calls mqtt.js **`reschedulePing(true)`** so the internal keepalive timer resets when **PINGRESP** / **SUBACK** are not observed in time on the WebSocket path.

## Debugging connection vs auth

When investigating failures, use the **main process** log (not only the UI):

- **`[MeshcoreMqttAdapter] client error`** with “Not authorized” (or similar) **before** a phase timeout usually indicates **rejected credentials or JWT** (signature, expiry, or `aud`).
- **`no CONNACK`** (connect phase) with **no** preceding client error often points to **transport** (TLS/WebSocket stall, DNS, firewall). After CONNACK, subscribe is **non-blocking**: a **subscribe warning** in the UI (amber) means the broker reported a subscribe failure or the client could not confirm subscribe; the session may still deliver traffic depending on broker behavior and ACLs.

Meshtastic MQTT working on the same machine does not guarantee MeshCore LetsMesh will (different code path and broker), but it helps rule out total network outage.

## Manual token

After you connect a **MeshCore** radio successfully, mesh-client persists identity from the radio (via `exportPrivateKey`) in the **active MQTT cache** (`mesh-client:meshcoreIdentity`, optional encrypted private key). That is the identity used for LetsMesh JWT until you connect or restore a different device.

**Per-node archives** (`mesh-client:meshcore-key-backup:<nodeId>`) store the full public + private pair for each MeshCore node you back up from **Security → Backup Keys**. Archives are independent of the active cache; **Security → Restore** or **Restore from backup…** writes the selected pair to the radio and refreshes the active cache for MQTT. See [Key backup and cryptography](key-backup-and-crypto.md).

If you use MQTT **before** ever connecting a MeshCore radio, or stored identity is missing or corrupt, **import** identity under **Radio**, restore from **Security**, or set **Custom** and paste username `v1_<public key>` and a token from tooling that matches your broker’s `AUTH_EXPECTED_AUDIENCE`.

## Packet logger / Analyzer

Many MeshCore MQTT operators provide a **packet logger** or **Analyzer** service: clients contribute **observed** traffic (e.g. packet captures) for the map and web UI; similar to [meshcoretomqtt](https://github.com/Andrew-a-g/meshcoretomqtt) (topics such as `meshcore/packets` with JSON metadata).

In mesh-client, optional **Packet logger** (off by default) publishes RX summaries from the radio to `{topicPrefix}/meshcore/packets` using the JSON envelope shown above. Confirm broker ACLs and observer onboarding expectations with your operator docs.

## Proactive JWT refresh

mesh-client proactively refreshes the JWT token **before** it expires to avoid connection drops. The client schedules a refresh **6 minutes before** the token's `exp` claim when connected. The refresh runs regardless of whether the mesh radio is active; MQTT-only connections also benefit.

If the refresh fails, the client falls back to on-demand refresh (token is regenerated on next connect attempt after expiry).

## Packet format

MeshCore MQTT uses JSON v1 envelopes for both chat messages and packet logger feeds.

### Chat envelope

Published to `{topicPrefix}/{pubKey}/chat` (with origin_id) or `{topicPrefix}/meshcore/chat`:

```json
{
  "v": 1,
  "text": "Hello world",
  "channelIdx": 0,
  "senderName": "MyNode",
  "senderNodeId": 12345678,
  "timestamp": 1699999999000
}
```

**Fields:**

- `v`: always `1` (version)
- `text`: message text, max 16000 chars
- `channelIdx`: channel index (0–255)
- `senderName`: optional sender display name, max 200 chars
- `senderNodeId`: optional sender node ID (number)
- `timestamp`: optional message timestamp (Unix ms)

When publishing with a `v1_<pubKey>` username, mesh-client adds `origin_id` (uppercase hex) to the envelope.

### Packet logger envelope

Published to `{topicPrefix}/{pubKey}/packets` or `{topicPrefix}/meshcore/packets`:

```json
{
  "origin_id": "AABBCCDDEEFF001122",
  "origin": "!abcdef00",
  "timestamp": "2024-11-14T10:30:00.000Z",
  "type": "PACKET",
  "direction": "rx",
  "time": "10:30:00",
  "date": "14/11/2024",
  "len": 24,
  "packet_type": 0,
  "route": "direct",
  "payload_len": 12,
  "raw": "3c010002...",
  "SNR": 10.5,
  "RSSI": -90,
  "hash": "abc123"
}
```

**Fields:**

- `origin_id`: sender's public key (uppercase hex, included when publishing with v1 auth)
- `origin`: sender node ID (Meshtastic-style `!<hex>` or decimal)
- `timestamp`: ISO 8601 timestamp
- `type`: always `"PACKET"`
- `direction`: `"rx"` or `"tx"`
- `time`: HH:MM:SS local time
- `date`: DD/MM/YYYY
- `len`: total packet length in bytes
- `packet_type`: MeshCore packet type number
- `route`: routing type: `"direct"`, `"mqtt"`, or hop count like `"1"`, `"2"`
- `payload_len`: payload byte length
- `raw`: raw packet hex (truncated to 2048 chars)
- `SNR`: signal-to-noise ratio (dB)
- `RSSI`: received signal strength (dBm)
- `hash`: packet hash for deduplication
