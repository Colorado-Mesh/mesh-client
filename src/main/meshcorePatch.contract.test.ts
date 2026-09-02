// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const PATCH = readFileSync(
  join(__dirname, '../../patches/@liamcottle__meshcore.js@1.15.0.patch'),
  'utf-8',
);

describe('meshcore.js patch — firmware-ahead push codes', () => {
  it('silently drops CONTROL_DATA push 0x8E', () => {
    expect(PATCH).toContain('0x8E');
    expect(PATCH).toMatch(/responseCode === 0x8E[\s\S]*drop silently/);
  });

  it('emits CONTACT_DELETED (0x8F) with publicKey instead of silent drop', () => {
    expect(PATCH).toContain('0x8F');
    expect(PATCH).toContain('onContactDeletedPush');
    expect(PATCH).toMatch(/this\.emit\(0x8F,\s*\{[\s\S]*publicKey:/);
    expect(PATCH).not.toMatch(
      /responseCode === 0x8F[\s\S]*Unknown push \(0x8F\)[\s\S]*drop silently/,
    );
  });

  it('emits CONTACTS_FULL (0x90)', () => {
    expect(PATCH).toContain('0x90');
    expect(PATCH).toContain('onContactsFullPush');
    expect(PATCH).toMatch(/this\.emit\(0x90,\s*\{\}/);
  });
});
