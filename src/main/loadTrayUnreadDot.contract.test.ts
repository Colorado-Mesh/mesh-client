import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(path.join(import.meta.dirname, 'loadTrayUnreadDot.ts'), 'utf8');

describe('loadTrayUnreadDot (source contract)', () => {
  it('loads the production sibling chunk and exposes a test cache reset', () => {
    expect(SOURCE).toContain("path.join(__dirname, 'tray-unread-dot.js')");
    expect(SOURCE).toContain("requireFromHere('./trayUnreadDot')");
    expect(SOURCE).toContain('export function resetPaintTrayUnreadDotCacheForTests');
  });
});
