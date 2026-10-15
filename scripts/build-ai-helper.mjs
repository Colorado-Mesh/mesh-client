import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'resources/ai-helper');
mkdirSync(output, { recursive: true });
if (process.platform === 'darwin') {
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim();
  for (const arch of ['arm64', 'x86_64']) {
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-module-cache-path',
        path.join(output, '.swift-cache'),
        '-parse-as-library',
        '-O',
        '-sdk',
        sdk,
        '-target',
        `${arch}-apple-macosx26.0`,
        path.join(root, 'native/ai/apple/main.swift'),
        '-o',
        path.join(output, `mesh-ai-${arch}`),
      ],
      { stdio: 'inherit' },
    );
  }
  execFileSync(
    'lipo',
    [
      '-create',
      path.join(output, 'mesh-ai-arm64'),
      path.join(output, 'mesh-ai-x86_64'),
      '-output',
      path.join(output, 'mesh-ai'),
    ],
    { stdio: 'inherit' },
  );
  mkdirSync(path.join(output, 'staged/darwin'), { recursive: true });
  cpSync(path.join(output, 'mesh-ai'), path.join(output, 'staged/darwin/mesh-ai'));
} else if (process.platform === 'win32') {
  // Build both installer architectures on the Windows runner.
  for (const arch of ['x64', 'arm64']) {
    execFileSync(
      'dotnet',
      [
        'publish',
        path.join(root, 'native/ai/windows/MeshAi.csproj'),
        '-c',
        'Release',
        '-r',
        `win-${arch}`,
        '--self-contained',
        'true',
        '-o',
        path.join(output, `staged/win-${arch}`),
      ],
      { stdio: 'inherit' },
    );
  }
}
if (process.platform === 'darwin' || process.platform === 'win32') {
  const staged = path.join(
    output,
    'staged',
    process.platform === 'darwin' ? 'darwin' : `win-${process.arch}`,
  );
  mkdirSync(path.join(output, 'active'), { recursive: true });
  cpSync(staged, path.join(output, 'active'), { recursive: true });
}
