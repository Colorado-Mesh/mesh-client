import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from './appSettingsStorage';
import {
  clearNotificationSoundCache,
  playMessageNotification,
  previewNotificationSound,
  resetChatNotificationAudioContextForTests,
  stopNotificationSoundPreview,
  validateNotificationSound,
} from './chatNotifications';

describe('configured notification playback', () => {
  const id = 'b'.repeat(64);
  const samples = btoa('test audio');
  const sources: {
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
  }[] = [];
  const levels: number[] = [];
  const decode = vi.fn();
  const createOscillator = vi.fn();
  const createBufferSource = vi.fn();
  const resume = vi.fn();
  const releaseMetadata = vi.fn();
  const revokeUrl = vi.fn();
  let metadataDuration: number;
  let metadataResult: 'loaded' | 'error' | 'timeout';
  let state: AudioContextState;
  const makeSource = () => {
    const source = {
      stop: vi.fn(),
      start: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
      onended: null as (() => void) | null,
      frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    };
    sources.push(source);
    return source;
  };

  beforeEach(() => {
    localStorage.clear();
    sources.length = 0;
    levels.length = 0;
    state = 'running';
    metadataDuration = 0.2;
    metadataResult = 'loaded';
    releaseMetadata.mockClear();
    revokeUrl.mockClear();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL() {
          return 'blob:notification-sound';
        }
        static revokeObjectURL = revokeUrl;
      },
    );
    vi.stubGlobal(
      'Audio',
      class {
        onloadedmetadata: (() => void) | null = null;
        onerror: (() => void) | null = null;
        preload = '';
        get duration() {
          return metadataDuration;
        }
        set src(_url: string) {
          void Promise.resolve().then(() => {
            if (metadataResult === 'loaded') this.onloadedmetadata?.();
            else if (metadataResult === 'error') this.onerror?.();
          });
        }
        removeAttribute = vi.fn();
        load = releaseMetadata;
      },
    );
    decode.mockReset().mockResolvedValue({ duration: 0.2 });
    createOscillator.mockReset().mockImplementation(makeSource);
    createBufferSource.mockReset().mockImplementation(makeSource);
    resume.mockReset().mockResolvedValue(undefined);
    resetChatNotificationAudioContextForTests();
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        destination = {};
        get state() {
          return state;
        }
        resume = resume;
        decodeAudioData = decode;
        createOscillator = createOscillator;
        createBufferSource = createBufferSource;
        createGain() {
          return {
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: {
              setValueAtTime: (level: number) => {
                levels.push(level);
              },
              exponentialRampToValueAtTime: vi.fn(),
            },
          };
        }
      },
    );
    vi.mocked(window.electronAPI.notificationSounds.read).mockReset().mockResolvedValue(samples);
  });
  afterEach(() => {
    resetChatNotificationAudioContextForTests();
    vi.useRealTimers();
  });

  it('plays the selected preset at its volume and honors a muted ordinary event', () => {
    mergeAppSetting(
      'notificationSounds',
      { channel: { sound: 'chime', volume: 50 }, dm: { sound: 'bell', volume: 0 } },
      'test',
    );
    playMessageNotification('channel');
    expect(createOscillator).toHaveBeenCalledTimes(2);
    expect(levels[0]).toBe(0.5);
    playMessageNotification('dm');
    expect(createOscillator).toHaveBeenCalledTimes(2);
  });

  it('loads and decodes custom audio once for repeated incoming events', async () => {
    mergeAppSetting(
      'notificationSounds',
      { dm: { sound: { id, name: 'test' }, volume: 40 } },
      'test',
    );
    playMessageNotification('dm');
    playMessageNotification('dm');
    await vi.waitFor(() => {
      expect(createBufferSource).toHaveBeenCalledTimes(2);
    });
    expect(window.electronAPI.notificationSounds.read).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledOnce();
    expect(levels).toEqual([0.4, 0.4]);
  });

  it('falls back to the original emergency sound when custom audio is missing', async () => {
    vi.mocked(window.electronAPI.notificationSounds.read).mockResolvedValue(null);
    mergeAppSetting(
      'notificationSounds',
      { mecpSiren: { sound: { id, name: 'missing' }, volume: 0 } },
      'test',
    );
    playMessageNotification('mecpSiren');
    await vi.waitFor(() => {
      expect(createOscillator).toHaveBeenCalledTimes(6);
    });
    expect(levels[0]).toBe(0.1);
  });

  it('rejects corrupt and overlong imports before they become selectable', async () => {
    decode.mockRejectedValueOnce(new Error('bad codec'));
    await expect(validateNotificationSound(samples)).rejects.toThrow('bad codec');
    decode.mockResolvedValueOnce({ duration: 10.1 });
    await expect(validateNotificationSound(samples)).rejects.toThrow('10 seconds');
  });

  it.each([0, NaN, Infinity, 3600])(
    'rejects metadata duration %s before full decoding',
    async (duration) => {
      metadataDuration = duration;
      await expect(validateNotificationSound(samples)).rejects.toThrow('10 seconds');
      expect(decode).not.toHaveBeenCalled();
      expect(releaseMetadata).toHaveBeenCalledOnce();
      expect(revokeUrl).toHaveBeenCalledWith('blob:notification-sound');
    },
  );

  it('cleans up unsupported and stalled metadata probes without decoding', async () => {
    metadataResult = 'error';
    await expect(validateNotificationSound(samples)).rejects.toThrow('Unsupported audio metadata');
    metadataResult = 'timeout';
    vi.useFakeTimers();
    const failed = expect(validateNotificationSound(samples)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    expect(decode).not.toHaveBeenCalled();
    expect(releaseMetadata).toHaveBeenCalledTimes(2);
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });

  it('retries an incoming sound after a cooldown without repeatedly reading failed audio', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.mocked(window.electronAPI.notificationSounds.read).mockRejectedValueOnce(new Error('IPC'));
    mergeAppSetting(
      'notificationSounds',
      { dm: { sound: { id, name: 'retry.wav' }, volume: 100 } },
      'test',
    );
    playMessageNotification('dm');
    await vi.waitFor(() => {
      expect(createOscillator).toHaveBeenCalledTimes(2);
    });
    now.mockReturnValue(59_999);
    playMessageNotification('dm');
    await vi.waitFor(() => {
      expect(createOscillator).toHaveBeenCalledTimes(4);
    });
    expect(window.electronAPI.notificationSounds.read).toHaveBeenCalledOnce();
    now.mockReturnValue(60_000);
    playMessageNotification('dm');
    await vi.waitFor(() => {
      expect(createBufferSource).toHaveBeenCalledOnce();
    });
    expect(window.electronAPI.notificationSounds.read).toHaveBeenCalledTimes(2);
  });

  it('retries the same custom sound after its imported copy is repaired', async () => {
    const setting = { sound: { id, name: 'repaired.wav' }, volume: 100 };
    vi.mocked(window.electronAPI.notificationSounds.read).mockResolvedValueOnce(null);
    mergeAppSetting('notificationSounds', { dm: setting }, 'test');
    playMessageNotification('dm');
    await vi.waitFor(() => {
      expect(createOscillator).toHaveBeenCalledTimes(2);
    });
    clearNotificationSoundCache('dm');
    const preview = previewNotificationSound('dm', setting);
    await vi.waitFor(() => {
      expect(createBufferSource).toHaveBeenCalledOnce();
    });
    sources[2].onended?.();
    await preview;
    expect(window.electronAPI.notificationSounds.read).toHaveBeenCalledTimes(2);
  });

  it('allows an explicit preview retry after a transient read failure', async () => {
    const setting = { sound: { id, name: 'retry.wav' }, volume: 100 };
    vi.mocked(window.electronAPI.notificationSounds.read).mockRejectedValueOnce(new Error('IPC'));
    await expect(previewNotificationSound('dm', setting)).rejects.toThrow('IPC');
    const preview = previewNotificationSound('dm', setting);
    await vi.waitFor(() => {
      expect(createBufferSource).toHaveBeenCalledOnce();
    });
    sources[0].onended?.();
    await preview;
    expect(window.electronAPI.notificationSounds.read).toHaveBeenCalledTimes(2);
  });

  it('cancels a preview while resuming audio without scheduling it later', async () => {
    state = 'suspended';
    let resumed!: () => void;
    resume.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resumed = resolve;
      }),
    );
    const preview = previewNotificationSound('channel', { sound: 'default', volume: 100 });
    stopNotificationSoundPreview();
    resumed();
    await preview;
    expect(createOscillator).not.toHaveBeenCalled();
  });

  it('stops only preview sources, leaving real incoming alerts running', async () => {
    playMessageNotification('channel');
    const incoming = sources[0];
    const preview = previewNotificationSound('dm', { sound: 'default', volume: 100 });
    stopNotificationSoundPreview();
    await preview;
    expect(incoming.stop).toHaveBeenCalledOnce(); // Its scheduled natural end only.
    expect(sources[1]?.stop).toHaveBeenCalledTimes(2);
    expect(sources[2]?.stop).toHaveBeenCalledTimes(2);
  });

  it('finishes preview when its audio ends and reports an unavailable custom recording', async () => {
    const preview = previewNotificationSound('channel', { sound: 'bell', volume: 100 });
    sources[0].onended?.();
    await preview;
    vi.mocked(window.electronAPI.notificationSounds.read).mockResolvedValue(null);
    await expect(
      previewNotificationSound('channel', { sound: { id, name: 'gone' }, volume: 50 }),
    ).rejects.toThrow('unavailable');
  });
});
