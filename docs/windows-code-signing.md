# Windows code signing (Azure Trusted Signing)

Mesh-client's macOS builds are Developer ID–signed and notarized. Windows builds
are **currently unsigned** — users see a SmartScreen "Unknown publisher" warning.
This page describes the signing path that is wired up but **dormant** until the
Azure resources and GitHub secrets below are configured.

## Why Azure Trusted Signing

- **No certificate lifecycle.** Microsoft manages short-lived certs behind the
  service — nothing to download, store, rotate, or renew.
- **No hardware.** Cloud API–based; unlike a traditional EV cert on a USB HSM
  token, it works in CI.
- **~$10/month** per Azure subscription (generous signing quota included).
- **electron-builder does the signing** natively via `win.azureSignOptions`; it
  auto-installs the `TrustedSigning` PowerShell module and calls
  `Invoke-TrustedSigning` at build time.

## How it works in this repo (dormant-safe design)

electron-builder attempts signing whenever `win.azureSignOptions` is present in
config — it does **not** check for credentials first. So the config is **not**
placed statically in `electron-builder.yml` (that would make every unsigned
build — fork PRs, local, dormant releases — try to sign and fail).

Instead:

1. `scripts/ci-write-win-azure-signing.mjs` runs at the start of `dist:win`. It
   writes an overlay config `electron-builder.win-signing.yml`
   (`extends: ./electron-builder.yml` + a `win.azureSignOptions` block built from
   env) **only when `AZURE_CLIENT_ID` is set**. Otherwise it writes nothing (and
   removes any stale overlay).
2. `scripts/dist-win-electron-builder.mjs` passes
   `--config electron-builder.win-signing.yml` to electron-builder only when that
   overlay exists; otherwise it runs the default (unsigned) build.
3. `release.yaml` passes the `AZURE_*` secrets to the build step **gated to
   `windows-latest`** (mirroring how `CSC_*` is gated to macOS). `build.yaml`
   test builds are intentionally left **unsigned** (saves signing quota; test
   builds don't ship).
4. `scripts/verify-win-packaging.mjs` runs `Get-AuthenticodeSignature` on both
   installers: when signed it asserts `Valid` and that the certificate subject
   contains the expected publisher; when unsigned it **skips** (so dormant builds
   stay green).

Net effect: **unsigned and green today; automatically signed the moment the
secrets exist — no code change required to activate.**

## ⚠️ publisherName must match, or auto-updates break

mesh-client ships `electron-updater`, whose `verifyUpdateCodeSignature` defaults
to **true** and verifies downloaded updates against the Windows `publisherName`.
Once Windows builds are signed, **`AZURE_SIGNING_PUBLISHER_NAME` must exactly
match the subject (CN) of the Trusted Signing certificate** — i.e. the validated
identity name. A mismatch will make Windows clients reject every auto-update.
Set it to the exact validated organization/individual name from the identity
validation step below.

## Setup checklist (for the maintainer — Joey)

These require an Azure account + identity validation and cannot be done from the
repo. The repo side is already complete and waiting.

1. **Azure subscription** with billing enabled.
2. **Create a Trusted Signing account** (Azure portal → "Trusted Signing
   Accounts"). Note the **region** — the endpoint is region-specific, e.g.
   `https://eus.codesigning.azure.net/` (East US) or
   `https://wus2.codesigning.azure.net/` (West US 2).
3. **Complete identity validation** on the account:
   - _Public Trust_ for a public release. Org validation needs legal-entity
     details (D-U-N-S, etc.) and takes ~1–5 business days. Individual validation
     is also available.
   - The validated name becomes the certificate subject → this is your
     `publisherName`.
4. **Create a Certificate Profile** under the account (type: Public Trust). Note
   the **profile name**.
5. **Create an Entra ID app registration** (service principal) and generate a
   **client secret**. Assign it the **"Trusted Signing Certificate Profile
   Signer"** role on the Trusted Signing account (IAM → Add role assignment).
6. **Add these GitHub repository secrets** (Settings → Secrets and variables →
   Actions):

   | Secret                         | Value                                                         |
   | ------------------------------ | ------------------------------------------------------------- |
   | `AZURE_TENANT_ID`              | Entra tenant (directory) ID                                   |
   | `AZURE_CLIENT_ID`              | app registration (client) ID — **presence activates signing** |
   | `AZURE_CLIENT_SECRET`          | app registration client secret                                |
   | `AZURE_SIGNING_ENDPOINT`       | region endpoint, e.g. `https://wus2.codesigning.azure.net/`   |
   | `AZURE_SIGNING_ACCOUNT`        | Trusted Signing account name                                  |
   | `AZURE_SIGNING_PROFILE`        | certificate profile name                                      |
   | `AZURE_SIGNING_PUBLISHER_NAME` | **exact** validated identity name (must match cert subject)   |

7. **Cut a release** (tag `v*`). The `release.yaml` "Validate Windows signing
   secrets" step confirms the set is complete, the build signs the x64 + arm64
   installers, and the packaging smoke's `Get-AuthenticodeSignature` check
   verifies them.

### Verifying it worked

- The release build log shows
  `[ci-write-win-azure-signing] ... Windows build will be SIGNED` and the smoke
  log shows `[verify-win-packaging] ... signature: Valid (...)`.
- On a Windows machine: right-click the installer → Properties → **Digital
  Signatures** tab shows the signature; or run
  `Get-AuthenticodeSignature .\Mesh-client-Setup-*.exe` → `Status: Valid`.
- SmartScreen reputation accrues over subsequent signed releases.

## Rollback / disabling

Remove (or rename) `AZURE_CLIENT_ID` and the build reverts to unsigned on the
next run — no code change needed.
