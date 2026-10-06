import { describe, expect, it } from 'vitest';

import {
  MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT,
  MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT,
} from './meshcorePathHistoryLimits';

describe('meshcorePathHistoryLimits', () => {
  it('defines limits for meshcore path history rows to prevent high memory usage', () => {
    expect(MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT).toBe(10_000);
    expect(MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT).toBe(500);
  });
});
