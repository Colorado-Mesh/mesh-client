// @vitest-environment node
// flake.nix derives the Reticulum stack sources from
// reticulum-sidecar/ratspeak-stack-pins.env — the single source of truth it
// shares with scripts/clone-ratspeak-stack.sh. Keep the three in sync: the
// flake must not hard-code stack revisions, must consume every pin in the
// pins file, and must fetch the same repositories the clone script checks
// out. (Pin bumps only touch ratspeak-stack-pins.env; no flake.nix /
// flake.lock change is needed.) The flake's nixpkgs electron_N / pnpm_N /
// nodejs_N attributes must also track the majors in package.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const flakeNix = read('flake.nix');
const pinsEnv = read('reticulum-sidecar/ratspeak-stack-pins.env');
const cloneScript = read('scripts/clone-ratspeak-stack.sh');

/** Owner/repo/pin mapping — must match scripts/clone-ratspeak-stack.sh. */
const STACK_REPOS = [
  { owner: 'ratspeak', repo: 'rsReticulum', pin: 'RS_RETICULUM_PIN' },
  { owner: 'ratspeak', repo: 'rsLXMF', pin: 'RS_LXMF_PIN' },
  { owner: 'Colorado-Mesh', repo: 'rsNomad', pin: 'RS_NOMAD_PIN' },
  { owner: 'ratspeak', repo: 'rsLXST', pin: 'RS_LXST_PIN' },
  { owner: 'ratspeak', repo: 'lrgp-rs', pin: 'RS_LRGP_PIN' },
];

const pinDeclarations = [...pinsEnv.matchAll(/^([A-Z0-9_]+_PIN)=(.*)$/gm)].map((m) => ({
  pin: m[1],
  rev: m[2],
}));

/** flake.nix with runs of whitespace collapsed — tolerant of reformatting. */
const normalizedFlake = flakeNix.replace(/\s+/g, ' ');

describe('flake.nix Reticulum stack sourcing', () => {
  it('fetches every stack repo at its ratspeak-stack-pins.env pin', () => {
    for (const { owner, repo, pin } of STACK_REPOS) {
      expect(normalizedFlake).toContain(`stackFetch "${owner}" "${repo}" "${pin}"`);
    }
  });

  it('consumes every pin declared in ratspeak-stack-pins.env', () => {
    expect(pinDeclarations.length).toBeGreaterThan(0);
    for (const { pin } of pinDeclarations) {
      expect(flakeNix).toContain(`"${pin}"`);
    }
    for (const { pin } of STACK_REPOS) {
      expect(pinDeclarations.map((p) => p.pin)).toContain(pin);
    }
  });

  it('keeps pins.env revisions well-formed 40-hex SHAs', () => {
    for (const { pin, rev } of pinDeclarations) {
      expect(rev, `${pin} must be a full 40-hex revision`).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('does not hard-code stack revisions in flake.nix', () => {
    expect(flakeNix).not.toMatch(/[0-9a-f]{40}/);
  });

  it('fetches the same repos clone-ratspeak-stack.sh checks out', () => {
    for (const { owner, repo } of STACK_REPOS) {
      expect(cloneScript).toContain(`https://github.com/${owner}/${repo}.git`);
    }
  });

  it('applies overlays from the shared apply list, not a duplicated one', () => {
    expect(flakeNix).toContain('source scripts/lib/ratspeak-overlay-apply-list.sh');
    expect(flakeNix).not.toContain('overlayOrder');
  });
});

const packageJson = JSON.parse(read('package.json'));

/** Every distinct `<attr>_<major>` nixpkgs attribute major in flake.nix. */
function flakeMajors(attrRe) {
  return [...new Set([...flakeNix.matchAll(attrRe)].map((m) => m[1]))];
}

function leadingMajor(spec) {
  const match = /(\d+)/.exec(spec);
  if (!match) throw new Error(`no major version in ${spec}`);
  return match[1];
}

describe('flake.nix toolchain majors follow package.json', () => {
  it('uses the nixpkgs Electron major matching devDependencies.electron', () => {
    expect(flakeMajors(/\belectron_(\d+)\b/g)).toEqual([
      leadingMajor(packageJson.devDependencies.electron),
    ]);
  });

  it('uses the nixpkgs pnpm major matching packageManager', () => {
    expect(flakeMajors(/\bpnpm_(\d+)\b/g)).toEqual([
      leadingMajor(packageJson.packageManager.split('@')[1]),
    ]);
  });

  it('uses the nixpkgs Node.js major matching engines.node', () => {
    expect(flakeMajors(/\bnodejs_(\d+)\b/g)).toEqual([leadingMajor(packageJson.engines.node)]);
  });
});
