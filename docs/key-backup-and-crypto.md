# Key backup and cryptography

Mesh-Client stores **different kinds of keys in different places**. Meshtastic DM/PKC backup is **per app install** (one slot), not per node. MeshCore device keys use a separate cache for MQTT and JSON import.

See also [Meshtastic vs MeshCore feature parity](meshcore-meshtastic-parity.md) and the README **Security (PKI)** section.

## Meshtastic: DM key backup / restore

**Where:** **Security** tab → **Key Backup / Restore** (Meshtastic mode only; tab hidden for MeshCore).

**What it backs up:** The **connected local radio’s** Curve25519 DM key pair (`publicKey` + `privateKey` from the device security config). These keys encrypt/decrypt PKC direct messages on the Meshtastic mesh.

**Where it is stored:**

| Item           | Location                                             |
| -------------- | ---------------------------------------------------- |
| Encrypted blob | Renderer `localStorage` key `mesh-client:key-backup` |
| Encryption     | Electron `safeStorage` (OS keychain when available)  |

**Scope: per app, not per node**

- There is **one** backup slot for the whole Mesh-Client install on that machine.
- The storage key does **not** include node number, serial, or identity id.
- **Backup** snapshots whatever device is connected when you click **Backup Keys**.
- **Restore** writes that snapshot to **whatever device is connected** when you click **Restore Keys**.
- Connecting a second radio and backing up again **overwrites** the previous backup.

**When backup/restore is unavailable**

- **Remote configure target:** Backup, restore, and regenerate are hidden while **Configure node** targets a remote node (keys live on the local radio, not the remote snapshot).
- **System keychain:** On platforms where `safeStorage` is unavailable (common on some Linux setups without a keyring), the UI shows a warning and backup/restore stay disabled.
- **Connection:** You must be connected to a local radio to read keys for backup or apply a restore.

**Related: remote admin keys (different feature)**

PKC **remote admin** trust keys are stored **per remote node** in SQLite `app_settings` as `meshtasticRemoteAdminKey:<nodeNum>`. That is for administering other nodes over your local radio, not for DM backup/restore.

Implementation: [`SecurityPanel.tsx`](../src/renderer/components/SecurityPanel.tsx) (`KEY_BACKUP_STORAGE_KEY = 'mesh-client:key-backup'`).

---

## MeshCore: device keys and MQTT identity

MeshCore firmware uses its **own** keypair (orlp/MeshCore style). The **Security** tab is **not** shown in MeshCore mode (`hasSecurityPanel: false`).

Mesh-Client caches MeshCore identity for **LetsMesh MQTT JWT** signing and related flows:

| Item                                                   | Location                                             |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Public key (+ optional plaintext private key fallback) | `localStorage` → `mesh-client:meshcoreIdentity`      |
| Encrypted private key (when keychain available)        | `localStorage` → `mesh-client:meshcoreIdentityEncPK` |

**How keys get into the cache**

1. **Connect a MeshCore radio** — after a successful session, the client exports the device private key and persists it (same shape as JSON import). See [`tryPersistMeshcoreIdentityFromRadioExport`](../src/renderer/lib/letsMeshJwt.ts).
2. **Radio tab → Import config JSON** — MeshCore companion JSON with `public_key` / `private_key` is written to the identity cache (radio settings in the file may also be applied). See [`RadioPanel.tsx`](../src/renderer/components/RadioPanel.tsx).

This cache is also **per app install** (not per MeshCore node). Connecting a different MeshCore radio updates the cached identity used for MQTT username/JWT on that profile.

Details: [LetsMesh MQTT authentication](letsmesh-mqtt-auth.md).

---

## Meshtastic keys vs MeshCore keys

|                                | Meshtastic DM backup                                            | MeshCore identity cache                                      |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| **Protocol**                   | Meshtastic PKC / DM                                             | MeshCore orlp keys                                           |
| **UI**                         | Security → Backup / Restore                                     | Radio → Import config JSON; auto on radio connect            |
| **Storage key**                | `mesh-client:key-backup`                                        | `mesh-client:meshcoreIdentity` (+ optional `…EncPK`)         |
| **Per node?**                  | No — one slot; content is from last backed-up device            | No — one cache; updated on connect/import                    |
| **Portable across protocols?** | **No** — Meshtastic DM keys cannot be used on MeshCore firmware | **No** — MeshCore keys cannot be used on Meshtastic firmware |

Flashing MeshCore firmware on hardware that previously ran Meshtastic **replaces** the on-device key material. Meshtastic DM backup preserves your **old Meshtastic identity** for restore **if you return to Meshtastic** on that radio; it does **not** carry that identity onto the MeshCore mesh.

---

## Use case: backing up keys before moving MT nodes to MC

You are retiring Meshtastic firmware on one or more radios and flashing **MeshCore**, but you want to keep a safety copy of Meshtastic identities (and know how to handle MeshCore keys afterward).

### Before you flash (Meshtastic)

1. Switch the header to **Meshtastic** and connect each radio **one at a time** over USB/BLE/TCP.
2. Open **Security** → **Key Backup / Restore**.
3. For **each** node you care about:
   - Click **Backup Keys** (requires system keychain / `safeStorage`).
   - Because the app only keeps **one** Meshtastic backup slot, **copy the public and private keys** elsewhere before moving to the next radio:
     - Use **Copy** on the public key and reveal/copy the private key in the **DM Keys** section, **or**
     - Export your own secure note/password-manager record per device (label by node name / node num).
   - Optional: after the last node, leave **Backup Keys** on the device you are most likely to restore first (that snapshot stays in `mesh-client:key-backup`).
4. If you used **PKC remote admin** keys for other nodes, those are already stored per node in the app database; no extra Security backup step is required for admin keys.

**Why:** Flashing to MeshCore wipes Meshtastic firmware storage. Without a copy, that Meshtastic DM identity is gone unless you restore from backup **after** reflashing Meshtastic firmware again.

### Flash and first MeshCore setup

1. Flash MeshCore firmware per upstream MeshCore docs.
2. Switch the header to **MeshCore** and connect the radio.
3. The device will present a **new MeshCore identity** (new public key on the mesh). The client will **auto-cache** keys for LetsMesh MQTT when the session succeeds.
4. Optional — MQTT before RF: if you have a MeshCore JSON export from the companion toolchain, use **Radio → Import config JSON** so `public_key` / `private_key` are in the app cache before connecting to LetsMesh.

### If you return a radio to Meshtastic later

1. Reflash Meshtastic firmware.
2. Connect locally (not remote configure).
3. **Security** → **Restore Keys** if you still have the single in-app backup for that node, **or** paste the saved key pair via regenerate/apply flow using the values you copied per node.

### What this does **not** do

- **Does not** migrate Meshtastic DM identity into MeshCore contacts or encryption — peers on MeshCore will see a **new** public key after flash.
- **Does not** keep separate in-app Meshtastic backups for multiple nodes automatically — plan external copies when migrating a fleet.
- **Does not** replace MeshCore companion backup tools for full device JSON; use Radio import + radio connect for MeshCore-side persistence in Mesh-Client.

---

## Quick reference

| Goal                                        | Action                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Save Meshtastic DM keys on this computer    | Meshtastic → connect local radio → **Security** → **Backup Keys**                   |
| Restore Meshtastic DM keys after reflash    | Meshtastic → connect local radio → **Security** → **Restore Keys**                  |
| Save Meshtastic keys for **multiple** nodes | Backup each node; **copy keys out** before connecting the next (one slot)           |
| Cache MeshCore keys for MQTT                | Connect MeshCore radio, or **Radio** → **Import config JSON**                       |
| Move hardware MT → MC                       | Back up MT keys **before flash**; expect **new** MC identity after flash            |
| Administer a remote Meshtastic node         | Save `meshtasticRemoteAdminKey:<nodeNum>` via node detail (separate from DM backup) |
