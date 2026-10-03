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

  it('parses maxContacts (max_contacts/2 byte, companion v3+) from DeviceInfo', () => {
    expect(PATCH).toMatch(/firmwareVer >= 3 && capacityBytes\[0\] > 0 \? capacityBytes\[0\] \* 2/);
    expect(PATCH).toMatch(/\+\s+maxContacts: maxContacts,/);
  });

  it('rejects importContact / addOrUpdateContact with the Err payload (errCode)', () => {
    const matches = PATCH.match(/\+\s+reject\(response\); \/\/ \{ errCode \}/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
