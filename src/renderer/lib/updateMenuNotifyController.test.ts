import { describe, expect, it, vi } from 'vitest';

import { createUpdateMenuNotifyController } from './updateMenuNotifyController';

function fakeT(key: string, opts?: { version?: string }): string {
  if (key === 'updateStatus.menuToastAvailableBody' && opts?.version) {
    return `body-${opts.version}`;
  }
  return key;
}

describe('createUpdateMenuNotifyController', () => {
  it('does not notify when checking was not menu-driven', () => {
    const notifyShow = vi.fn().mockResolvedValue(undefined);
    const c = createUpdateMenuNotifyController(fakeT, notifyShow);
    c.onChecking({ notifyOnSettled: false });
    c.flushSettled('upToDate');
    expect(notifyShow).not.toHaveBeenCalled();
  });

  it('notifies once after menu checking then not-available', () => {
    const notifyShow = vi.fn().mockResolvedValue(undefined);
    const c = createUpdateMenuNotifyController(fakeT, notifyShow);
    c.onChecking({ notifyOnSettled: true });
    c.flushSettled('upToDate');
    expect(notifyShow).toHaveBeenCalledTimes(1);
    expect(notifyShow).toHaveBeenCalledWith(
      'updateStatus.menuToastUpToDateTitle',
      'updateStatus.menuToastUpToDateBody',
    );
    c.flushSettled('upToDate');
    expect(notifyShow).toHaveBeenCalledTimes(1);
  });

  it('notifies on available with version', () => {
    const notifyShow = vi.fn().mockResolvedValue(undefined);
    const c = createUpdateMenuNotifyController(fakeT, notifyShow);
    c.onChecking({ notifyOnSettled: true });
    c.flushSettled('available', { version: '9.9.9' });
    expect(notifyShow).toHaveBeenCalledWith('updateStatus.menuToastAvailableTitle', 'body-9.9.9');
  });
});
