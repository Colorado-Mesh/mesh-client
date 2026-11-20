/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { blePickerDisplayName } from '../pickerListSort';
import {
  looksLikeMeshcomBleName,
  looksLikeRnodeBleName,
  meshcomBlePickerDisplayName,
} from './meshcomBleName';

describe('meshcomBleName', () => {
  it('recognizes MeshCom MC- advert names and RNode adverts', () => {
    expect(looksLikeMeshcomBleName('MC-a1b2-NV0N-20')).toBe(true);
    expect(looksLikeMeshcomBleName('RNode ABCD')).toBe(false);
    expect(looksLikeRnodeBleName('RNode ABCD')).toBe(true);
    expect(looksLikeRnodeBleName('MC-a1b2-NV0N-20')).toBe(false);
  });

  it('prefers MeshCom advert over a stale RNode cache on the same id', () => {
    expect(
      meshcomBlePickerDisplayName('uuid-1', 'MC-a1b2-NV0N-20', 'RNode 41F4', blePickerDisplayName),
    ).toBe('MC-a1b2-NV0N-20');
    expect(
      meshcomBlePickerDisplayName('uuid-1', 'MC-a1b2-NV0N-20', 'OldLabel', blePickerDisplayName),
    ).toBe('MC-a1b2-NV0N-20');
  });
});
