/* eslint-disable no-secrets/no-secrets -- regression fixture from reporter (not a live credential) */
import { describe, expect, it } from 'vitest';

import { splitChannelPskLine } from './meshtasticChannelPskLine';

/** Reporter regression key (32-byte AES-256). */
const REPORTER_LONGFAST_LINE = 'LongFast@0=ZUdhbGNWeThMN2FjcTNwb2wxcnFPRFc0UmJLSFRlY3E=';

describe('splitChannelPskLine', () => {
  it('splits ChannelName@index=base64 preserving trailing padding', () => {
    const split = splitChannelPskLine(REPORTER_LONGFAST_LINE);
    expect(split).toEqual({
      kind: 'named',
      name: 'LongFast',
      index: 0,
      b64: 'ZUdhbGNWeThMN2FjcTNwb2wxcnFPRFc0UmJLSFRlY3E=',
    });
  });

  it('splits ChannelName=base64 preserving trailing == padding', () => {
    const split = splitChannelPskLine('HamNet=QUJDREVGR0hJSktMTU5PUFFSU1RVVldY==');
    expect(split?.kind).toBe('named');
    if (split?.kind === 'named') {
      expect(split.name).toBe('HamNet');
      expect(split.b64).toBe('QUJDREVGR0hJSktMTU5PUFFSU1RVVldY==');
    }
  });

  it('treats bare padded base64 as bare (not named)', () => {
    const bare = 'ZUdhbGNWeThMN2FjcTNwb2wxcnFPRFc0UmJLSFRlY3E=';
    expect(splitChannelPskLine(bare)).toEqual({ kind: 'bare', b64: bare });
  });

  it('treats bare base64 with == padding as bare', () => {
    const bare = '1PG7OiApB1nwvP+rz05pAQ==';
    expect(splitChannelPskLine(bare)).toEqual({ kind: 'bare', b64: bare });
  });

  it('returns null for empty input', () => {
    expect(splitChannelPskLine('')).toBeNull();
    expect(splitChannelPskLine('   ')).toBeNull();
  });

  it('returns named line with empty base64 instead of bare fallthrough', () => {
    expect(splitChannelPskLine('LongFast@0=')).toEqual({
      kind: 'named',
      name: 'LongFast',
      index: 0,
      b64: '',
    });
  });

  it('returns named line with empty base64 for Name= without index', () => {
    expect(splitChannelPskLine('HamNet=')).toEqual({
      kind: 'named',
      name: 'HamNet',
      b64: '',
    });
  });
});
