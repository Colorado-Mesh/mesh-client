import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { discoverXcodeDeveloperDir } from './lib/discover-xcode-developer-dir.mjs';

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
  // Apple Silicon: Metal MLX Catch up helper. Discover Xcode.app (ignore CLT xcode-select).
  // Soft-fail locally; hard-fail in CI so release DMGs ship mesh-ai-mlx.
  if (process.arch === 'arm64') {
    const mlxPackage = path.join(root, 'native/ai/mlx');
    try {
      const xcodeDeveloper = discoverXcodeDeveloperDir();
      const env = { ...process.env };
      if (xcodeDeveloper) env.DEVELOPER_DIR = xcodeDeveloper;
      else if (!env.DEVELOPER_DIR) {
        throw new Error(
          'Xcode.app Contents/Developer not found under /Applications (install full Xcode; CLT-only is not enough)',
        );
      }
      execFileSync('swift', ['build', '-c', 'release', '--product', 'mesh-ai-mlx'], {
        cwd: mlxPackage,
        stdio: 'inherit',
        env,
      });
      const built = path.join(mlxPackage, '.build', 'release', 'mesh-ai-mlx');
      if (!existsSync(built)) {
        throw new Error(`mesh-ai-mlx binary missing at ${built}`);
      }
      cpSync(built, path.join(output, 'staged/darwin/mesh-ai-mlx'));
      console.debug('[build-ai-helper] Staged mesh-ai-mlx for Apple Silicon Catch up');
    } catch (error) {
      const message = error instanceof Error ? error.message : error;
      if (process.env.CI) {
        console.error('[build-ai-helper] MLX helper required in CI:', message);
        throw error instanceof Error ? error : new Error(String(error));
      }
      console.warn(
        '[build-ai-helper] Optional MLX helper build failed; MLX Catch up unavailable until ensure runs.',
        message,
      );
    }
  }
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
