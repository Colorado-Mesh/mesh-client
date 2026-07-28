import { describe, expect, it } from 'vitest';

import {
  buildLxmContactUri,
  buildLxmIdentityUri,
  classifyMeshClientDeepLink,
  findLxmUrlInArgv,
  isForwardableMeshClientOpenUrl,
} from './meshClientDeepLink';

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
});
