import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLongSessionNudgeController,
  LONG_SESSION_DOCK_BADGE,
  type LongSessionNudgeHost,
  parseLongSessionRestartPayload,
} from './longSessionNudge';

function makeHost(overrides: Partial<LongSessionNudgeHost> = {}): LongSessionNudgeHost & {
  notes: {
    opts: Record<string, unknown>;
    action?: (index: number) => void;
    click?: () => void;
  }[];
  get dockBadge(): string;
  get flash(): boolean | null;
} {
  const notes: {
    opts: Record<string, unknown>;
    action?: (index: number) => void;
    click?: () => void;
  }[] = [];
  let dockBadge = '';
  let flash: boolean | null = null;
  const host: LongSessionNudgeHost & {
    notes: typeof notes;
    get dockBadge(): string;
    get flash(): boolean | null;
  } = {
    notes,
    get dockBadge() {
      return dockBadge;
    },
    get flash() {
      return flash;
    },
    platform: 'darwin',
    isNotificationSupported: () => true,
    createNotification: (opts) => {
      const entry: (typeof notes)[number] = { opts: opts };
      notes.push(entry);
      return {
        on: (event, listener) => {
          if (event === 'action') {
            entry.action = (index: number) => {
              listener({}, index);
            };
          }
          if (event === 'click') {
            entry.click = () => {
              listener();
            };
          }
        },
        show: () => {},
        close: vi.fn(),
      };
    },
    setDockBadge: (badge) => {
      dockBadge = badge;
    },
    flashFrame: (next) => {
      flash = next;
    },
    showAndFocusMainWindow: vi.fn(),
    relaunchApp: vi.fn(),
    getLastUnreadCount: () => 3,
    logWarn: vi.fn(),
    ...overrides,
  };
  return host;
}

describe('parseLongSessionRestartPayload', () => {
  it('rejects missing title', () => {
    expect(parseLongSessionRestartPayload({ body: 'x' })).toBeNull();
  });

  it('truncates fields', () => {
    const p = parseLongSessionRestartPayload({
      title: 't'.repeat(200),
      body: 'b'.repeat(600),
      restartLabel: 'r'.repeat(40),
      laterLabel: 'l'.repeat(40),
    });
    expect(p?.title).toHaveLength(128);
    expect(p?.body).toHaveLength(512);
    expect(p?.restartLabel).toHaveLength(32);
    expect(p?.laterLabel).toHaveLength(32);
  });
});

describe('createLongSessionNudgeController', () => {
  let host: ReturnType<typeof makeHost>;

  beforeEach(() => {
    host = makeHost();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('darwin: notification with actions, dock badge, no flashFrame', () => {
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    expect(host.notes).toHaveLength(1);
    expect(host.notes[0]?.opts.actions).toEqual([{ text: 'Restart now', type: 'button' }]);
    expect(host.notes[0]?.opts.closeButtonText).toBe('Later');
    expect(host.dockBadge).toBe(LONG_SESSION_DOCK_BADGE);
    expect(host.flash).toBeNull();
  });

  it('win32: notification without actions, flashFrame true', () => {
    host = makeHost({ platform: 'win32' });
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    expect(host.notes[0]?.opts.actions).toBeUndefined();
    expect(host.flash).toBe(true);
    expect(host.dockBadge).toBe('');
  });

  it('action index 0 relaunches and clears', () => {
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    host.notes[0]?.action?.(0);
    expect(host.relaunchApp).toHaveBeenCalled();
    expect(ctl.isActive()).toBe(false);
    expect(host.dockBadge).toBe('3');
  });

  it('click focuses the main window', () => {
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: '',
      laterLabel: '',
    });
    host.notes[0]?.click?.();
    expect(host.showAndFocusMainWindow).toHaveBeenCalled();
  });

  it('clear restores dock badge and resets flag for re-prompt', () => {
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    ctl.clear();
    expect(ctl.isActive()).toBe(false);
    expect(host.dockBadge).toBe('3');
    ctl.show({
      title: 'Restart',
      body: 'Again',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    expect(ctl.isActive()).toBe(true);
    expect(host.notes).toHaveLength(2);
  });

  it('win32 clear stops flash', () => {
    host = makeHost({ platform: 'win32' });
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    ctl.clear();
    expect(host.flash).toBe(false);
  });

  it('second show while active is a no-op', () => {
    const ctl = createLongSessionNudgeController(host);
    const payload = {
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    };
    ctl.show(payload);
    ctl.show(payload);
    expect(host.notes).toHaveLength(1);
  });

  it('suppresses unread dock badge while active on darwin', () => {
    const ctl = createLongSessionNudgeController(host);
    expect(ctl.shouldSuppressUnreadDockBadge()).toBe(false);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: 'Restart now',
      laterLabel: 'Later',
    });
    expect(ctl.shouldSuppressUnreadDockBadge()).toBe(true);
  });

  it('omits actions when restartLabel is empty', () => {
    const ctl = createLongSessionNudgeController(host);
    ctl.show({
      title: 'Restart',
      body: 'Four days',
      restartLabel: '',
      laterLabel: '',
    });
    expect(host.notes[0]?.opts.actions).toBeUndefined();
  });
});
