'use strict';

/**
 * electron-builder afterPack: embed a Windows application manifest with longPathAware
 * before fuses + rcedit metadata + code signing (see platformPackager pack ordering).
 *
 * Failure point: rcedit requires Windows, or Wine on non-Windows when building --win.
 * Fallback: skip only when exe missing; otherwise surface errors so CI does not ship a silent miss.
 */

const fs = require('fs');
const path = require('path');

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

  const rceditMod = await import('rcedit');
  const rceditFn = rceditMod.rcedit ?? rceditMod.default;
  if (typeof rceditFn !== 'function') {
    throw new Error('[afterPack] rcedit module has no callable export');
  }
  await rceditFn(exePath, {
    'application-manifest': manifestPath,
  });
  console.debug(`[afterPack] Embedded longPathAware manifest: ${exePath}`);
};
