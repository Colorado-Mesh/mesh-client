import { describe, expect, it } from 'vitest';

import { titlesForMenuUpdateSettled } from './updateMenuNotifications';

function fakeT(key: string, opts?: { version?: string }): string {
  if (key === 'updateStatus.menuToastAvailableBody' && opts?.version) {
    return `body-${opts.version}`;
  }
  return key;
}

describe('titlesForMenuUpdateSettled', () => {
  it('returns i18n keys for up-to-date', () => {
    expect(titlesForMenuUpdateSettled('upToDate', fakeT)).toEqual({
      title: 'updateStatus.menuToastUpToDateTitle',
      body: 'updateStatus.menuToastUpToDateBody',
    });
  });

  it('includes version for available', () => {
    expect(titlesForMenuUpdateSettled('available', fakeT, { version: '1.2.3' })).toEqual({
      title: 'updateStatus.menuToastAvailableTitle',
      body: 'body-1.2.3',
    });
  });

  it('truncates long error messages', () => {
    const long = 'x'.repeat(500);
    const r = titlesForMenuUpdateSettled('error', fakeT, { message: long });
    expect(r.body.length).toBeLessThanOrEqual(400);
    expect(r.body.endsWith('...')).toBe(true);
  });

  it('falls back to generic update error when message empty', () => {
    expect(titlesForMenuUpdateSettled('error', fakeT, { message: '   ' })).toEqual({
      title: 'updateStatus.menuToastErrorTitle',
      body: 'updateStatus.updateError',
    });
  });
});
