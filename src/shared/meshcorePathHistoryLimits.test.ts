import { describe, expect, it } from 'vitest';

import {
  MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT,
  MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT,
} from './meshcorePathHistoryLimits';

describe('meshcorePathHistoryLimits', () => {
  it.each([
    ['global path history', MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT, 10_000],
    ['per-node path history', MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT, 500],
  ] as const)('exposes the %s row limit', (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
