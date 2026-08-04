import { describe, expect, it } from 'vitest';

import {
  classifyVoiceTerminalReason,
  shouldToastVoiceTerminal,
  voiceToastKeyForTerminal,
} from './reticulumVoiceOutcome';

describe('classifyVoiceTerminalReason', () => {
  it('maps busy / rejected / timeout / clean hangup', () => {
    expect(classifyVoiceTerminalReason('busy')).toBe('busy');
    expect(classifyVoiceTerminalReason('LineBusy')).toBe('busy');
    expect(classifyVoiceTerminalReason('rejected')).toBe('rejected');
    expect(classifyVoiceTerminalReason('ring_timeout')).toBe('noAnswer');
    expect(classifyVoiceTerminalReason('no answer')).toBe('noAnswer');
    expect(classifyVoiceTerminalReason(null)).toBe('completed');
    expect(classifyVoiceTerminalReason('hangup')).toBe('completed');
    expect(classifyVoiceTerminalReason('established')).toBe('completed');
    expect(classifyVoiceTerminalReason('terminated')).toBe('completed');
    expect(classifyVoiceTerminalReason('encode exploded')).toBe('failed');
  });

  it('maps connect-phase failures to connectFailed', () => {
    expect(classifyVoiceTerminalReason('discovery timeout')).toBe('connectFailed');
    expect(classifyVoiceTerminalReason('safety_timeout')).toBe('connectFailed');
    expect(classifyVoiceTerminalReason('active call is not established')).toBe('connectFailed');
    expect(classifyVoiceTerminalReason('unreachable peer')).toBe('connectFailed');
    expect(classifyVoiceTerminalReason('no path')).toBe('connectFailed');
  });

  it('maps toast keys; only busy and connectFailed toast by default', () => {
    expect(voiceToastKeyForTerminal('busy')).toBe('reticulumVoice.toast.busy');
    expect(voiceToastKeyForTerminal('connectFailed')).toBe('reticulumVoice.toast.connectFailed');
    expect(voiceToastKeyForTerminal('noAnswer')).toBe('reticulumVoice.toast.noAnswer');
    expect(voiceToastKeyForTerminal('completed')).toBeNull();
    expect(shouldToastVoiceTerminal('busy')).toBe(true);
    expect(shouldToastVoiceTerminal('connectFailed')).toBe(true);
    expect(shouldToastVoiceTerminal('rejected')).toBe(false);
    expect(shouldToastVoiceTerminal('noAnswer')).toBe(false);
    expect(shouldToastVoiceTerminal('failed')).toBe(false);
    expect(shouldToastVoiceTerminal('completed')).toBe(false);
  });
});
