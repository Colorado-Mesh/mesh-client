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

export async function setFirmwareHashFromDevice(rnode: RNode): Promise<void> {
  const hash = await rnode.getFirmwareHash();
  await rnode.setFirmwareHash(hash);
}
