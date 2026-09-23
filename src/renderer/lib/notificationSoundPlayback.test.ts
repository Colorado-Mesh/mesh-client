import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from './appSettingsStorage';
import {
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
      expect(createOscillator).toHaveBeenCalledTimes(4);
    });
    expect(levels[0]).toBe(0.1);
  });

  it('rejects corrupt and overlong imports before they become selectable', async () => {
    decode.mockRejectedValueOnce(new Error('bad codec'));
    await expect(validateNotificationSound(samples)).rejects.toThrow('bad codec');
    decode.mockResolvedValueOnce({ duration: 10.1 });
    await expect(validateNotificationSound(samples)).rejects.toThrow('10 seconds');
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
