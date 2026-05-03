// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

describe('Windows long-path application manifest (packaging contract)', () => {
  it('wires electron-builder afterPack and embeds longPathAware in the manifest resource', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toContain('afterPack: scripts/electron-builder-after-pack.cjs');

    const hook = readFileSync(
      join(REPO_ROOT, 'scripts', 'electron-builder-after-pack.cjs'),
      'utf-8',
    );
    expect(hook).toContain("'application-manifest'");
    expect(hook).toContain('mesh-client-long-path.manifest.xml');

    const manifest = readFileSync(
      join(REPO_ROOT, 'resources', 'win', 'mesh-client-long-path.manifest.xml'),
      'utf-8',
    );
    expect(manifest).toContain('urn:schemas-microsoft-com:asm.v3');
    expect(manifest).toContain('http://schemas.microsoft.com/SMI/2016/WindowsSettings');
    expect(manifest).toMatch(/ws2:longPathAware>true</);
  });
});
