'use strict';

/**
 * electron-builder afterPack: embed a Windows application manifest with longPathAware
 * before fuses + resedit metadata + code signing (see platformPackager pack ordering).
 *
 * Uses pure-JS resedit (no native binary or Wine). Surface errors so CI does not ship a silent miss.
 */

const fs = require('fs');
const path = require('path');

// Ref: https://learn.microsoft.com/en-us/windows/win32/menurc/resource-types
const RT_MANIFEST_TYPE = 24;

module.exports = async function electronBuilderAfterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const manifestPath = path.join(
    __dirname,
    '..',
    'resources',
    'win',
    'mesh-client-long-path.manifest.xml',
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[afterPack] Missing manifest: ${manifestPath}`);
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] Missing Windows app exe: ${exePath}`);
  }

  const { NtExecutable, NtExecutableResource } = await import('resedit');
  const exeData = fs.readFileSync(exePath);
  const exe = NtExecutable.from(exeData);
  const res = NtExecutableResource.from(exe);

  const manifests = res.entries.filter((e) => e.type === RT_MANIFEST_TYPE);
  if (manifests.length !== 1) {
    throw new Error(`[afterPack] Expected one RT_MANIFEST resource, found ${manifests.length}`);
  }

  const manifestData = fs.readFileSync(manifestPath);
  manifests[0].bin = manifestData.buffer.slice(
    manifestData.byteOffset,
    manifestData.byteOffset + manifestData.byteLength,
  );

  res.outputResource(exe);
  const outData = Buffer.from(exe.generate());
  const tmpPath = `${exePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, outData);
    fs.renameSync(tmpPath, exePath);
  } catch (e) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // catch-no-log-ok best-effort cleanup
    }
    throw e;
  }
  console.debug(`[afterPack] Embedded longPathAware manifest: ${exePath}`);
};
