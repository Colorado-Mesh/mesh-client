# MeshCore MQTT authentication

This document describes the authentication contract used by many MeshCore MQTT brokers including **Colorado Mesh** and **LetsMesh**. mesh-client uses the same contract as [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker): MQTT username `v1_<64-hex public key>` (uppercase) and a password produced by `@michaelhart/meshcore-decoder` `createAuthToken`.

## JWT audience (`aud`)

The broker validates that the token’s `aud` claim matches its configured `AUTH_EXPECTED_AUDIENCE` when that value is set.

For **LetsMesh public presets** (`mqtt-us-v1.letsmesh.net`, `mqtt-eu-v1.letsmesh.net`), mesh-client sets:

- **MQTT connect host/port**: the regional hostname and `443` (WebSocket TLS).
- **JWT `aud`**: the **same** regional hostname as the MQTT server (not a separate apex domain).

That aligns with common tooling such as [meshcoretomqtt](https://github.com/Cisien/meshcoretomqtt) (token `audience` matches the broker host). If your operator documents a different `aud`, use **Custom** MQTT and paste a manually generated token.

## WebSocket idle / keepalive

MeshCore MQTT over WSS uses **60s MQTT keepalive** (same order of magnitude as raw TCP). mqtt.js’s internal deadline is about **1.5× the keepalive**. The client sends **WebSocket `ping` frames** for proxy/LB idle paths, and periodically calls mqtt.js **`reschedulePing(true)`** so the internal keepalive timer resets when **PINGRESP** / **SUBACK** are not observed in time on the WebSocket path.

## Debugging connection vs auth

When investigating failures, use the **main process** log (not only the UI):

- **`[MeshcoreMqttAdapter] client error`** with “Not authorized” (or similar) **before** a phase timeout usually indicates **rejected credentials or JWT** (signature, expiry, or `aud`).
- **`no CONNACK`** (connect phase) with **no** preceding client error often points to **transport** (TLS/WebSocket stall, DNS, firewall). After CONNACK, subscribe is **non-blocking**: a **subscribe warning** in the UI (amber) means the broker reported a subscribe failure or the client could not confirm subscribe; the session may still deliver traffic depending on broker behavior and ACLs.

Meshtastic MQTT working on the same machine does not guarantee MeshCore LetsMesh will (different code path and broker), but it helps rule out total network outage.

## Manual token

Import identity under **Radio**, or set **Custom** and paste username `v1_<public key>` and a token from tooling that matches your broker’s `AUTH_EXPECTED_AUDIENCE`.

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
