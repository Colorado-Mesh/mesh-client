import { describe, expect, it } from 'vitest';

import {
  buildMeshcoreChannelAddUri,
  buildMeshcoreContactAddUri,
  classifyMeshClientDeepLink,
  findMeshDeepLinkInArgv,
  isForwardableMeshClientOpenUrl,
} from './meshClientDeepLink';

// Official MeshCore docs fixtures (docs.meshcore.io/qr_codes) — not secrets.
/* eslint-disable no-secrets/no-secrets -- documented public example URIs */
const MESHCORE_DOC_CONTACT =
  'meshcore://contact/add?name=Example+Contact&public_key=9cd8fcf22a47333b591d96a2b848b73f457b1bb1a3ea2453a885f9e5787765b1&type=1';
const MESHCORE_DOC_CHANNEL =
  'meshcore://channel/add?name=Public&secret=8b3387e9c5cdea6ac9e5edbaa115cd72';
/* eslint-enable no-secrets/no-secrets */
const MESHCORE_PUBKEY = 'c'.repeat(64);
const CHANNEL_SECRET = 'd'.repeat(32);

describe('meshClientDeepLink', () => {
  it('classifies bare Meshtastic channel payloads as forwardable', () => {
    const bare = `${'A'.repeat(40)}_-`;
    const parsed = classifyMeshClientDeepLink(bare);
    expect(parsed).toEqual({ kind: 'meshtasticChannel', url: bare });
    expect(isForwardableMeshClientOpenUrl(bare)).toBe(true);
  });

  it('forwards Meshtastic channel URLs and drops unrelated schemes', () => {
    expect(isForwardableMeshClientOpenUrl('https://meshtastic.org/e/#abc')).toBe(true);
    expect(isForwardableMeshClientOpenUrl('https://example.com')).toBe(false);
  });

  describe('meshcore:// contact/add', () => {
    it('builds with encoded name and round-trips', () => {
      const uri = buildMeshcoreContactAddUri({
        name: 'Example Contact',
        publicKeyHex: MESHCORE_PUBKEY.toUpperCase(),
        type: 1,
      });
      expect(uri).toContain('meshcore://contact/add?');
      expect(uri).toContain('name=Example+Contact');
      expect(uri).toContain(`public_key=${MESHCORE_PUBKEY}`);
      expect(uri).toContain('type=1');
      expect(classifyMeshClientDeepLink(uri)).toEqual({
        kind: 'meshcoreContactAdd',
        name: 'Example Contact',
        publicKeyHex: MESHCORE_PUBKEY,
        type: 1,
      });
    });

    it('encodes unicode names', () => {
      const uri = buildMeshcoreContactAddUri({
        name: 'café',
        publicKeyHex: MESHCORE_PUBKEY,
        type: 2,
      });
      const parsed = classifyMeshClientDeepLink(uri);
      expect(parsed).toMatchObject({ kind: 'meshcoreContactAdd', name: 'café', type: 2 });
    });

    it.each([1, 2, 3, 4] as const)('accepts contact type %i', (type) => {
      const uri = buildMeshcoreContactAddUri({
        name: 'N',
        publicKeyHex: MESHCORE_PUBKEY,
        type,
      });
      const parsed = classifyMeshClientDeepLink(uri);
      expect(parsed).toMatchObject({ kind: 'meshcoreContactAdd', type });
    });

    it('accepts official docs fixture and case-insensitive scheme', () => {
      expect(classifyMeshClientDeepLink(MESHCORE_DOC_CONTACT)).toEqual({
        kind: 'meshcoreContactAdd',
        name: 'Example Contact',
        publicKeyHex: '9cd8fcf22a47333b591d96a2b848b73f457b1bb1a3ea2453a885f9e5787765b1',
        type: 1,
      });
      expect(
        classifyMeshClientDeepLink(MESHCORE_DOC_CONTACT.replace('meshcore://', 'MESHCORE://')).kind,
      ).toBe('meshcoreContactAdd');
      expect(isForwardableMeshClientOpenUrl(MESHCORE_DOC_CONTACT)).toBe(true);
    });

    it('accepts reordered query params and ignores extras', () => {
      const uri = `meshcore://contact/add?type=3&extra=1&public_key=${MESHCORE_PUBKEY}&name=Room`;
      expect(classifyMeshClientDeepLink(uri)).toEqual({
        kind: 'meshcoreContactAdd',
        name: 'Room',
        publicKeyHex: MESHCORE_PUBKEY,
        type: 3,
      });
    });

    it('rejects missing/invalid params', () => {
      expect(
        classifyMeshClientDeepLink(`meshcore://contact/add?public_key=${MESHCORE_PUBKEY}&type=1`)
          .kind,
      ).toBe('unknown');
      expect(
        classifyMeshClientDeepLink(
          `meshcore://contact/add?name=A&public_key=${'x'.repeat(63)}&type=1`,
        ).kind,
      ).toBe('unknown');
      expect(
        classifyMeshClientDeepLink(
          `meshcore://contact/add?name=A&public_key=${MESHCORE_PUBKEY}&type=0`,
        ).kind,
      ).toBe('unknown');
      expect(
        classifyMeshClientDeepLink(
          `meshcore://contact/add?name=A&public_key=${MESHCORE_PUBKEY}&type=abc`,
        ).kind,
      ).toBe('unknown');
      expect(
        classifyMeshClientDeepLink(`meshcore://contact/add?name=A&public_key=${MESHCORE_PUBKEY}`)
          .kind,
      ).toBe('unknown');
    });

    it('throws on invalid build inputs', () => {
      expect(() => buildMeshcoreContactAddUri({ name: 'A', publicKeyHex: 'ab', type: 1 })).toThrow(
        /public key/,
      );
      expect(() =>
        buildMeshcoreContactAddUri({
          name: '   ',
          publicKeyHex: MESHCORE_PUBKEY,
          type: 1,
        }),
      ).toThrow(/name/);
      expect(() =>
        buildMeshcoreContactAddUri({
          name: 'A',
          publicKeyHex: MESHCORE_PUBKEY,
          type: 9 as 1,
        }),
      ).toThrow(/contact type/);
    });
  });

  describe('meshcore:// channel/add', () => {
    it('builds and round-trips with optional region_scope', () => {
      const uri = buildMeshcoreChannelAddUri({
        name: 'Public',
        secretHex: CHANNEL_SECRET.toUpperCase(),
        regionScope: 'NA',
      });
      expect(uri).toContain('meshcore://channel/add?');
      expect(uri).toContain(`secret=${CHANNEL_SECRET}`);
      expect(uri).toContain('region_scope=NA');
      expect(classifyMeshClientDeepLink(uri)).toEqual({
        kind: 'meshcoreChannelAdd',
        name: 'Public',
        secretHex: CHANNEL_SECRET,
        regionScope: 'NA',
      });
    });

    it('accepts official docs fixture', () => {
      const secretHex = new URL(MESHCORE_DOC_CHANNEL).searchParams.get('secret') ?? '';
      expect(classifyMeshClientDeepLink(MESHCORE_DOC_CHANNEL)).toEqual({
        kind: 'meshcoreChannelAdd',
        name: 'Public',
        secretHex,
      });
      expect(isForwardableMeshClientOpenUrl(MESHCORE_DOC_CHANNEL)).toBe(true);
    });

    it('rejects missing/invalid secret', () => {
      expect(classifyMeshClientDeepLink('meshcore://channel/add?name=Public').kind).toBe('unknown');
      expect(
        classifyMeshClientDeepLink(`meshcore://channel/add?name=Public&secret=${'a'.repeat(31)}`)
          .kind,
      ).toBe('unknown');
    });

    it('throws on invalid build secret', () => {
      expect(() => buildMeshcoreChannelAddUri({ name: '  ', secretHex: CHANNEL_SECRET })).toThrow(
        /name/,
      );
      expect(() => buildMeshcoreChannelAddUri({ name: 'P', secretHex: 'aa' })).toThrow(
        /channel secret/,
      );
    });
  });

  describe('findMeshDeepLinkInArgv', () => {
    it('returns the first meshcore:// or meshtastic:// argument', () => {
      expect(
        findMeshDeepLinkInArgv(['/app/Mesh Hub', '--flag', `  ${MESHCORE_DOC_CHANNEL}  `]),
      ).toBe(MESHCORE_DOC_CHANNEL);
      expect(findMeshDeepLinkInArgv(['meshtastic://e/#abc'])).toBe('meshtastic://e/#abc');
    });

    it('ignores retired lxm:// links and unrelated arguments', () => {
      expect(findMeshDeepLinkInArgv(['lxm://contact/' + 'a'.repeat(32), 'https://x'])).toBe(
        undefined,
      );
    });
  });

  describe('regressions', () => {
    it('does not forward junk schemes', () => {
      expect(isForwardableMeshClientOpenUrl('ftp://x')).toBe(false);
      expect(isForwardableMeshClientOpenUrl('meshcore://other/path')).toBe(false);
    });
  });
});
