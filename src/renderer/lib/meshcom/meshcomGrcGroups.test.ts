import { describe, expect, it } from 'vitest';

import {
  buildMeshcomChatChannels,
  compactMeshcomGrcDraftSlots,
  formatMeshcomGrcListenList,
  getMeshcomGrcGroup,
  MESHCOM_GRC_GROUPS,
  MESHCOM_GRC_MAX_SLOTS,
  meshcomGrcChannelLabel,
  parseMeshcomGrcIdList,
  parseMeshcomGrcListenList,
  searchMeshcomGrcGroups,
} from './meshcomGrcGroups';

describe('meshcomGrcGroups', () => {
  it('includes ICSSW named groups EU LOC DL OE', () => {
    expect(getMeshcomGrcGroup(2)?.prefix).toBe('EU');
    expect(getMeshcomGrcGroup(9)?.prefix).toBe('LOC');
    expect(getMeshcomGrcGroup(262)?.prefix).toBe('DL');
    expect(getMeshcomGrcGroup(232)?.prefix).toBe('OE');
    expect(MESHCOM_GRC_GROUPS.length).toBeGreaterThan(40);
  });

  it('parses and formats listen lists with a six-slot cap', () => {
    expect(parseMeshcomGrcListenList('232;2321;262;20')).toEqual([232, 2321, 262, 20]);
    expect(parseMeshcomGrcListenList('')).toEqual([]);
    expect(formatMeshcomGrcListenList([232, 20, 232])).toBe('232;20');
    const many = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(formatMeshcomGrcListenList(many).split(';')).toHaveLength(MESHCOM_GRC_MAX_SLOTS);
    expect(parseMeshcomGrcIdList(many.join(';'))).toHaveLength(10);
  });

  it('compacts editor slot texts only on Apply (order, dedupe, cap)', () => {
    expect(compactMeshcomGrcDraftSlots(['232', '', '20', '232', 'abc', '9'])).toEqual([232, 20, 9]);
  });

  it('labels known groups with prefix', () => {
    expect(meshcomGrcChannelLabel(9, (id) => `Group ${id}`)).toBe('LOC (9)');
    expect(meshcomGrcChannelLabel(4242, (id) => `Group ${id}`)).toBe('Group 4242');
  });

  it('merges ALL, listen, local, and history into chat pills', () => {
    const pills = buildMeshcomChatChannels({
      listenGroupIds: [232, 20],
      localGroupIds: [9, 232],
      historyGroupIds: [262, 9],
      labelAll: 'ALL (*)',
      labelGroup: (id) => `Group ${id}`,
    });
    expect(pills[0]).toEqual({ index: 0, name: 'ALL (*)' });
    expect(pills.map((p) => p.index)).toEqual([0, 232, 20, 9, 262]);
    expect(pills.find((p) => p.index === 232)?.name).toBe('OE (232)');
  });

  it('skips hidden GRC ids from listen, local, and history', () => {
    const pills = buildMeshcomChatChannels({
      listenGroupIds: [232, 999],
      localGroupIds: [9, 999],
      historyGroupIds: [262, 999],
      hiddenGroupIds: [999],
      labelAll: 'ALL (*)',
      labelGroup: (id) => `Group ${id}`,
    });
    expect(pills.map((p) => p.index)).toEqual([0, 232, 9, 262]);
  });

  it('searches registry by prefix and id', () => {
    expect(searchMeshcomGrcGroups('LOC').some((g) => g.id === 9)).toBe(true);
    expect(searchMeshcomGrcGroups('262').some((g) => g.prefix === 'DL')).toBe(true);
  });
});
