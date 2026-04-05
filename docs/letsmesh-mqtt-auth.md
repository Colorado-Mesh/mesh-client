# LetsMesh MQTT authentication (MeshCore)

mesh-client uses the same contract as [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker): MQTT username `v1_<64-hex public key>` (uppercase) and a password produced by `@michaelhart/meshcore-decoder` `createAuthToken`.

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

## Packet logger / Analyzer (LetsMesh)

[LetsMesh](https://www.letsmesh.net/) positions public MQTT as part of the **MeshCore Analyzer** ecosystem: clients contribute **observed** traffic (e.g. packet captures) for the map and web UI—similar to [meshcoretomqtt](https://github.com/Andrew-a-g/meshcoretomqtt) (topics such as `meshcore/packets` with JSON metadata).

In mesh-client, **LetsMesh public brokers** are **not** used for MQTT-only channel chat when no radio is connected. Optional **Packet logger (LetsMesh Analyzer)** (off by default) publishes RX summaries from the radio to `{topicPrefix}/meshcore/packets` using a meshcoretomqtt-style JSON shape (see [`MeshcoreMqttAdapter.publishPacketLog`](../src/main/meshcore-mqtt-adapter.ts)). Confirm broker ACLs and [observer onboarding](https://analyzer.letsmesh.net/observer/onboard) expectations with current operator docs.
