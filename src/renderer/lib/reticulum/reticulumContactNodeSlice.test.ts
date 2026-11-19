import { describe, expect, it } from 'vitest';

import type { NodeRecord } from '../../stores/nodeStore';
import {
  buildReticulumContactNodeSlice,
  contactNodeSliceUnchanged,
} from './reticulumContactNodeSlice';

function contact(
  hash: string,
  name: string,
  lastHeard = 1,
): {
  destination_hash: string;
  display_name: string;
  last_heard: number;
  is_contact: boolean;
} {
  return {
    destination_hash: hash,
    display_name: name,
    last_heard: lastHeard,
    is_contact: true,
  };
}

describe('reticulumContactNodeSlice', () => {
  const hashA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('builds a stable slice and reports unchanged on identical rebuild', () => {
    const contacts = [contact(hashA, 'Alpha')];
    const history = [contact(hashB, 'Beta')];
    const prior: Record<number, NodeRecord> = {};
    const first = buildReticulumContactNodeSlice({
      contacts,
      history,
      dismissed: new Set(),
      prior,
      selfNodeId: null,
    });
    const second = buildReticulumContactNodeSlice({
      contacts,
      history,
      dismissed: new Set(),
      prior: first,
      selfNodeId: null,
    });
    expect(contactNodeSliceUnchanged(first, second)).toBe(true);
  });

  it('detects a name change as a changed slice', () => {
    const priorSlice = buildReticulumContactNodeSlice({
      contacts: [contact(hashA, 'Alpha')],
      history: [],
      dismissed: new Set(),
      prior: {},
      selfNodeId: null,
    });
    const nextSlice = buildReticulumContactNodeSlice({
      contacts: [contact(hashA, 'Alpha Renamed')],
      history: [],
      dismissed: new Set(),
      prior: priorSlice,
      selfNodeId: null,
    });
    expect(contactNodeSliceUnchanged(priorSlice, nextSlice)).toBe(false);
  });
});
