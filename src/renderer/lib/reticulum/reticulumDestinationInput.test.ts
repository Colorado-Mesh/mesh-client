import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';

import { resolveReticulumDestinationHash } from './destHash';
import {
  isReticulumLxmfLink,
  openReticulumDmFromHash,
  parseReticulumDestinationInput,
  parseReticulumLxmfLinkUrl,
  ReticulumChatMissingLxmfError,
} from './reticulumDestinationInput';

const HASH = '368f994c056de0d8882855eb0d627497';

describe('parseReticulumDestinationInput', () => {
  it('parses bare 32-char hex', () => {
    expect(parseReticulumDestinationInput(HASH)).toBe(HASH);
    expect(parseReticulumDestinationInput(HASH.toUpperCase())).toBe(HASH);
  });

  it('parses lxmf:// scheme', () => {
    expect(parseReticulumDestinationInput(`lxmf://${HASH}`)).toBe(HASH);
  });

  it('parses lxmf@ shorthand', () => {
    expect(parseReticulumDestinationInput(`lxmf@${HASH}`)).toBe(HASH);
  });

  it('parses lxmf.delivery@ aspect', () => {
    expect(parseReticulumDestinationInput(`lxmf.delivery@${HASH}`)).toBe(HASH);
  });

  it('strips angle brackets and quotes', () => {
    expect(parseReticulumDestinationInput(`<${HASH}>`)).toBe(HASH);
    expect(parseReticulumDestinationInput(`"${HASH}"`)).toBe(HASH);
  });

  it('returns null for invalid input', () => {
    expect(parseReticulumDestinationInput('')).toBeNull();
    expect(parseReticulumDestinationInput('not-a-hash')).toBeNull();
    expect(parseReticulumDestinationInput('abc')).toBeNull();
    expect(parseReticulumDestinationInput('lxmf://tooshort')).toBeNull();
  });

  it('parses pasted mesh-client rncp receive-dest share lines', () => {
    expect(parseReticulumDestinationInput(`mesh-client:rncp-receive-dest:v1:${HASH}`)).toBe(HASH);
    expect(
      parseReticulumDestinationInput(
        `Here is my receive dest.\n\nmesh-client:rncp-receive-dest:v1:${HASH}`,
      ),
    ).toBe(HASH);
  });
});

describe('isReticulumLxmfLink', () => {
  it('detects lxmf schemes and aspects', () => {
    expect(isReticulumLxmfLink(`lxmf://${HASH}`)).toBe(true);
    expect(isReticulumLxmfLink(`lxmf@${HASH}`)).toBe(true);
    expect(isReticulumLxmfLink(`lxmf.delivery@${HASH}`)).toBe(true);
  });

  it('does not treat bare hash as lxmf link', () => {
    expect(isReticulumLxmfLink(HASH)).toBe(false);
    expect(isReticulumLxmfLink(`${HASH}:/page/index.mu`)).toBe(false);
  });
});

describe('parseReticulumLxmfLinkUrl', () => {
  it('parses lxmf links only', () => {
    expect(parseReticulumLxmfLinkUrl(`lxmf://${HASH}`)).toBe(HASH);
    expect(parseReticulumLxmfLinkUrl(HASH)).toBeNull();
  });
});

describe('openReticulumDmFromHash', () => {
  beforeEach(() => {
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
  });

  it('registers hash and returns node id', () => {
    const nodeId = openReticulumDmFromHash(HASH);
    expect(nodeId).toBeGreaterThan(0);
    expect(resolveReticulumDestinationHash(nodeId)).toBe(HASH);
  });

  it('throws on invalid hash', () => {
    expect(() => openReticulumDmFromHash('bad')).toThrow('Invalid Reticulum destination hash');
  });

  it('remaps telephony dest to lxmf.delivery before registering', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const lxmf = 'e3359f1314aff4fb6261400a8202149b';
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: 'lxst.telephony',
              identity_hash: identity,
              last_seen: 2,
            },
          ],
        ],
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: 'lxmf.delivery',
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    const nodeId = openReticulumDmFromHash(telephony);
    expect(resolveReticulumDestinationHash(nodeId)).toBe(lxmf);
  });

  it('throws ReticulumChatMissingLxmfError when telephony has no lxmf.delivery', () => {
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: 'lxst.telephony',
              identity_hash: '0f79468863d76b3ba574baa92606ffcb',
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    expect(() => openReticulumDmFromHash(telephony)).toThrow(ReticulumChatMissingLxmfError);
  });

  it('opens identity hash on the LXMF fold when lxmf.delivery is known', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const lxmf = 'e3359f1314aff4fb6261400a8202149b';
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          lxmf,
          [
            {
              destination_hash: lxmf,
              aspect: 'lxmf.delivery',
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    const fromIdentity = openReticulumDmFromHash(identity);
    const fromLxmf = openReticulumDmFromHash(lxmf);
    expect(fromIdentity).toBe(fromLxmf);
    expect(resolveReticulumDestinationHash(fromIdentity)).toBe(lxmf);
  });

  it('throws ReticulumChatMissingLxmfError when identity has no lxmf.delivery', () => {
    const identity = '0f79468863d76b3ba574baa92606ffcb';
    const telephony = 'ab1d53d6923d6983dfb4451e3869b878';
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          telephony,
          [
            {
              destination_hash: telephony,
              aspect: 'lxst.telephony',
              identity_hash: identity,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    expect(() => openReticulumDmFromHash(identity)).toThrow(ReticulumChatMissingLxmfError);
  });
});
