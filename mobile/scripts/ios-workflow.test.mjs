// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { load } from 'js-yaml';
import { afterAll, describe, expect, it } from 'vitest';

// Paths below (and `git ls-files` for the trigger check) are repo-relative. The mobile-host Vitest
// project runs each file in its own forked process, so changing directory here is file-local.
process.chdir(path.resolve(import.meta.dirname, '../..'));

const WORKFLOW_PATH = '.github/workflows/mobile-ios.yaml';
const SMOKE_SCRIPT = 'mobile/ios/scripts/ci-simulator-smoke.sh';
const IOS_SOURCES = 'mobile/ios/App/App';
/** The plugin contract moved with the mobile workspace package; accept either location. */
const CONTRACTS = ['mobile/src/native/contracts.ts', 'src/mobile/native/contracts.ts'].find(
  (file) => existsSync(file),
);

const workflow = load(readFileSync(WORKFLOW_PATH, 'utf8'));
const smokeScript = readFileSync(SMOKE_SCRIPT, 'utf8');
const paths = workflow.on.pull_request.paths;
const included = paths.filter((pattern) => !pattern.startsWith('!'));
const excluded = paths.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1));
// Untracked, non-ignored files count too, so the test also holds before a new file is staged.
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
).split('\n');

/** GitHub `paths` globs: `*` stays inside one directory, `**` crosses directories. */
function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
  }
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`^${source}$`); // eslint-disable-line security/detect-non-literal-regexp -- glob escaped above
}

const includeRes = included.map(globToRegExp);
const excludeRes = excluded.map(globToRegExp);
/** Whether a change to `file` alone starts the workflow (a later `!` pattern wins). */
const triggers = (file) =>
  includeRes.some((re) => re.test(file)) && !excludeRes.some((re) => re.test(file));

const job = workflow.jobs.simulator;
const stepIndex = (predicate) => job.steps.findIndex(predicate);
const runOf = (step) => String(step.run ?? '');

describe('Mobile iOS simulator workflow', () => {
  it('matches a tracked file with every path pattern', () => {
    const unmatched = [...included, ...excluded].filter(
      (pattern) => !trackedFiles.some((file) => globToRegExp(pattern).test(file)),
    );
    expect(unmatched, 'path patterns that match no tracked file').toEqual([]);
  });

  it.each([
    'mobile/ios/App/App/Plugins/MeshNetPlugin.swift',
    'mobile/ios/App/App/Info.plist',
    'mobile/ios/App/App.xcodeproj/project.pbxproj',
    'mobile/ios/mesh.xcconfig',
    SMOKE_SCRIPT,
    'src/renderer/App.tsx',
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/shared/electron-api.types.ts',
    'reticulum-sidecar/Cargo.toml',
    'pnpm-lock.yaml',
    WORKFLOW_PATH,
  ])('runs for a change to %s', (file) => {
    expect(trackedFiles).toContain(file);
    expect(triggers(file)).toBe(true);
  });

  it.each([
    'src/renderer/lib/mobileViewport.test.ts',
    'src/main/index.contract.test.ts',
    'docs/ci-cd.md',
    'README.md',
    '.github/workflows/tests.yaml',
  ])('does not run for a change to %s alone', (file) => {
    expect(triggers(file)).toBe(false);
  });

  it('is a PR/manual check with read-only permissions', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['build_sidecar']);
    expect(workflow.on.workflow_dispatch.inputs.build_sidecar.default).toBe(false);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
  });

  it('runs the Duo + iPad leg on the Xcode 27 image and an iPhone leg on macos-latest', () => {
    expect(job['runs-on']).toBe('${{ matrix.runner }}');
    const legs = job.strategy.matrix.include;
    const slugs = legs.map((leg) => leg.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const xcode27 = legs.find((leg) => leg.slug === 'xcode27');
    expect(xcode27.runner).toContain("'xcode-27'");
    expect(xcode27.devices.split(' ')).toEqual(['duo', 'ipad']);
    const latest = legs.find((leg) => leg.runner === 'macos-latest');
    expect(latest.devices).toBe('iphone');
    expect(job.strategy['fail-fast']).toBe(false);
  });

  it('builds the mobile package, syncs Capacitor, then builds and runs the simulator smoke', () => {
    expect(job.steps.map((step) => step.uses)).toContain('./.github/actions/setup-node-pnpm');
    const order = [
      stepIndex((s) => s.run === 'pnpm -C mobile run build'),
      stepIndex((s) => s.run === 'pnpm -C mobile exec cap sync ios'),
      stepIndex((s) => s.run === `bash ${SMOKE_SCRIPT} build`),
      stepIndex((s) => s.run === `bash ${SMOKE_SCRIPT} run \${{ matrix.devices }}`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('builds and links the iOS sidecar only on a manual run that asks for it', () => {
    const build = stepIndex((s) => s.id === 'sidecar');
    const link = stepIndex((s) => runOf(s).includes('configure-sidecar.sh'));
    const sync = stepIndex((s) => s.run === 'pnpm -C mobile exec cap sync ios');
    const step = job.steps[build];
    expect(step.if).toBe("matrix.slug == 'xcode27' && inputs.build_sidecar");
    expect(step['continue-on-error']).toBe(true);
    expect(step['timeout-minutes']).toBeGreaterThan(0);
    expect(runOf(step)).toContain('node mobile/scripts/build-sidecar.mjs ios');
    expect(job.steps[link].if).toBe("inputs.build_sidecar && steps.sidecar.outcome == 'success'");
    expect(build).toBeLessThan(link);
    expect(link).toBeLessThan(sync);
    expect(existsSync('mobile/ios/scripts/configure-sidecar.sh')).toBe(true);
  });

  it('always uploads screenshots and logs', () => {
    const upload = job.steps.find((step) => step.name === 'Upload screenshots and logs');
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}$/);
    expect(String(upload?.if ?? '')).toContain('always()');
    expect(upload.with.name).toContain('${{ matrix.slug }}');
    expect(job.env.MESH_SMOKE_OUT).toBe('build/ios-smoke/${{ matrix.slug }}');
    expect(upload.with.path).toBe('build/ios-smoke/');
  });

  it('builds unsigned for the Simulator and fails on crashes, boot failures and non-OPFS SQLite', () => {
    expect(statSync(SMOKE_SCRIPT).mode & 0o111).not.toBe(0);
    expect(smokeScript).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(smokeScript).toContain("-destination 'generic/platform=iOS Simulator'");
    expect(smokeScript).toContain('--mesh-smoke');
    expect(smokeScript).toContain('xcrun simctl io "$udid" screenshot');
    expect(smokeScript).toMatch(/crashed=1/);
    expect(smokeScript).toContain('"$status" != "booted"');
    expect(smokeScript).toContain('"$sqlite" != "opfs-sahpool"');
    expect(smokeScript).toContain('main loaded (sqlite=');
  });

  it('matches the launch argument and result file the app-side probe uses', () => {
    const probe = readFileSync(`${IOS_SOURCES}/MeshSmokeProbe.swift`, 'utf8');
    expect(probe).toContain('"--mesh-smoke"');
    expect(probe).toContain('"mesh-smoke.json"');
    expect(probe).toContain('MESH_SMOKE_TIMEOUT_S');
    expect(smokeScript).toContain('Documents/mesh-smoke.json');
    expect(smokeScript).toContain('SIMCTL_CHILD_MESH_SMOKE_TIMEOUT_S');
  });
});

describe.skipIf(process.platform === 'win32')('simulator selection (stub xcrun)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-ios-smoke-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const type = (identifier, name, productFamily) => ({ identifier, name, productFamily });
  const ios27 = {
    identifier: 'rt.iOS-27-2',
    version: '27.2',
    name: 'iOS 27.2',
    platform: 'iOS',
    isAvailable: true,
    supportedDeviceTypes: [
      type('dt.iPhone-17-Pro', 'iPhone 17 Pro', 'iPhone'),
      type('dt.iPhone-Duo', 'iPhone Duo', 'iPhone'),
      type('dt.iPhone-18-Pro', 'iPhone 18 Pro', 'iPhone'),
      type('dt.iPhone-18-Pro-Max', 'iPhone 18 Pro Max', 'iPhone'),
      type('dt.iPad-Pro-13', 'iPad Pro 13-inch (M5)', 'iPad'),
      type('dt.iPad-Air', 'iPad Air 11-inch (M3)', 'iPad'),
    ],
  };
  const future = {
    identifier: 'rt.iOS-28-0',
    version: '28.0',
    name: 'iOS 28.0',
    platform: 'iOS',
    isAvailable: true,
    supportedDeviceTypes: [type('dt.iPhone-19-Pro', 'iPhone 19 Pro', 'iPhone')],
  };
  const watch = {
    ...future,
    identifier: 'rt.watchOS-13',
    name: 'watchOS 13.0',
    platform: 'watchOS',
  };

  /** Runs `select <kind>` with an `xcrun` that prints `runtimes` as `simctl list runtimes --json`. */
  function select(kind, runtimes) {
    writeFileSync(path.join(dir, 'runtimes.json'), JSON.stringify({ runtimes }));
    const stub = path.join(dir, 'xcrun');
    writeFileSync(stub, `#!/bin/sh\ncat "${path.join(dir, 'runtimes.json')}"\n`);
    chmodSync(stub, 0o755);
    const result = spawnSync('bash', [SMOKE_SCRIPT, 'select', kind], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    });
    return { status: result.status, out: result.stdout.trim() };
  }

  it('picks the iPhone Duo on the newest runtime that has one', () => {
    expect(select('duo', [ios27, future, watch])).toEqual({
      status: 0,
      out: 'rt.iOS-27-2|27.2|dt.iPhone-Duo|iPhone Duo',
    });
  });

  it('falls back to the newest iPhone, flagged, when no runtime has a Duo', () => {
    const noDuo = {
      ...ios27,
      supportedDeviceTypes: ios27.supportedDeviceTypes.filter((t) => !/Duo/.test(t.name)),
    };
    expect(select('duo', [noDuo])).toEqual({
      status: 0,
      out: 'fallback|rt.iOS-27-2|27.2|dt.iPhone-18-Pro|iPhone 18 Pro',
    });
  });

  it('picks the newest Pro iPhone and iPad Pro on the newest iOS runtime', () => {
    expect(select('iphone', [ios27, watch]).out).toBe(
      'rt.iOS-27-2|27.2|dt.iPhone-18-Pro|iPhone 18 Pro',
    );
    expect(select('ipad', [ios27]).out).toBe(
      'rt.iOS-27-2|27.2|dt.iPad-Pro-13|iPad Pro 13-inch (M5)',
    );
    expect(select('iphone', [ios27, future]).out).toBe(
      'rt.iOS-28-0|28.0|dt.iPhone-19-Pro|iPhone 19 Pro',
    );
  });

  it('fails when nothing matches', () => {
    expect(select('ipad', [future]).status).toBe(1);
    expect(select('iphone', [watch]).status).toBe(1);
  });
});

describe.skipIf(!CONTRACTS)('iOS native plugins match the plugin contract', () => {
  const contract = CONTRACTS ? readFileSync(CONTRACTS, 'utf8') : '';
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** Body of `export interface <name> { … }` (top-level members are indented two spaces). */
  function interfaceBody(name) {
    const start = contract.indexOf(`export interface ${name} {`);
    expect(start, `interface ${name}`).toBeGreaterThanOrEqual(0);
    const end = contract.indexOf('\n}', start);
    return stripComments(contract.slice(start, end));
  }
  const members = (name, re) => [...interfaceBody(name).matchAll(re)].map((m) => m[1]).sort();
  const methods = (name) => members(name, /^ {2}(\w+)\(/gm);
  const events = (name) => members(name, /^ {2}(\w+):/gm);

  const swiftFiles = readdirSync(`${IOS_SOURCES}/Plugins`).map(
    (f) => `${IOS_SOURCES}/Plugins/${f}`,
  );
  const swift = (prefix) =>
    swiftFiles
      .filter((f) => path.basename(f).startsWith(prefix))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
  const declared = (source) =>
    [...source.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]).sort();

  it.each([
    ['MeshNet', 'MeshNetPlugin', 'MeshNetEvents'],
    ['MeshDevice', 'MeshDevicePlugin', 'MeshDeviceEvents'],
    ['MeshProcess', 'MeshProcessPlugin', 'MeshProcessEvents'],
  ])('%s: methods, selectors and events', (jsName, pluginInterface, eventsInterface) => {
    const source = swift(jsName);
    expect(source).toContain(`public let jsName = "${jsName}"`);
    expect(declared(source)).toEqual(methods(pluginInterface));
    for (const method of methods(pluginInterface)) {
      expect(source, `@objc func ${method}`).toContain(
        `@objc func ${method}(_ call: CAPPluginCall)`,
      );
    }
    for (const event of events(eventsInterface)) {
      expect(source, `event ${event}`).toContain(`"${event}"`);
    }
  });

  it('registers MeshNet, MeshDevice and MeshProcess but not the Android-only MeshUsbSerial', () => {
    const controller = readFileSync(`${IOS_SOURCES}/MainViewController.swift`, 'utf8');
    for (const plugin of ['MeshNetPlugin()', 'MeshProcessPlugin()', 'devicePlugin']) {
      expect(controller).toContain(`registerPluginInstance(${plugin})`);
    }
    expect(controller).not.toMatch(/registerPluginInstance\(MeshUsbSerial/);
    expect(controller).toContain('private let devicePlugin = MeshDevicePlugin()');
  });
});
