import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { markdownHeadingAnchors } from '@/shared/docLinks';

import {
  buildReticulumSharedInstanceClientSnippet,
  EMPTY_RETICULUM_INSTANCE_STATUS,
  fetchReticulumInstanceStatus,
  parseReticulumInstanceStatus,
  parseReticulumSharedInstanceClientSettings,
  RETICULUM_SYSTEM_RNS_DOCS_ANCHOR,
  RETICULUM_SYSTEM_RNS_DOCS_URL,
} from './reticulumInstanceStatus';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('RETICULUM_SYSTEM_RNS_DOCS_URL', () => {
  it('points at a heading that exists in docs/reticulum.md', () => {
    const markdown = readFileSync(join(repoRoot, 'docs/reticulum.md'), 'utf8');
    expect(markdownHeadingAnchors(markdown).has(RETICULUM_SYSTEM_RNS_DOCS_ANCHOR)).toBe(true);
    expect(RETICULUM_SYSTEM_RNS_DOCS_URL).toBe(
      `https://colorado-mesh.github.io/mesh-client/reticulum/#${RETICULUM_SYSTEM_RNS_DOCS_ANCHOR}`,
    );
  });
});

describe('parseReticulumInstanceStatus', () => {
  it('reads shared mode without conflict', () => {
    expect(parseReticulumInstanceStatus({ instance_mode: 'shared' })).toEqual({
      instanceMode: 'shared',
      sharedInstanceConflict: null,
    });
  });

  it('reads standalone with a conflict endpoint', () => {
    expect(
      parseReticulumInstanceStatus({
        instance_mode: 'standalone',
        shared_instance_conflict: '127.0.0.1:37428',
      }),
    ).toEqual({ instanceMode: 'standalone', sharedInstanceConflict: '127.0.0.1:37428' });
  });

  it('ignores unknown modes, blank conflicts, and non-objects', () => {
    expect(
      parseReticulumInstanceStatus({ instance_mode: 'client', shared_instance_conflict: '  ' }),
    ).toEqual(EMPTY_RETICULUM_INSTANCE_STATUS);
    expect(parseReticulumInstanceStatus(null)).toEqual(EMPTY_RETICULUM_INSTANCE_STATUS);
    expect(parseReticulumInstanceStatus('x')).toEqual(EMPTY_RETICULUM_INSTANCE_STATUS);
  });
});

describe('fetchReticulumInstanceStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads /api/v1/status through the sidecar proxy', async () => {
    const proxyGet = vi
      .fn()
      .mockResolvedValue({ instance_mode: 'standalone', shared_instance_conflict: 'rns/default' });
    vi.stubGlobal('window', { electronAPI: { reticulum: { proxyGet } } });
    await expect(fetchReticulumInstanceStatus()).resolves.toEqual({
      instanceMode: 'standalone',
      sharedInstanceConflict: 'rns/default',
    });
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/status');
  });
});

describe('shared instance client settings', () => {
  it('rejects payloads without ports (stack not running)', () => {
    expect(
      parseReticulumSharedInstanceClientSettings({ ok: false, error: 'stack not running' }),
    ).toBeNull();
  });

  it('builds a TCP snippet with both ports and rpc_key', () => {
    const settings = parseReticulumSharedInstanceClientSettings({
      hosting: true,
      shared_instance_type: 'tcp',
      shared_instance_port: 37428,
      instance_control_port: 37429,
      instance_name: 'mesh-client',
      rpc_key: 'abcd',
    });
    expect(settings).not.toBeNull();
    expect(buildReticulumSharedInstanceClientSnippet(settings!)).toBe(
      [
        '[reticulum]',
        'share_instance = Yes',
        'shared_instance_type = tcp',
        'shared_instance_port = 37428',
        'instance_control_port = 37429',
        'rpc_key = abcd',
      ].join('\n'),
    );
  });

  it('builds a unix snippet with instance_name and omits a missing rpc_key', () => {
    const settings = parseReticulumSharedInstanceClientSettings({
      hosting: true,
      shared_instance_type: 'unix',
      shared_instance_port: 37428,
      instance_control_port: 37429,
      instance_name: 'mesh-client',
      rpc_key: null,
    });
    expect(buildReticulumSharedInstanceClientSnippet(settings!)).toBe(
      [
        '[reticulum]',
        'share_instance = Yes',
        'shared_instance_type = unix',
        'instance_name = mesh-client',
      ].join('\n'),
    );
  });

  it('reports not hosting', () => {
    expect(
      parseReticulumSharedInstanceClientSettings({
        hosting: false,
        shared_instance_port: 37428,
        instance_control_port: 37429,
      })?.hosting,
    ).toBe(false);
  });
});
