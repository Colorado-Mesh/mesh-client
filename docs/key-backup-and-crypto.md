# Key backup and cryptography

Mesh-Client stores **different kinds of keys in different places**. Meshtastic and MeshCore **Security** tabs each back up a **full key pair** (public + private) **per node**, indexed by **node number** (Meshtastic `nodeNum`, MeshCore `nodeId`). The **private key** restores mesh identity after factory reset; **public key alone is not enough**, but every backup payload includes both keys.

**Per-node archives are created only when you click Backup Keys** on that protocol’s Security tab. Opening Security, connecting a radio, or importing Radio JSON updates the MeshCore **MQTT active cache** only — it does **not** create a per-node backup.

See also [Meshtastic vs MeshCore feature parity](meshcore-meshtastic-parity.md) and the README **Security** section.

## What a backup contains (both protocols)

Every encrypted backup stores:

| Field           | Meshtastic                  | MeshCore                   |
| --------------- | --------------------------- | -------------------------- |
| **Public key**  | 32 bytes (Curve25519)       | 32 bytes                   |
| **Private key** | 32 bytes                    | 32- or 64-byte orlp export |
| **Index**       | `nodeNum` (unsigned 32-bit) | `nodeId` (numeric self id) |

Keys are **not interchangeable** across Meshtastic and MeshCore firmware.

**Encryption:** Electron `safeStorage` (OS keychain when available) over JSON in renderer `localStorage`.

**Not included in backup:** channels, NodeDB, messages, MeshCore contacts DB, Meshtastic remote admin keys (`meshtasticRemoteAdminKey:<nodeNum>` in SQLite), device name/owner (optional `nodeLabel` in the index is display-only).

Restore lists prefix entries with **Meshtastic ·** or **MeshCore ·** so archives are distinguishable when `nodeNum` and `nodeId` share the same numeric display.

---

## Meshtastic: DM key backup / restore

**Where:** **Security** tab → **Key Backup / Restore** (local radio only; hidden for remote configure targets).

**What it backs up:** The connected local radio’s DM **public and private** keys from device security config.

**Storage:**

| Item                                  | Location                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| Per-node encrypted blob               | `localStorage` → `mesh-client:meshtastic-dm-key-backup:<nodeNum>`   |
| Index (labels, dates, pub-key prefix) | `localStorage` → `mesh-client:meshtastic-dm-key-backup-index`       |
| Legacy (migrated on upgrade)          | `mesh-client:key-backup` → moved into per-`nodeNum` slot when valid |

**Scope: per node, Meshtastic only**

- Each Meshtastic `nodeNum` has its own backup slot on this computer.
- Backing up radio A does **not** overwrite radio B’s archive or any MeshCore archive.
- **Restore Keys** applies the archive for the **currently connected** `nodeNum` when one exists.
- **Restore from backup…** lists **Meshtastic** archived backups only.

**Restore pipeline**

1. Decrypt and validate both keys.
2. `applyConfig` merges **only** `publicKey` / `privateKey` (admin keys and toggles on the device are preserved).
3. Commit so keys persist to firmware.
4. Post-restore verification compares device public key to backup; success or actionable failure toast.

Implementation: [`meshtasticDmKeyBackupStorage.ts`](../src/renderer/lib/meshtasticDmKeyBackupStorage.ts), [`KeyBackupRestoreSection.tsx`](../src/renderer/components/KeyBackupRestoreSection.tsx), [`SecurityPanel.tsx`](../src/renderer/components/SecurityPanel.tsx).

---

## MeshCore: key backup / restore and MQTT identity

**Where:** **Security** tab (partial — backup/restore, sign, export/import private key; no Meshtastic PKI/admin sections).

**What it backs up:** Device **public key** plus **private key** from `exportPrivateKey()` (normalized orlp bytes) — **only** when you click **Backup Keys**.

**Storage:**

| Item                                                   | Location                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| Per-node encrypted archive                             | `localStorage` → `mesh-client:meshcore-key-backup:<nodeId>`         |
| Index                                                  | `localStorage` → `mesh-client:meshcore-key-backup-index`            |
| **Active MQTT cache** (last connected/restored device) | `mesh-client:meshcoreIdentity` (+ optional `meshcoreIdentityEncPK`) |

The **active MQTT cache** is separate from per-node archives: LetsMesh JWT signing uses whichever identity was last connected or restored. Per-node archives retain full pairs without overwriting each other.

**How keys get into the active cache (not a per-node backup)**

1. **Connect a MeshCore radio** — session export via [`tryPersistMeshcoreIdentityFromRadioExport`](../src/renderer/lib/letsMeshJwt.ts).
2. **Security → Restore** or **Restore from backup…** — [`syncMeshcoreActiveIdentityFromBackup`](../src/renderer/lib/letsMeshJwt.ts) writes the full pair and dispatches `meshclient:meshcoreIdentityUpdated`.
3. **Radio → Import config JSON** — updates MQTT cache only ([`RadioPanel.tsx`](../src/renderer/components/RadioPanel.tsx)); use **Security → Backup Keys** to create a per-node archive.

**Restore pipeline**

1. Decrypt and validate both keys.
2. `importPrivateKey(privateKeyBytes)` on the connected radio.
3. Sync active MQTT cache with full pair; identity-updated event refreshes Connection tab LetsMesh username.
4. Best-effort verification after reconnect delay.

Implementation: [`meshcoreKeyBackupStorage.ts`](../src/renderer/lib/meshcoreKeyBackupStorage.ts).

Details: [LetsMesh MQTT authentication](letsmesh-mqtt-auth.md).

---

## Meshtastic keys vs MeshCore keys

|                                  | Meshtastic DM backup                 | MeshCore key backup            |
| -------------------------------- | ------------------------------------ | ------------------------------ |
| **Protocol**                     | Meshtastic PKC / DM                  | MeshCore orlp keys             |
| **UI**                           | Security → **Backup Keys**           | Security → **Backup Keys**     |
| **Storage pattern**              | `meshtastic-dm-key-backup:<nodeNum>` | `meshcore-key-backup:<nodeId>` |
| **Per node?**                    | Yes — indexed by `nodeNum`           | Yes — indexed by `nodeId`      |
| **Created by opening Security?** | No (legacy MT slot migrates once)    | **No**                         |
| **Portable across protocols?**   | **No**                               | **No**                         |

Flashing MeshCore firmware on hardware that previously ran Meshtastic **replaces** on-device key material. Meshtastic archives preserve your **old Meshtastic identity** for restore **if you return to Meshtastic**; they do **not** carry that identity onto the MeshCore mesh.

---

## Use case: backing up keys before moving MT nodes to MC

### Before you flash (Meshtastic)

1. Switch to **Meshtastic** and connect each radio **one at a time**.
2. Open **Security** → **Key Backup / Restore**.
3. For **each** node: click **Backup Keys** (requires `safeStorage`). Each node gets its own indexed slot — no overwrite when you connect the next radio.
4. Optional: use **Copy** / export private key for an off-device copy.
5. Remote admin keys remain in SQLite per node; no extra Security step.

### Flash and first MeshCore setup

1. Flash MeshCore firmware.
2. Switch to **MeshCore** and connect — new MeshCore identity on the mesh.
3. **Security → Backup Keys** archives the new pair under that `nodeId` (required; connect/import alone is not enough).
4. Optional: **Radio → Import config JSON** for MQTT cache before RF connect; then **Security → Backup Keys** for a per-node archive.

### If you return a radio to Meshtastic later

1. Reflash Meshtastic firmware and connect locally.
2. **Restore Keys** if a backup exists for the current `nodeNum`, or **Restore from backup…** to pick an archive from before a factory reset / node-num change.

### What this does **not** do

- Does **not** migrate Meshtastic identity into MeshCore contacts — peers see a **new** public key after flash.
- Does **not** replace MeshCore companion full JSON backup tools; use Security **Backup Keys** for Mesh-Client per-node archives.

### Full companion JSON backup (evaluation, 2026)

The official MeshCore companion can export/import a **full device JSON** (contacts, channels, radio params, and related fields). mesh-client today supports:

- Per-node **Security** archives (`mesh-client:meshcore-key-backup:<nodeId>`) — public + private key pairs only.
- **Radio** JSON import for a subset of fields (`setRadioParams`, channels where APIs exist).

**Gap:** There is no single-click export/import of the entire companion JSON blob. Implementing parity would require auditing meshcore.js export shape vs `RadioPanel` import, SQLite contact merge, and conflict rules for channels/contacts — estimated multi-day effort. **Deferred** until Tier 1–3 parity items ship; track as a Security/Radio follow-up if users need whole-device migration beyond per-node key archives.

---

## Quick reference

| Goal                                             | Action                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Save Meshtastic DM keys for this node            | Meshtastic → connect local radio → **Security** → **Backup Keys**              |
| Save keys for **multiple** Meshtastic nodes      | Backup each node while connected; each `nodeNum` keeps its slot                |
| Restore Meshtastic DM keys (same node)           | **Security** → **Restore Keys**                                                |
| Restore after factory reset / different node num | **Security** → **Restore from backup…** → confirm                              |
| Save MeshCore keys for this node                 | MeshCore → connect → **Security** → **Backup Keys**                            |
| Restore MeshCore archive to connected radio      | **Restore Keys** or **Restore from backup…**                                   |
| Cache MeshCore keys for MQTT only                | Connect radio, restore backup, or Radio JSON import (no per-node archive)      |
| Administer a remote Meshtastic node              | `meshtasticRemoteAdminKey:<nodeNum>` via node detail (separate from DM backup) |
