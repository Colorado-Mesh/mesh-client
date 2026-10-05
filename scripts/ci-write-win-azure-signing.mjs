#!/usr/bin/env node
/**
 * Dormant-safe Azure Trusted Signing config injector for Windows builds.
 *
 * electron-builder signs Windows artifacts via Azure Trusted Signing when
 * `win.azureSignOptions` is present in config. The catch: app-builder-lib creates
 * the signing manager and runs `Install-Module TrustedSigning` + `Invoke-TrustedSigning`
 * whenever that block is *present* — it does NOT check whether the Azure credentials
 * exist first. So putting `azureSignOptions` statically in electron-builder.yml would
 * make every build (fork PRs, local, dormant releases with no secrets) attempt signing
 * and fail.
 *
 * Instead, this script writes an OVERLAY config (`electron-builder.win-signing.yml`,
 * `extends: ./electron-builder.yml`) containing `win.azureSignOptions` ONLY when the
 * signing credentials are present (gated on AZURE_CLIENT_ID). The signed build path
 * passes `--config electron-builder.win-signing.yml`; when secrets are absent the
 * overlay is not written and the build uses the plain (unsigned) config.
 *
 * Required env to activate (set from CI secrets; see docs/windows-code-signing.md):
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   (Entra credentials; used
 *                                                            by electron-builder at sign time)
 *   AZURE_SIGNING_ENDPOINT            e.g. https://wus2.codesigning.azure.net/
 *   AZURE_SIGNING_ACCOUNT            Trusted Signing account name
 *   AZURE_SIGNING_PROFILE            Certificate profile name
 *   AZURE_SIGNING_PUBLISHER_NAME     Exact validated publisher/subject name. MUST match
 *                                    the cert subject or electron-updater's
 *                                    verifyUpdateCodeSignature breaks Windows auto-updates.
 *
 * Writes nothing (and prints a skip line) when AZURE_CLIENT_ID is absent, so dormant
 * and fork builds stay green and unsigned.
 *
 * Prints the config path to stdout when written, so a CI step can capture it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const OVERLAY_FILENAME = 'electron-builder.win-signing.yml';
/** Credential env var whose presence activates signing. */
export const SIGNING_ACTIVATION_ENV = 'AZURE_CLIENT_ID';

/** Config field → env var for the (non-secret) Trusted Signing coordinates. */
const SIGNING_FIELD_ENV = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT',
  certificateProfileName: 'AZURE_SIGNING_PROFILE',
  publisherName: 'AZURE_SIGNING_PUBLISHER_NAME',
};

/**
 * True when Windows signing should be activated for this build.
 * @param {NodeJS.ProcessEnv} env
 */
export function isSigningActivated(env) {
  const v = env[SIGNING_ACTIVATION_ENV];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Build the overlay config object from env. Throws if activation is on but a
 * required coordinate is missing — fail loud rather than ship an unsigned build
 * that was supposed to be signed.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ extends: string, win: { azureSignOptions: Record<string, string> } }}
 */
export function buildSigningOverlayConfig(env) {
  /** @type {Record<string, string>} */
  const azureSignOptions = {};
  const missing = [];
  for (const [field, envVar] of Object.entries(SIGNING_FIELD_ENV)) {
    const value = env[envVar];
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(envVar);
      continue;
    }
    azureSignOptions[field] = value.trim();
  }
  if (missing.length > 0) {
    throw new Error(
      `${SIGNING_ACTIVATION_ENV} is set (signing requested) but these required env vars are missing: ` +
        `${missing.join(', ')}. Set them from CI secrets or unset ${SIGNING_ACTIVATION_ENV} to build unsigned.`,
    );
  }
  // fileDigest/timestampRfc3161/timestampDigest use electron-builder defaults
  // (SHA256 / Microsoft RFC3161 / SHA256); no need to pin them here.
  return {
    extends: './electron-builder.yml',
    win: { azureSignOptions },
  };
}

/**
 * Write the overlay config iff signing is activated. Returns the written path, or
 * null when skipped (no credentials → unsigned build).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [rootDir]
 * @returns {string | null}
 */
export function writeWinAzureSigningConfig(env = process.env, rootDir = ROOT) {
  const overlayPath = path.join(rootDir, OVERLAY_FILENAME);
  if (!isSigningActivated(env)) {
    // Remove any stale overlay so a later unsigned build never picks it up.
    if (fs.existsSync(overlayPath)) {
      fs.rmSync(overlayPath, { force: true });
    }
    console.debug(
      `[ci-write-win-azure-signing] ${SIGNING_ACTIVATION_ENV} not set — Windows build will be UNSIGNED (no overlay written)`,
    );
    return null;
  }

  const config = buildSigningOverlayConfig(env);
  const header =
    '# Generated by scripts/ci-write-win-azure-signing.mjs — do not edit or commit.\n' +
    '# Overlay that enables Azure Trusted Signing; written only when signing creds are present.\n';
  fs.writeFileSync(overlayPath, header + yaml.dump(config, { lineWidth: -1 }), 'utf8');
  console.debug(
    `[ci-write-win-azure-signing] Wrote ${OVERLAY_FILENAME} — Windows build will be SIGNED ` +
      `(publisher: ${config.win.azureSignOptions.publisherName})`,
  );
  return overlayPath;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  try {
    const written = writeWinAzureSigningConfig();
    // Emit the config path (or empty) so a CI step can decide --config.
    if (written) process.stdout.write(`${OVERLAY_FILENAME}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-write-win-azure-signing] ${detail}`);
    process.exit(1);
  }
}
