/**
 * Source contract: RRC unread + sound ingest uses shared resolveRrcAlertType.
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime RRC alert gating (source contract)', () => {
  it('gates bumpUnread with resolveRrcAlertType and the live unread-all setting', () => {
    expect(SOURCE).toContain('resolveRrcAlertType');
    expect(SOURCE).toContain('isRrcUnreadAllRoomMessagesEnabled');
    expect(SOURCE).toMatch(
      /bumpUnread:\s*Boolean\(view\.hub\)\s*&&\s*resolveRrcAlertType\([\s\S]*?notifyMode:\s*isRrcUnreadAllRoomMessagesEnabled\(\)\s*\?\s*'all'\s*:\s*'mentions'/,
    );
  });
});
