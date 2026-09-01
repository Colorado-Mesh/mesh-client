import { BlobReader, BlobWriter, type FileEntry, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { blobToUint8Array, parseFlashAddress } from '../binaryUtils';

describe('parseFlashAddress', () => {
  it.each([
    ['0x0', 0],
    ['0xe000', 0xe000],
    ['0x8000', 0x8000],
    ['0x10000', 0x10000],
    ['0x210000', 0x210000],
  ] as const)('parses hex address %s', (address, expected) => {
    expect(parseFlashAddress(address)).toBe(expected);
  });

  it('does not treat hex addresses as decimal zero (regression)', () => {
    expect(parseFlashAddress('0x10000')).not.toBe(0);
  });
});

describe('blobToUint8Array', () => {
  it('preserves raw bytes including 0x00, 0x80, and 0xff', async () => {
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x42]);
    const result = await blobToUint8Array(new Blob([bytes]));
    expect(Array.from(result)).toEqual([0x00, 0x80, 0xff, 0x42]);
  });

  it('round-trips ZIP entry blobs without corrupting binary firmware bytes', async () => {
    const firmwareBytes = new Uint8Array([0x00, 0x80, 0xff, 0x01, 0x00, 0xfe]);
    const zipBlob = await (async () => {
      const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
      await zipWriter.add('firmware.bin', new BlobReader(new Blob([firmwareBytes])));
      return zipWriter.close();
    })();

    const { ZipReader } = await import('@zip.js/zip.js');
    const zipReader = new ZipReader(new BlobReader(zipBlob));
    try {
      const entries = await zipReader.getEntries();
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.directory).toBe(false);
      const fileEntry = entry as FileEntry;
      const entryBlob = await fileEntry.getData(new BlobWriter('application/octet-stream'));
      const extracted = await blobToUint8Array(entryBlob);
      expect(Array.from(extracted)).toEqual(Array.from(firmwareBytes));
    } finally {
      await zipReader.close();
    }
  });
});
