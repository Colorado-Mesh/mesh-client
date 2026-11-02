# Database at-rest encryption decision

**Status:** Rejected / not planned (2026-11-02)

Mesh Client does **not** encrypt `mesh-client.db` at rest. Credentials that warrant crypto already use Electron `safeStorage` (OS keychain). Whole-database encryption does not meaningfully improve the primary physical-theft threat, adds irreversible brick risk, and makes private support diagnosis harder.

This page records the decision so contributors do not re-propose app-level DB encryption without new threat assumptions.

## Threat model in scope

**In scope:** someone steals the laptop (or other device) that runs Mesh Client.

| Device state                                                       | What actually protects data               | What app-level DB encryption adds                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Powered off / locked with FileVault, BitLocker, or LUKS            | OS full-disk encryption                   | Almost nothing — the disk is already unreadable                                                                           |
| Unlocked / logged-in session stolen                                | The OS login already grants access        | Transparent OS-keychain (`safeStorage`) crypto unlocks with the same session, so DB ciphertext decrypts for the thief too |
| Passphrase-gated app crypto (only model that helps unlocked theft) | User must unlock Mesh Client every launch | High UX cost and permanent brick risk for low private-data value                                                          |

**Correct control for this threat:** enable OS full-disk encryption and a screen lock. Mesh Client must not imply that an in-app DB toggle replaces FileVault, BitLocker, or LUKS.

## Sensitivity of on-disk data

**Already protected separately (keep doing this):**

- MeshCore / Meshtastic private-key backups, MQTT material, and room/repeater passwords via `safeStorage` → SQLite `secure_secrets` (ciphertext only; see [Key backup and cryptography](key-backup-and-crypto.md))
- Reticulum identity files and the optional identity vault under `reticulum/` (sidecar-owned; not covered by a hypothetical DB toggle)

**Lower / situational (plain SQLite and related files by design):**

- Channel chat and a small number of DMs
- Node lists, path/GPS history, emergency incident text
- MECP received audit log
- Intentional private copies in **Export for Developer** and **Export Database**

Most mesh traffic is not highly private. A few DMs do not justify a second crypto subsystem with key-loss failure modes.

## Recommended user controls

1. Turn on OS full-disk encryption (FileVault / BitLocker / LUKS or distro equivalent).
2. Use a screen lock with a strong account password or biometrics.
3. Never attach **Export for Developer** or raw `mesh-client.db` to public GitHub issues. Share developer bundles only on a **private channel** when a maintainer asks — see [Troubleshooting](troubleshooting.md).

## Existing app mitigations

These remain the product’s at-rest hygiene; they are not “encryption of the database”:

- Main DB file mode `0600` where the platform supports it (`src/main/database.ts`)
- Single-instance lock so two processes do not share one live DB
- `SecureSecretStore` refuses weak `basic_text` backends for durable secrets
- **Export for GitHub** stays on a public-safe allowlist (no DB); developer mode is explicitly private-use
- No SQLCipher / no encrypt-on-quit file wrap / no Zustand “encrypted persist” for message stores

Durable message and identity state lives in SQLite. Renderer Zustand stores such as `messageStore`, `identityStore`, and `nodeStore` are **memory-only** and hydrate from the DB — encrypting those stores would not protect anything on disk. See [Renderer storage](development/renderer-storage.md).

## Supportability (deliberate plaintext exports)

Plaintext **Export for Developer** and `db:export` are intentional so maintainers can open the snapshot in ordinary SQLite tools, inspect schema and rows, and reproduce state **without** Mesh Client or the reporter’s OS keychain.

Encrypting `mesh-client.db` (or requiring decrypt-before-export) forces one of:

1. **Ciphertext in the zip** that maintainers cannot open — machine-bound `safeStorage` keys do not travel with the bundle; or
2. A **decrypt / export dance** (temp plaintext copies, “forgot to decrypt” tickets, extra failure modes) that still does not help when the key never leaves the user’s machine.

**Access control for developer exports is procedural (private channel), not cryptographic.** That trade favors supportability over security theater for low-sensitivity chat history.

## Rejected approaches

| Approach                                              | Why it fails stolen-laptop                                                                                              | Why it hurts support                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Encrypt-on-quit file wrap (`.enc` while quit)         | DB + WAL/SHM stay plaintext while the app runs; crash windows leave plaintext; `closeDatabase()` is process-terminal    | Same as any at-rest scheme: exports need decrypt or arrive unreadable                             |
| SQLCipher (or multi-cipher SQLite) + OS keychain only | Unlocked-session theft still unlocks the key; keychain wipe / account migrate / Flatpak secrets gaps brick the whole DB | Maintainer cannot decrypt remotely; driver swap tax across Electron, Flatpak, Nix                 |
| SQLCipher + user passphrase every launch              | Only model that helps unlocked theft — disproportionate UX and recovery burden for a few DMs                            | Without a transferable recovery key, private diagnosis still dead-ends                            |
| Zustand persist-layer encryption                      | Core message/identity stores do not persist; disk copy is SQLite                                                        | No diagnostic benefit; false sense of coverage                                                    |
| Encrypt at rest, then guard / decrypt for support     | Does not change the stolen-laptop math above                                                                            | Leaves maintainers unable to open files without a transferable recovery key — do not ship this UX |

Honest always-encrypted SQLite would require replacing built-in `node:sqlite` (`src/main/db-compat.ts`), keyed second connections for `VACUUM INTO` export/merge, WAL-aware migration, Flatpak/Nix native rebuild, and recovery UX. That cost is not justified for the current threat and data sensitivity.

## Risks of implementing anyway

- **Irreversible data loss** when the OS keychain is reset, the profile moves machines, signing identity changes, or Linux/Flatpak has no strong secret service
- **Migration / WAL crash windows** if a wrap or rekey is interrupted
- **Misleading security theater** if users skip OS disk encryption because “the app encrypts”
- **Support dead-ends** when maintainers receive undecryptable databases
- **Bootstrap ordering:** a DB-wide key cannot live inside `secure_secrets` in the same file; keychain outages become total open failures rather than per-credential recovery screens

**Non-goals (do not half-build these):**

- Do not auto-recreate a DB when decrypt or keychain fails (that would destroy data).
- Do not imply Mesh Client replaces OS full-disk encryption.
- Do not encrypt exports “for free” without a separate product decision (exports are intentional plaintext handoffs for private diagnosis).
- Do not claim Reticulum `config/identity`, attachments, or logs are covered by a future DB toggle — they are separate surfaces if ever revisited.
- Do not add “encrypted at rest but decrypt for support” without a transferable recovery key maintainers can actually use.

## When to revisit

Reopen only if one of these becomes true:

1. Regulatory or org policy requires app-level at-rest crypto **independent of** OS full-disk encryption.
2. The product starts storing high-value secrets primarily as plaintext in SQLite (rather than `secure_secrets` / sidecar identity files).
3. Explicit user demand for a passphrase lock that survives an unlocked stolen session, with accepted UX and recovery costs.
4. A maintainable SQLCipher (or equivalent) path lands in Electron / `node:sqlite` without a driver-swap tax.
5. Support gains a practical, documented decrypt-for-maintainer path that does **not** depend on the reporter’s local OS keychain (hard bar; unlikely for keychain-bound keys).

Until then, prefer OS disk encryption, screen lock, credential `safeStorage`, and procedural handling of private developer exports.

## See also

- [Key backup and cryptography](key-backup-and-crypto.md) — what we encrypt today
- [Renderer storage](development/renderer-storage.md) — durable layers; SQLite owns messages
- [Troubleshooting](troubleshooting.md) — developer bundle / DB sharing rules
- [Security policy](../SECURITY.md) — vulnerability reporting
