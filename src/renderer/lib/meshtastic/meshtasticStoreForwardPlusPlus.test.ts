import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  decodeStoreForwardPlusPlus,
  mergeSfppPhase,
  sfppPhaseForMessageType,
} from './meshtasticStoreForwardPlusPlus';

const StoreForwardPlusPlusSchema = (
  Mesh as unknown as { StoreForwardPlusPlusSchema: Parameters<typeof create>[0] }
).StoreForwardPlusPlusSchema;

describe('sfppPhaseForMessageType', () => {
  it('maps chain routing and confirmed provide types', () => {
    expect(sfppPhaseForMessageType(1)).toBe('routing'); // CHAIN_QUERY
    expect(sfppPhaseForMessageType(3)).toBe('routing'); // LINK_REQUEST
    expect(sfppPhaseForMessageType(5)).toBe('routing'); // LINK_PROVIDE_FIRSTHALF
    expect(sfppPhaseForMessageType(6)).toBe('routing'); // LINK_PROVIDE_SECONDHALF
    expect(sfppPhaseForMessageType(4)).toBe('confirmed'); // LINK_PROVIDE
    expect(sfppPhaseForMessageType(999)).toBe('unknown');
  });
});

describe('decodeStoreForwardPlusPlus', () => {
  it('decodes encapsulatedId and phase from protobuf bytes', () => {
    const bytes = toBinary(
      StoreForwardPlusPlusSchema,
      create(StoreForwardPlusPlusSchema, {
        sfppMessageType: 4,
        encapsulatedId: 0xabcd1234,
        encapsulatedFrom: 1,
        encapsulatedTo: 2,
      }),
    );
    const decoded = decodeStoreForwardPlusPlus(bytes);
    expect(decoded).toEqual(
      expect.objectContaining({
        encapsulatedId: 0xabcd1234,
        phase: 'confirmed',
        encapsulatedFrom: 1,
        encapsulatedTo: 2,
      }),
    );
  });

  it('returns null for missing encapsulatedId or garbage', () => {
    const empty = toBinary(
      StoreForwardPlusPlusSchema,
      create(StoreForwardPlusPlusSchema, {
        sfppMessageType: 1,
        encapsulatedId: 0,
      }),
    );
    expect(decodeStoreForwardPlusPlus(empty)).toBeNull();
    expect(decodeStoreForwardPlusPlus(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe('mergeSfppPhase', () => {
  it('does not regress confirmed to routing', () => {
    expect(mergeSfppPhase('confirmed', 'routing')).toBe('confirmed');
    expect(mergeSfppPhase('routing', 'confirmed')).toBe('confirmed');
    expect(mergeSfppPhase(undefined, 'routing')).toBe('routing');
  });
});
