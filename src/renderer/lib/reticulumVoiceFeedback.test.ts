import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAppToast } from '@/renderer/components/Toast';

import { applyVoiceTerminalFeedback, humanizeVoiceIpcError } from './reticulumVoiceFeedback';

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/reticulumVoiceCallTones', () => ({
  playVoiceBusyTone: vi.fn(),
  playVoiceFailTone: vi.fn(),
  playVoiceReorderTone: vi.fn(),
  stopVoiceCallTones: vi.fn(),
}));

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

import {
  playVoiceBusyTone,
  playVoiceFailTone,
  playVoiceReorderTone,
  stopVoiceCallTones,
} from './reticulumVoiceCallTones';

describe('reticulumVoiceFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('humanizeVoiceIpcError maps connect / busy / not-running fragments', () => {
    expect(humanizeVoiceIpcError('active call is not established')).toBe(
      'reticulumVoice.toast.connectFailed',
    );
    expect(humanizeVoiceIpcError('busy')).toBe('reticulumVoice.toast.busy');
    expect(humanizeVoiceIpcError('voice not available')).toBe('reticulumVoice.errors.notRunning');
    expect(humanizeVoiceIpcError('mystery')).toBe('reticulumVoice.errors.callFailed');
  });

  it('applyVoiceTerminalFeedback plays reorder for connect-fail and toasts', () => {
    expect(applyVoiceTerminalFeedback('connect_failed')).toBe('connectFailed');
    expect(stopVoiceCallTones).toHaveBeenCalled();
    expect(playVoiceReorderTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalledWith('reticulumVoice.toast.connectFailed', 'error');
  });

  it('applyVoiceTerminalFeedback plays busy for no-answer', () => {
    expect(applyVoiceTerminalFeedback('ring_timeout')).toBe('noAnswer');
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).toHaveBeenCalled();
  });

  it('applyVoiceTerminalFeedback rejected is tone-only by default', () => {
    expect(applyVoiceTerminalFeedback('rejected')).toBe('rejected');
    expect(playVoiceFailTone).toHaveBeenCalled();
    expect(pushAppToast).not.toHaveBeenCalled();
  });

  it('applyVoiceTerminalFeedback honors showToast: false', () => {
    applyVoiceTerminalFeedback('busy', { showToast: false });
    expect(playVoiceBusyTone).toHaveBeenCalled();
    expect(pushAppToast).not.toHaveBeenCalled();
  });
});
