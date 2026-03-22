# LetsMesh MQTT authentication (MeshCore)

mesh-client uses the same contract as [meshcore-mqtt-broker](https://github.com/michaelhart/meshcore-mqtt-broker): MQTT username `v1_<64-hex public key>` (uppercase) and a password produced by `@michaelhart/meshcore-decoder` `createAuthToken`.

## JWT audience (`aud`)

The broker validates that the token’s `aud` claim matches its configured `AUTH_EXPECTED_AUDIENCE` when that value is set.

For **LetsMesh public presets** (`mqtt-us-v1.letsmesh.net`, `mqtt-eu-v1.letsmesh.net`), mesh-client sets:

- **MQTT connect host/port**: the regional hostname and `443` (WebSocket TLS).
- **JWT `aud`**: the **same** regional hostname as the MQTT server (not a separate apex domain).

That aligns with common tooling such as [meshcoretomqtt](https://github.com/Cisien/meshcoretomqtt) (token `audience` matches the broker host). If your operator documents a different `aud`, use **Custom** MQTT and paste a manually generated token.

## Debugging connection vs auth

When investigating failures, use the **main process** log (not only the UI):

- **`[MeshcoreMqttAdapter] client error`** with “Not authorized” (or similar) **before** a phase timeout usually indicates **rejected credentials or JWT** (signature, expiry, or `aud`).
- **`no CONNACK`** (connect phase) or **`no SUBACK`** (subscribe phase) with **no** preceding client error often points to **transport** or **broker ACL/topic** respectively (TLS/WebSocket stall, DNS, firewall vs topic prefix).

Meshtastic MQTT working on the same machine does not guarantee MeshCore LetsMesh will (different code path and broker), but it helps rule out total network outage.

## Manual token

Import identity under **Radio**, or set **Custom** and paste username `v1_<public key>` and a token from tooling that matches your broker’s `AUTH_EXPECTED_AUDIENCE`.
