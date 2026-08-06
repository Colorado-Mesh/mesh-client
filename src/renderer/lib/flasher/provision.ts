import { packUInt32BE } from './binaryUtils';
import { md5Bytes } from './md5';
import type { RNode } from './rnode';
import { ROM } from './rom';
import type { RNodeModel, RNodeProduct } from './types';

export interface ProvisionParams {
  product: RNodeProduct;
  model: RNodeModel;
  hardwareRevision?: number;
  serialNumber?: number;
}

/** EEPROM is locked but checksum invalid — wipe before writing identity again. */
export const PROVISION_WIPE_REQUIRED = 'PROVISION_WIPE_REQUIRED';
/** Writes finished but ROM still reports not provisioned. */
export const PROVISION_VERIFY_FAILED = 'PROVISION_VERIFY_FAILED';

export async function provisionEeprom(rnode: RNode, params: ProvisionParams): Promise<void> {
  const product = params.product.id;
  const model = params.model.mapped_id ?? params.model.id;
  const hardwareRevision = params.hardwareRevision ?? 0x01;
  const serialNumber = params.serialNumber ?? 1;
  const timestampInSeconds = Math.floor(Date.now() / 1000);
  const serialBytes = Array.from(packUInt32BE(serialNumber));
  const timestampBytes = Array.from(packUInt32BE(timestampInSeconds));

  const checksum = md5Bytes([product, model, hardwareRevision, ...serialBytes, ...timestampBytes]);

  await rnode.writeRom(ROM.ADDR_PRODUCT, product);
  await rnode.writeRom(ROM.ADDR_MODEL, model);
  await rnode.writeRom(ROM.ADDR_HW_REV, hardwareRevision);
  await rnode.writeRom(ROM.ADDR_SERIAL, serialBytes[0]);
  await rnode.writeRom(ROM.ADDR_SERIAL + 1, serialBytes[1]);
  await rnode.writeRom(ROM.ADDR_SERIAL + 2, serialBytes[2]);
  await rnode.writeRom(ROM.ADDR_SERIAL + 3, serialBytes[3]);
  await rnode.writeRom(ROM.ADDR_MADE, timestampBytes[0]);
  await rnode.writeRom(ROM.ADDR_MADE + 1, timestampBytes[1]);
  await rnode.writeRom(ROM.ADDR_MADE + 2, timestampBytes[2]);
  await rnode.writeRom(ROM.ADDR_MADE + 3, timestampBytes[3]);

  for (let i = 0; i < 16; i++) {
    await rnode.writeRom(ROM.ADDR_CHKSUM + i, checksum[i]);
  }

  for (let i = 0; i < 128; i++) {
    await rnode.writeRom(ROM.ADDR_SIGNATURE + i, 0x00);
  }

  await rnode.writeRom(ROM.ADDR_INFO_LOCK, ROM.INFO_LOCK_BYTE);
}

/** Read EEPROM and throw if identity is locked with a bad checksum (needs wipe). */
export async function assertRomWritableForProvision(rnode: RNode): Promise<boolean> {
  const rom = await rnode.getRomAsObject();
  const details = rom.parse();
  if (details?.is_provisioned) {
    return true;
  }
  if (rom.isInfoLocked()) {
    throw new Error(PROVISION_WIPE_REQUIRED);
  }
  return false;
}

/** Re-read EEPROM and require a valid provisioned identity. */
export async function assertRomProvisioned(rnode: RNode): Promise<void> {
  const rom = await rnode.getRomAsObject();
  const details = rom.parse();
  if (!details?.is_provisioned) {
    throw new Error(PROVISION_VERIFY_FAILED);
  }
}

/**
 * Write device identity to EEPROM, then verify the lock+checksum before the caller resets.
 */
export async function provisionEepromAndVerify(
  rnode: RNode,
  params: ProvisionParams,
): Promise<'already_provisioned' | 'provisioned'> {
  const already = await assertRomWritableForProvision(rnode);
  if (already) {
    return 'already_provisioned';
  }
  await provisionEeprom(rnode, params);
  await assertRomProvisioned(rnode);
  return 'provisioned';
}

export async function setFirmwareHashFromDevice(rnode: RNode): Promise<void> {
  const hash = await rnode.getFirmwareHash();
  await rnode.setFirmwareHash(hash);
}
