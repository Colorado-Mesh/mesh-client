import { describe, expect, it } from 'vitest';

import { classifyVoiceTerminalReason, voiceToastKeyForTerminal } from './reticulumVoiceOutcome';

describe('classifyVoiceTerminalReason', () => {
  it('maps busy / rejected / timeout / clean hangup', () => {
    expect(classifyVoiceTerminalReason('busy')).toBe('busy');
    expect(classifyVoiceTerminalReason('LineBusy')).toBe('busy');
    expect(classifyVoiceTerminalReason('rejected')).toBe('rejected');
    expect(classifyVoiceTerminalReason('discovery timeout')).toBe('noAnswer');
    expect(classifyVoiceTerminalReason('safety_timeout')).toBe('noAnswer');
    expect(classifyVoiceTerminalReason(null)).toBe('completed');
    expect(classifyVoiceTerminalReason('hangup')).toBe('completed');
    expect(classifyVoiceTerminalReason('encode exploded')).toBe('failed');
  });

  it('maps toast keys for unsuccessful kinds only', () => {
    expect(voiceToastKeyForTerminal('busy')).toBe('reticulumVoice.toast.busy');
    expect(voiceToastKeyForTerminal('noAnswer')).toBe('reticulumVoice.toast.noAnswer');
    expect(voiceToastKeyForTerminal('completed')).toBeNull();
  });
});
