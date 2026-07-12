// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const PATCH = readFileSync(
  join(__dirname, '../../patches/@liamcottle__meshcore.js@1.13.0.patch'),
  'utf-8',
);

describe('meshcore.js patch — firmware-ahead push codes', () => {
  it('silently drops unknown push 0x8E (142) alongside 0x8F', () => {
    expect(PATCH).toContain('0x8E');
    expect(PATCH).toContain('0x8F');
    expect(PATCH).toMatch(/responseCode === 0x8E[\s\S]*firmware ahead of library/);
  });
});
