import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appGetLocale = vi.fn(() => 'en-US');

vi.mock('electron', () => ({
  app: {
    getLocale: () => appGetLocale(),
  },
}));

import {
  retryRendererSpellcheck,
  setupRendererSpellcheck,
  tryConfigureRendererSpellcheck,
} from './spellcheckSetup';

interface FakeSession {
  availableSpellCheckerLanguages: string[];
  setSpellCheckerEnabled: ReturnType<typeof vi.fn>;
  setSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  getSpellCheckerLanguages: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function createSession(available: string[] = ['en-US']): FakeSession {
  return {
    availableSpellCheckerLanguages: available,
    setSpellCheckerEnabled: vi.fn(),
    setSpellCheckerLanguages: vi.fn(),
    getSpellCheckerLanguages: vi.fn(() => available.slice(0, 1)),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('spellcheckSetup', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.useFakeTimers();
    appGetLocale.mockReturnValue('en-US');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
  });

  it('enables spellcheck on darwin without setting languages', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const sess = createSession([]);
    expect(tryConfigureRendererSpellcheck(sess as never)).toBe(true);
    expect(sess.setSpellCheckerEnabled).toHaveBeenCalledWith(true);
    expect(sess.setSpellCheckerLanguages).not.toHaveBeenCalled();
  });

  it('configures Hunspell languages when dictionaries are available', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sess = createSession(['en-US', 'de-DE']);
    expect(tryConfigureRendererSpellcheck(sess as never)).toBe(true);
    expect(sess.setSpellCheckerLanguages).toHaveBeenCalledWith(['en-US']);
  });

  it('returns false when the dictionary list is empty on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sess = createSession([]);
    expect(tryConfigureRendererSpellcheck(sess as never)).toBe(false);
  });

  it('schedules retries and warns when dictionaries never appear', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sess = createSession([]);
    setupRendererSpellcheck(sess as never);
    expect(sess.on).toHaveBeenCalledWith('spellcheck-dictionary-initialized', expect.any(Function));
    vi.advanceTimersByTime(250 + 1000 + 5000);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('dictionary list still empty after retries'),
    );
  });

  it('retryRendererSpellcheck is a no-op once configured', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sess = createSession(['en-US']);
    setupRendererSpellcheck(sess as never);
    sess.setSpellCheckerLanguages.mockClear();
    retryRendererSpellcheck(sess as never);
    expect(sess.setSpellCheckerLanguages).not.toHaveBeenCalled();
  });

  it('logs and returns false when configure throws', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const sess = createSession(['en-US']);
    sess.setSpellCheckerEnabled.mockImplementation(() => {
      throw new Error('session closed');
    });
    expect(tryConfigureRendererSpellcheck(sess as never)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      'mcL0293 [main] spellcheck: configure failed',
      expect.stringContaining('session closed'),
    );
  });
});
