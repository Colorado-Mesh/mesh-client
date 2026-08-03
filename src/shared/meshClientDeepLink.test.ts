import { describe, expect, it } from 'vitest';

import {
  buildLxmaContactUri,
  buildLxmContactUri,
  buildLxmIdentityUri,
  buildMeshcoreChannelAddUri,
  buildMeshcoreContactAddUri,
  classifyMeshClientDeepLink,
  findLxmUrlInArgv,
  isForwardableMeshClientOpenUrl,
} from './meshClientDeepLink';

// Official MeshCore docs fixtures (docs.meshcore.io/qr_codes) — not secrets.
/* eslint-disable no-secrets/no-secrets -- documented public example URIs */
const MESHCORE_DOC_CONTACT =
  'meshcore://contact/add?name=Example+Contact&public_key=9cd8fcf22a47333b591d96a2b848b73f457b1bb1a3ea2453a885f9e5787765b1&type=1';
const MESHCORE_DOC_CHANNEL =
  'meshcore://channel/add?name=Public&secret=8b3387e9c5cdea6ac9e5edbaa115cd72';
/* eslint-enable no-secrets/no-secrets */
const LXMA_DEST = 'a'.repeat(32);
const LXMA_PUBKEY = 'b'.repeat(128);
const MESHCORE_PUBKEY = 'c'.repeat(64);
const CHANNEL_SECRET = 'd'.repeat(32);

describe('meshClientDeepLink', () => {
  it('builds and parses contact URIs', () => {
    const hash = 'a'.repeat(32);
    const uri = buildLxmContactUri(hash, 'Alice');
    expect(uri).toContain('lxm://contact/');
    const parsed = classifyMeshClientDeepLink(uri);
    expect(parsed).toEqual({
      kind: 'lxmContact',
      destinationHash: hash,
      name: 'Alice',
    });
  });

  it('builds and parses identity URIs', () => {
    const uri = buildLxmIdentityUri({
      identityHash: 'b'.repeat(32),
      lxmfHash: 'c'.repeat(32),
      name: 'Me',
    });
    const parsed = classifyMeshClientDeepLink(uri);
    expect(parsed.kind).toBe('lxmIdentity');
    if (parsed.kind === 'lxmIdentity') {
      expect(parsed.identityHash).toBe('b'.repeat(32));
      expect(parsed.lxmfHash).toBe('c'.repeat(32));
      expect(parsed.name).toBe('Me');
    }
  });

  it('soft-fails unknown lxm paper blobs', () => {
    const parsed = classifyMeshClientDeepLink('lxm://ABCDEFGHIJKLMNOP');
    expect(parsed.kind).toBe('lxmPaperUnsupported');
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'finds lxm URL in argv on %s-style process.argv',
    () => {
      const url = `lxm://contact/${'d'.repeat(32)}`;
      expect(findLxmUrlInArgv(['/app/mesh-client', url, '--flag'])).toBe(url);
      expect(findLxmUrlInArgv(['/app/mesh-client'])).toBeUndefined();
    },
  );

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

  describe('lxma:// Columba contact', () => {
    it('builds lowercase lxma URI and round-trips', () => {
      const uri = buildLxmaContactUri(LXMA_DEST.toUpperCase(), LXMA_PUBKEY.toUpperCase());
      expect(uri).toBe(`lxma://${LXMA_DEST}:${LXMA_PUBKEY}`);
      expect(classifyMeshClientDeepLink(uri)).toEqual({
        kind: 'lxmaContact',
        destinationHash: LXMA_DEST,
        publicKeyHex: LXMA_PUBKEY,
      });
    });

    it('accepts case-insensitive scheme', () => {
      const uri = `LXMA://${LXMA_DEST}:${LXMA_PUBKEY}`;
      expect(classifyMeshClientDeepLink(uri).kind).toBe('lxmaContact');
      expect(isForwardableMeshClientOpenUrl(uri)).toBe(true);
    });

    it('rejects wrong segment count, short dest, short pubkey', () => {
      expect(classifyMeshClientDeepLink(`lxma://${LXMA_DEST}`).kind).toBe('unknown');
      expect(classifyMeshClientDeepLink(`lxma://${LXMA_DEST}:${LXMA_PUBKEY}:extra`).kind).toBe(
        'unknown',
      );
      expect(classifyMeshClientDeepLink(`lxma://${'a'.repeat(16)}:${LXMA_PUBKEY}`).kind).toBe(
        'unknown',
      );
      expect(classifyMeshClientDeepLink(`lxma://${LXMA_DEST}:${'b'.repeat(64)}`).kind).toBe(
        'unknown',
      );
      expect(classifyMeshClientDeepLink(`lxma://${LXMA_DEST}:${'b'.repeat(127)}`).kind).toBe(
        'unknown',
      );
    });

    it('throws on invalid build inputs', () => {
      expect(() => buildLxmaContactUri('short', LXMA_PUBKEY)).toThrow(/destination hash/);
      expect(() => buildLxmaContactUri(LXMA_DEST, 'ab')).toThrow(/public key/);
    });
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

  describe('regressions', () => {
    it('keeps lxmf:// and short hex as unknown (not lxma/meshcore)', () => {
      // 32 hex can match the Meshtastic bare-payload heuristic; short hex must not.
      expect(classifyMeshClientDeepLink('abcdef').kind).toBe('unknown');
      expect(classifyMeshClientDeepLink(`lxmf://${'a'.repeat(32)}`).kind).toBe('unknown');
    });

    it('does not forward junk schemes', () => {
      expect(isForwardableMeshClientOpenUrl('ftp://x')).toBe(false);
      expect(isForwardableMeshClientOpenUrl('meshcore://other/path')).toBe(false);
    });
  });
});
